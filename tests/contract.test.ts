import { expect, test } from "bun:test";
import { handle, type ApiStore } from "../src/index";
import type { Config } from "../src/config";

const userId = "11111111-1111-4111-8111-111111111111";
const serviceId = "22222222-2222-4222-8222-222222222222";
const recordId = "33333333-3333-4333-8333-333333333333";

const config: Config = {
  host: "127.0.0.1",
  port: 8787,
  production: false,
  supabaseUrl: "https://supabase.example.test",
  serviceRoleKey: "service-role-test",
  gatewaySecret: "gateway-secret-test",
  domainApiUrl: "https://domain.example.test",
  emailApiUrl: "https://email.example.test",
  hostingApiUrl: "https://hosting.example.test",
  lxcApiUrl: "https://lxc.example.test",
  kvmApiUrl: "https://lxc.example.test",
  corsOrigins: new Set(),
};

function storeFor(options: { scopes?: string[]; owner?: string; oauth?: boolean; rateLimitAllowed?: boolean; idempotencyState?: "created" | "replay" | "pending" | "conflict" } = {}): ApiStore {
  const scopes = options.scopes ?? [
    "account:read", "services:read", "domains:read", "domains:write", "domains:dns:write",
    "email:read", "email:write", "hosting:read", "hosting:panel:access", "kvm:read", "kvm:power:write", "kvm:snapshots:write", "kvm:subscription:write",
  ];
  const owner = options.owner ?? userId;
  const key = {
    id: "api-key-id",
    user_id: owner,
    scopes,
    rate_limit_per_minute: 100,
      expires_at: "2099-01-01T00:00:00.000Z",
    revoked_at: null,
    disabled_at: null,
    allowed_ipv4: ["127.0.0.1"],
  };
  const token = {
    id: "oauth-token-id",
    user_id: owner,
    scopes,
    rate_limit_per_minute: 100,
    expires_at: "2099-01-01T00:00:00.000Z",
    revoked_at: null,
  };
  return {
    async rest<T>(path: string): Promise<T> {
      if (path.startsWith("dashboard_api_keys?")) return (options.oauth ? [] : [key]) as T;
      if (path.startsWith("dashboard_oauth_access_tokens?")) return (options.oauth ? [token] : []) as T;
      if (path.startsWith("dashboard_product_identities?")) return [{ external_user_id: `${owner}-external` }] as T;
      if (path.startsWith("dashboard_users?")) return [{ id: owner, email: "test@example.com" }] as T;
      if (path.startsWith("dashboard_services?")) return [{ id: serviceId, user_id: owner }] as T;
      if (path.startsWith("eh_services?")) return [{ id: serviceId, user_id: owner }] as T;
      if (path.startsWith("yts_instances?")) return [{ id: serviceId, user_id: owner }] as T;
      return [] as T;
    },
    async rpc<T>(name: string): Promise<T> {
      if (name.startsWith("consume_")) return (options.rateLimitAllowed ?? true) as T;
      return {
        state: options.idempotencyState ?? "created",
        ...(options.idempotencyState === "replay" ? { response_status: 202, response_body: { data: { replayed: true }, request_id: "replay-request" } } : {}),
      } as T;
    },
    async update(): Promise<void> {},
    async insert(): Promise<void> {},
    async productIdentity(): Promise<string> { return `${owner}-external`; },
  };
}

async function json(response: Response): Promise<any> {
  return response.json();
}

test("serves the interactive API documentation and OpenAPI contract", async () => {
  const docs = await handle(new Request("https://api.example.test/docs"), config, storeFor());
  expect(docs.status).toBe(200);
  expect(docs.headers.get("content-type")).toContain("text/html");
  const html = await docs.text();
  expect(html).toContain("KmerHosting API");
  expect(html).toContain("/docs/swagger-ui.css");
  expect(html).toContain("/docs/swagger-ui-bundle.js");
  expect(html).toContain("url:'/openapi.json'");

  const schema = await handle(new Request("https://api.example.test/openapi.json"), config, storeFor());
  expect(schema.status).toBe(200);
  expect(schema.headers.get("content-type")).toContain("application/json");
  const document = await schema.json() as { openapi?: string; info?: { title?: string } };
  expect(document.openapi).toBe("3.1.0");
  expect(document.info?.title).toBe("KmerHosting API");
});

function request(path: string, init: RequestInit = {}, token = "kh_live_test"): Request {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-Real-IP", "127.0.0.1");
  return new Request(`https://api.example.test${path}`, { ...init, headers });
}

test("returns stable structured errors for authentication, scopes, JSON and idempotency", async () => {
  const missing = await handle(new Request("https://api.example.test/v1/account"), config, storeFor());
  expect(missing.status).toBe(401);
  expect((await json(missing)).error.code).toBe("invalid_token");

  const noScope = await handle(request("/v1/domains"), config, storeFor({ scopes: ["account:read"] }));
  expect(noScope.status).toBe(403);
  expect((await json(noScope)).error).toMatchObject({ code: "insufficient_scope", message: "This credential requires the domains:read scope." });

  const invalidJson = await handle(request(`/v1/kvm/instances/${serviceId}/actions`, {
    method: "POST",
    body: "not-json",
    headers: { "Idempotency-Key": "invalid-json-key" },
  }), config, storeFor());
  expect(invalidJson.status).toBe(400);
  expect((await json(invalidJson)).error.code).toBe("invalid_json");

  const noIdempotency = await handle(request(`/v1/kvm/instances/${serviceId}/actions`, {
    method: "POST",
    body: JSON.stringify({ action: "restart" }),
  }), config, storeFor());
  expect(noIdempotency.status).toBe(400);
  expect((await json(noIdempotency)).error.code).toBe("idempotency_key_required");

  const limited = await handle(request("/v1/account"), config, storeFor({ scopes: ["account:read"], rateLimitAllowed: false }));
  expect(limited.status).toBe(429);
  expect((await json(limited)).error.code).toBe("rate_limit_exceeded");

  const conflict = await handle(request(`/v1/kvm/instances/${serviceId}/actions`, {
    method: "POST",
    body: JSON.stringify({ action: "restart" }),
    headers: { "Idempotency-Key": "conflict-key" },
  }), config, storeFor({ scopes: ["kvm:power:write"], idempotencyState: "conflict" }));
  expect(conflict.status).toBe(409);
  expect((await json(conflict)).error.code).toBe("idempotency_key_conflict");

  const replay = await handle(request(`/v1/kvm/instances/${serviceId}/actions`, {
    method: "POST",
    body: JSON.stringify({ action: "restart" }),
    headers: { "Idempotency-Key": "replay-key" },
  }), config, storeFor({ scopes: ["kvm:power:write"], idempotencyState: "replay" }));
  expect(replay.status).toBe(202);
  expect(await json(replay)).toMatchObject({ data: { replayed: true } });
});

test("serves every read route and keeps direct records tenant-scoped", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return Response.json({ product: "ok" });
  }) as typeof fetch;

  try {
    const routes: Array<[string, string]> = [
      ["/v1/account", "account:read"],
      ["/v1/account/api-usage", "account:usage:read"],
      ["/v1/services", "services:read"],
      [`/v1/services/${serviceId}`, "services:read"],
      ["/v1/domains", "domains:read"],
      [`/v1/domains/${serviceId}`, "domains:read"],
      [`/v1/domains/${serviceId}/dns`, "domains:read"],
      [`/v1/lxc/instances/${serviceId}/metrics`, "lxc:read"],
      [`/v1/lxc/instances/${serviceId}/snapshots`, "lxc:read"],
      ["/v1/email/services", "email:read"],
      ["/v1/hosting/services", "hosting:read"],
      [`/v1/hosting/services/${serviceId}/stats`, "hosting:read"],
      ["/v1/kvm/instances", "kvm:read"],
      [`/v1/kvm/instances/${serviceId}`, "kvm:read"],
      [`/v1/kvm/instances/${serviceId}/snapshots`, "kvm:read"],
    ];
    for (const [path, scope] of routes) {
      const response = await handle(request(path), config, storeFor({ scopes: [scope] }));
      expect(response.status, path).toBe(200);
    }
    expect(calls.some((url) => url.includes("domain.example.test/domains"))).toBe(true);
    expect(calls.some((url) => url.includes("lxc.example.test?path=%2Fdetails"))).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serves every mutation route with the documented method and idempotency contract", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? String(init.body) : "" });
    return new Response(JSON.stringify({ queued: true }), { status: 202 });
  }) as typeof fetch;

  const cases: Array<{ path: string; method: string; scope: string; body: unknown }> = [
    { path: `/v1/domains/${serviceId}/auto-renew`, method: "PUT", scope: "domains:write", body: { enabled: true } },
    { path: `/v1/domains/${serviceId}/nameservers`, method: "PUT", scope: "domains:write", body: { nameServers: ["ns1.example.test", "ns2.example.test"] } },
    { path: `/v1/domains/${serviceId}/dns`, method: "POST", scope: "domains:dns:write", body: { type: "A", name: "@", content: "192.0.2.1" } },
    { path: `/v1/domains/${serviceId}/dns/${recordId}`, method: "PUT", scope: "domains:dns:write", body: { content: "192.0.2.2" } },
    { path: `/v1/domains/${serviceId}/dns/${recordId}`, method: "DELETE", scope: "domains:dns:write", body: undefined },
    { path: `/v1/email/services/${serviceId}/provision`, method: "POST", scope: "email:write", body: {} },
    { path: `/v1/email/services/${serviceId}/dns/sync`, method: "POST", scope: "email:write", body: {} },
    { path: `/v1/hosting/services/${serviceId}/panel-access`, method: "POST", scope: "hosting:panel:access", body: { target: "panel" } },
    { path: `/v1/kvm/instances/${serviceId}/actions`, method: "POST", scope: "kvm:power:write", body: { action: "restart" } },
    { path: `/v1/lxc/instances/${serviceId}/actions`, method: "POST", scope: "lxc:power:write", body: { action: "restart" } },
    { path: `/v1/lxc/instances/${serviceId}/snapshots`, method: "POST", scope: "lxc:snapshots:write", body: { action: "create", name: "before-upgrade" } },
    { path: `/v1/lxc/instances/${serviceId}/password`, method: "POST", scope: "lxc:credentials:write", body: { password: "Safe-password-123" } },
    { path: `/v1/lxc/instances/${serviceId}/reinstall`, method: "POST", scope: "lxc:reinstall", body: { distribution: "ubuntu-24.04" } },
    { path: `/v1/lxc/instances/${serviceId}/terminal-ticket`, method: "POST", scope: "lxc:terminal:access", body: {} },
    { path: `/v1/lxc/instances/${serviceId}/auto-renew`, method: "PUT", scope: "lxc:subscription:write", body: { enabled: true } },
    { path: `/v1/lxc/instances/${serviceId}/billing-period`, method: "PUT", scope: "lxc:subscription:write", body: { billingMonths: 3 } },
    { path: `/v1/kvm/instances/${serviceId}/auto-renew`, method: "PUT", scope: "kvm:subscription:write", body: { enabled: true } },
    { path: `/v1/kvm/instances/${serviceId}/snapshots`, method: "POST", scope: "kvm:snapshots:write", body: { name: "test" } },
    { path: `/v1/kvm/instances/${serviceId}/snapshots/${recordId}`, method: "PATCH", scope: "kvm:snapshots:write", body: { name: "renamed" } },
    { path: `/v1/kvm/instances/${serviceId}/snapshots/${recordId}`, method: "DELETE", scope: "kvm:snapshots:write", body: undefined },
  ];

  try {
    for (const [index, item] of cases.entries()) {
      const headers = { "Idempotency-Key": `contract-key-${index}` };
      const response = await handle(request(item.path, {
        method: item.method,
        headers,
        body: item.body === undefined ? undefined : JSON.stringify(item.body),
      }), config, storeFor({ scopes: [item.scope] }));
      expect(response.status, `${item.method} ${item.path}`).toBe(202);
    }
    expect(calls).toHaveLength(cases.length);
    expect(calls.every((call) => call.method === "POST" || call.method === "PUT" || call.method === "PATCH" || call.method === "DELETE")).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves upstream API error code and message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ error: { code: "domain_busy", message: "Domain operation is already running." } }, { status: 409 })) as unknown as typeof fetch;
  try {
    const response = await handle(request("/v1/domains"), config, storeFor({ scopes: ["domains:read"] }));
    expect(response.status).toBe(409);
    expect((await json(response)).error).toMatchObject({ code: "domain_busy", message: "Domain operation is already running." });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authenticates user-scoped OAuth tokens without changing tenant ownership", async () => {
  const response = await handle(request("/v1/services", {}, "kh_oauth_test"), config, storeFor({ oauth: true, owner: userId, scopes: ["services:read"] }));
  expect(response.status).toBe(200);
  expect((await json(response)).data[0].user_id).toBe(userId);
});
