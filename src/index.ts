import { loadConfig, type Config } from "./config";
import { callProduct, productError, type Product } from "./gateway";
import { openapi } from "./openapi";
import { ApiError, assertActiveKey, extractBearerKey, requireScope, sha256 } from "./security";
import { SupabaseRest } from "./supabase";

type ApiKey = {
  id: string;
  user_id: string;
  scopes: string[];
  rate_limit_per_minute: number;
  expires_at: string | null;
  revoked_at: string | null;
  disabled_at: string | null;
};

type Principal = { key: ApiKey; userId: string };
type IdempotencyClaim = { state: "created" | "replay" | "pending" | "conflict"; response_status?: number; response_body?: unknown };
type MutationOutcome = { data: unknown; status?: number };

const noStore = { "Cache-Control": "no-store" };
const productForIdentity: Record<"domain" | "email", "domain" | "emails"> = { domain: "domain", email: "emails" };

function requestId(): string { return crypto.randomUUID(); }

function corsHeaders(request: Request, config: Config): Headers {
  const headers = new Headers({ Vary: "Origin" });
  const origin = request.headers.get("origin");
  if (origin && config.corsOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Request-Id");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

function responseJson(request: Request, config: Config, body: unknown, status = 200, id = requestId()): Response {
  const headers = corsHeaders(request, config);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Request-Id", id);
  for (const [key, value] of Object.entries(noStore)) headers.set(key, value);
  return new Response(JSON.stringify(body), { status, headers });
}

function apiErrorBody(error: ApiError, id: string) { return { error: { code: error.code, message: error.message, request_id: id } }; }

function errorResponse(request: Request, config: Config, error: unknown, id: string): Response {
  if (error instanceof ApiError) return responseJson(request, config, apiErrorBody(error, id), error.status, id);
  console.error(JSON.stringify({ request_id: id, message: error instanceof Error ? error.message : "Unknown error" }));
  return responseJson(request, config, { error: { code: "internal_error", message: "An unexpected error occurred.", request_id: id } }, 500, id);
}

async function jsonBody(request: Request): Promise<{ raw: string; body: Record<string, unknown> }> {
  const raw = await request.text();
  if (!raw) return { raw, body: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("not an object");
    return { raw, body: parsed as Record<string, unknown> };
  } catch { throw new ApiError(400, "invalid_json", "Request body must be a JSON object."); }
}

async function authenticate(request: Request, db: SupabaseRest): Promise<Principal> {
  const hash = await sha256(extractBearerKey(request.headers.get("authorization")));
  const keys = await db.rest<ApiKey[]>(`dashboard_api_keys?select=id,user_id,scopes,rate_limit_per_minute,expires_at,revoked_at,disabled_at&secret_hash=eq.${hash}&limit=1`);
  const key = keys[0];
  if (!key) throw new ApiError(401, "invalid_api_key", "The API key is invalid.");
  assertActiveKey(key);
  if (!Array.isArray(key.scopes)) throw new ApiError(503, "api_key_schema_not_ready", "The API-key scope migration has not been applied.");
  const allowed = await db.rpc<boolean>("consume_dashboard_api_key_rate_limit", { p_api_key_id: key.id, p_limit: key.rate_limit_per_minute });
  if (!allowed) throw new ApiError(429, "rate_limit_exceeded", "Too many requests. Try again in one minute.");
  await db.update(`dashboard_api_keys?id=eq.${key.id}`, { last_used_at: new Date().toISOString() });
  return { key, userId: key.user_id };
}

async function productUserId(db: SupabaseRest, principal: Principal, product: Product): Promise<string> {
  if (product === "domain" || product === "email") return db.productIdentity(principal.userId, productForIdentity[product]);
  return principal.userId;
}

async function recordUsage(db: SupabaseRest, principal: Principal, id: string, operation: string, status: string): Promise<void> {
  await db.insert("dashboard_api_key_usage", { api_key_id: principal.key.id, user_id: principal.userId, request_id: id, product: "kmerhosting-api", service: "public-api", operation, status, billable: false, cost_usd_micros: 0, metadata: {} });
}

async function readRoute(request: Request, config: Config, db: SupabaseRest, id: string, scope: string, operation: string, work: (principal: Principal) => Promise<unknown>): Promise<Response> {
  const principal = await authenticate(request, db);
  requireScope(principal.key.scopes, scope);
  try {
    const data = await work(principal);
    await recordUsage(db, principal, id, operation, "succeeded").catch(() => undefined);
    return responseJson(request, config, { data, request_id: id }, 200, id);
  } catch (error) {
    await recordUsage(db, principal, id, operation, "rejected").catch(() => undefined);
    throw error;
  }
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new ApiError(400, "idempotency_key_required", "Provide an Idempotency-Key containing 8 to 128 letters, numbers, dots, underscores, colons, or dashes.");
  return key;
}

async function writeRoute(request: Request, config: Config, db: SupabaseRest, id: string, scope: string, operation: string, path: string, work: (principal: Principal, body: Record<string, unknown>) => Promise<MutationOutcome>): Promise<Response> {
  const principal = await authenticate(request, db);
  requireScope(principal.key.scopes, scope);
  const { raw, body } = await jsonBody(request);
  const key = idempotencyKey(request);
  const fingerprint = await sha256([request.method, path, raw].join("\n"));
  const claim = await db.rpc<IdempotencyClaim>("claim_dashboard_api_idempotency_key", { p_api_key_id: principal.key.id, p_operation: operation, p_idempotency_key: key, p_request_hash: fingerprint });
  if (claim.state === "conflict") throw new ApiError(409, "idempotency_key_conflict", "This Idempotency-Key was used with a different request.");
  if (claim.state === "pending") throw new ApiError(409, "request_in_progress", "A request with this Idempotency-Key is still in progress.");
  if (claim.state === "replay") return responseJson(request, config, claim.response_body, claim.response_status ?? 200, id);
  let response: { status: number; body: unknown };
  try {
    const outcome = await work(principal, body);
    const status = outcome.status === 201 || outcome.status === 202 ? outcome.status : 200;
    response = { status, body: { data: outcome.data, request_id: id } };
    await recordUsage(db, principal, id, operation, "succeeded").catch(() => undefined);
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError(500, "internal_error", "An unexpected error occurred.");
    response = { status: apiError.status, body: apiErrorBody(apiError, id) };
    await recordUsage(db, principal, id, operation, "rejected").catch(() => undefined);
  }
  await db.rpc("complete_dashboard_api_idempotency_key", { p_api_key_id: principal.key.id, p_operation: operation, p_idempotency_key: key, p_response_status: response.status, p_response_body: response.body });
  return responseJson(request, config, response.body, response.status, id);
}

async function forward(config: Config, db: SupabaseRest, principal: Principal, product: Product, method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await callProduct(config, { product, productUserId: await productUserId(db, principal, product), method, path, body });
  if (response.status >= 400) productError(response);
  return response.payload;
}

async function forwardMutation(config: Config, db: SupabaseRest, principal: Principal, product: Product, method: string, path: string, body?: unknown): Promise<MutationOutcome> {
  const response = await callProduct(config, { product, productUserId: await productUserId(db, principal, product), method, path, body });
  if (response.status >= 400) productError(response);
  return { data: response.payload, status: response.status };
}

const docsHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KmerHosting API</title><link rel="stylesheet" href="/docs/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="/docs/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',persistAuthorization:true})</script></body></html>`;

export async function handle(request: Request, config: Config = loadConfig()): Promise<Response> {
  const id = requestId();
  const path = new URL(request.url).pathname.replace(/\/$/, "") || "/";
  const db = new SupabaseRest(config);
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, config) });
    if (path === "/health" && request.method === "GET") return responseJson(request, config, { status: "ok", version: "v1", request_id: id }, 200, id);
    if (path === "/openapi.json" && request.method === "GET") return responseJson(request, config, openapi, 200, id);
    if (path === "/docs" && request.method === "GET") return new Response(docsHtml, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if ((path === "/docs/swagger-ui.css" || path === "/docs/swagger-ui-bundle.js") && request.method === "GET") {
      const asset = Bun.file(`${import.meta.dir}/../node_modules/swagger-ui-dist/${path.slice("/docs/".length)}`);
      if (!(await asset.exists())) throw new ApiError(404, "not_found", "Documentation asset not found.");
      return new Response(asset, { headers: { "Cache-Control": "public, max-age=86400" } });
    }
    if (path === "/v1/account" && request.method === "GET") return readRoute(request, config, db, id, "account:read", "account.read", async (principal) => {
      const rows = await db.rest<Record<string, unknown>[]>(`dashboard_users?select=id,email,full_name,first_name,last_name,company_name,country,preferred_language,timezone,status,created_at&id=eq.${principal.userId}&limit=1`);
      if (!rows[0]) throw new ApiError(404, "account_not_found", "The account was not found.");
      return rows[0];
    });
    if (path === "/v1/services" && request.method === "GET") return readRoute(request, config, db, id, "services:read", "services.list", (principal) => db.rest(`dashboard_services?select=id,service_type,source_system,source_record_id,display_name,status,management_mode,plan_name,renewal_price,renewal_currency,billing_months,activated_at,renews_at,auto_renew,grace_ends_at,cancellation_requested_at,cancel_at,created_at,updated_at&user_id=eq.${principal.userId}&order=created_at.desc`));
    const service = path.match(/^\/v1\/services\/([0-9a-f-]{36})$/i);
    if (service && request.method === "GET") return readRoute(request, config, db, id, "services:read", "services.read", async (principal) => {
      const rows = await db.rest<Record<string, unknown>[]>(`dashboard_services?select=id,service_type,source_system,source_record_id,display_name,status,management_mode,plan_name,renewal_price,renewal_currency,billing_months,activated_at,renews_at,auto_renew,grace_ends_at,cancellation_requested_at,cancel_at,created_at,updated_at&id=eq.${service[1]}&user_id=eq.${principal.userId}&limit=1`);
      if (!rows[0]) throw new ApiError(404, "service_not_found", "The service was not found.");
      return rows[0];
    });
    if (path === "/v1/domains" && request.method === "GET") return readRoute(request, config, db, id, "domains:read", "domains.list", (principal) => forward(config, db, principal, "domain", "GET", "/domains"));
    const domain = path.match(/^\/v1\/domains\/([0-9a-f-]{36})(?:\/(auto-renew|nameservers|dns)(?:\/([0-9a-f-]{36}))?)?$/i);
    if (domain) {
      const [, domainId, area, recordId] = domain;
      const upstream = `/domains/${domainId}${area ? `/${area}` : ""}${recordId ? `/${recordId}` : ""}`;
      if (request.method === "GET" && (!area || area === "dns")) return readRoute(request, config, db, id, "domains:read", area === "dns" ? "domains.dns.list" : "domains.read", (principal) => forward(config, db, principal, "domain", "GET", upstream));
      if ((area === "auto-renew" || area === "nameservers") && request.method === "PUT") return writeRoute(request, config, db, id, "domains:write", `domains.${area}`, path, (principal, body) => forwardMutation(config, db, principal, "domain", "PUT", upstream, body));
      if (area === "dns" && ["POST", "PUT", "DELETE"].includes(request.method)) return writeRoute(request, config, db, id, "domains:dns:write", `domains.dns.${request.method.toLowerCase()}`, path, (principal, body) => forwardMutation(config, db, principal, "domain", request.method, upstream, body));
    }
    if (path === "/v1/email/services" && request.method === "GET") return readRoute(request, config, db, id, "email:read", "email.services.list", async (principal) => {
      const userId = await productUserId(db, principal, "email");
      return db.rest(`eh_services?select=id,plan_id,term_months,domain_name,status,mailbox_limit,storage_bytes_per_mailbox,domain_limit,auto_renew,starts_at,renews_at,grace_ends_at,suspended_at,cancelled_at,created_at,updated_at&user_id=eq.${userId}&order=created_at.desc`);
    });
    const email = path.match(/^\/v1\/email\/services\/([0-9a-f-]{36})\/(provision|dns\/sync)$/i);
    if (email && request.method === "POST") {
      const [, serviceId, action] = email;
      const operation = action === "provision" ? "email.services.provision" : "email.services.dns.sync";
      return writeRoute(request, config, db, id, "email:write", operation, path, (principal) => forwardMutation(config, db, principal, "email", "POST", "", { action: action === "provision" ? "provision_service" : "sync_dns", serviceId }));
    }
    if (path === "/v1/hosting/services" && request.method === "GET") return readRoute(request, config, db, id, "hosting:read", "hosting.services.list", (principal) => db.rest(`dashboard_services?select=id,display_name,status,plan_name,management_mode,renewal_price,renewal_currency,renews_at,auto_renew,created_at&user_id=eq.${principal.userId}&source_system=eq.shared-hosting&order=created_at.desc`));
    const hosting = path.match(/^\/v1\/hosting\/services\/([0-9a-f-]{36})\/(stats|panel-access)$/i);
    if (hosting) {
      const [, serviceId, action] = hosting;
      if (action === "stats" && request.method === "GET") return readRoute(request, config, db, id, "hosting:read", "hosting.services.stats", (principal) => forward(config, db, principal, "hosting", "POST", "/service/stats", { serviceId }));
      if (action === "panel-access" && request.method === "POST") return writeRoute(request, config, db, id, "hosting:panel:access", "hosting.services.panel_access", path, (principal, body) => forwardMutation(config, db, principal, "hosting", "POST", "/service/login", { serviceId, target: body.target }));
    }
    if (path === "/v1/vps/instances" && request.method === "GET") return readRoute(request, config, db, id, "vps:read", "vps.instances.list", async (principal) => {
      const userId = await db.productIdentity(principal.userId, "lxc");
      return db.rest(`yts_instances?select=id,plan_code,hostname,status,ipv4,ipv6,ssh_host,ssh_port,region,distribution,created_at,renews_at,billing_status,auto_renew,cancellation_requested_at,cancel_at,grace_ends_at,suspended_at,managed&user_id=eq.${userId}&order=created_at.desc`);
    });
    const vps = path.match(/^\/v1\/vps\/instances\/([0-9a-f-]{36})(?:\/(actions|snapshots|auto-renew))?(?:\/([A-Za-z0-9._:-]{1,160}))?$/i);
    if (vps) {
      const [, serviceId, area, snapshotId] = vps;
      if (!area && request.method === "GET") return readRoute(request, config, db, id, "vps:read", "vps.instances.read", (principal) => forward(config, db, principal, "lxc", "POST", "/details", { serviceId }));
      if (area === "actions" && request.method === "POST") return writeRoute(request, config, db, id, "vps:write", "vps.instances.action", path, (principal, body) => forwardMutation(config, db, principal, "lxc", "POST", "/action", { serviceId, action: body.action }));
      if (area === "auto-renew" && request.method === "PUT") return writeRoute(request, config, db, id, "vps:write", "vps.instances.auto_renew", path, (principal, body) => forwardMutation(config, db, principal, "lxc", "POST", "/auto-renew", { serviceId, enabled: body.enabled }));
      if (area === "snapshots" && !snapshotId && request.method === "GET") return readRoute(request, config, db, id, "vps:read", "vps.snapshots.list", (principal) => forward(config, db, principal, "lxc", "POST", "/snapshots/list", { serviceId }));
      if (area === "snapshots" && !snapshotId && request.method === "POST") return writeRoute(request, config, db, id, "vps:snapshots:write", "vps.snapshots.create", path, (principal, body) => forwardMutation(config, db, principal, "lxc", "POST", "/snapshots/create", { serviceId, name: body.name, description: body.description }));
      if (area === "snapshots" && snapshotId && request.method === "PATCH") return writeRoute(request, config, db, id, "vps:snapshots:write", "vps.snapshots.update", path, (principal, body) => forwardMutation(config, db, principal, "lxc", "POST", "/snapshots/update", { serviceId, snapshotId, name: body.name, description: body.description }));
      if (area === "snapshots" && snapshotId && request.method === "DELETE") return writeRoute(request, config, db, id, "vps:snapshots:write", "vps.snapshots.delete", path, (principal) => forwardMutation(config, db, principal, "lxc", "POST", "/snapshots/delete", { serviceId, snapshotId }));
    }
    throw new ApiError(404, "not_found", "The requested endpoint does not exist.");
  } catch (error) { return errorResponse(request, config, error, id); }
}

if (import.meta.main) {
  const config = loadConfig();
  Bun.serve({ hostname: config.host, port: config.port, fetch: (request) => handle(request, config) });
  console.info(`KmerHosting API listening on http://${config.host}:${config.port}`);
}
