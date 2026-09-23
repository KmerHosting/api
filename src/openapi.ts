const id = { in: "path", required: true, schema: { type: "string", format: "uuid" } } as const;
const json = (schema: Record<string, unknown>) => ({ required: true, content: { "application/json": { schema } } });
const response = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } });
const mutation = (summary: string, scope: string, body: Record<string, unknown>, description = "Accepted") => ({
  summary,
  description: `Requires the \`${scope}\` scope and a unique \`Idempotency-Key\` header.`,
  requestBody: json(body),
  responses: { "200": response(description), "201": response(description), "202": response(description), "400": { $ref: "#/components/responses/Error" }, "401": { $ref: "#/components/responses/Error" }, "403": { $ref: "#/components/responses/Error" }, "409": { $ref: "#/components/responses/Error" } },
});

const publicDomainSearchServers = [{ url: "https://domain.kmerhosting.com", description: "Public domain search service" }];
const publicDomainSearchParameters = [
  { in: "query", name: "domain", description: "A domain to check. Repeat this parameter for a bulk search.", schema: { type: "string", minLength: 3, maxLength: 253, examples: ["example.com"] } },
  { in: "query", name: "domains", description: "Comma-, whitespace- or newline-separated domains. Repeat this parameter when useful.", schema: { type: "string", minLength: 3, maxLength: 5099, examples: ["example.com,example.org,example.cm"] } },
  { in: "query", name: "q", description: "Alias for `domain` for simple integrations.", schema: { type: "string", minLength: 3, maxLength: 253, examples: ["example.com"] } },
];
const publicDomainSearchRequestBody = json({
  oneOf: [
    { type: "object", required: ["domains"], additionalProperties: false, properties: { domains: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: { type: "string", minLength: 3, maxLength: 253 } } } },
    { type: "object", required: ["domain"], additionalProperties: false, properties: { domain: { type: "string", minLength: 3, maxLength: 253 } } },
    { type: "object", required: ["domainName"], additionalProperties: false, properties: { domainName: { type: "string", minLength: 3, maxLength: 253 } } },
    { type: "object", required: ["q"], additionalProperties: false, properties: { q: { type: "string", minLength: 3, maxLength: 253 } } },
  ],
});
const publicDomainSearchResponses = {
  "200": { description: "Availability results and current customer pricing.", content: { "application/json": { schema: { $ref: "#/components/schemas/PublicDomainSearchResponse" } } } },
  "400": { description: "No valid domain was supplied.", content: { "application/json": { schema: { $ref: "#/components/schemas/PublicDomainSearchError" } } } },
  "429": { description: "The public IP allowance was exceeded. Retry after the supplied delay.", headers: { "Retry-After": { schema: { type: "integer" } }, "X-RateLimit-Limit": { schema: { type: "integer" } }, "X-RateLimit-Remaining": { schema: { type: "integer" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/PublicDomainSearchError" } } } },
  "502": { description: "The registrar service is temporarily unavailable.", content: { "application/json": { schema: { $ref: "#/components/schemas/PublicDomainSearchError" } } } },
};
const publicDomainSearchGet = {
  servers: publicDomainSearchServers,
  security: [],
  tags: ["Domain Search"],
  summary: "Check public domain availability",
  description: "Unauthenticated public search. Send one domain with `domain` or `q`, or up to 20 domains with repeated `domain`/`domains` parameters or a comma-separated `domains` value. The allowance is 20 requests per client IP in a rolling 60-second window; one bulk request counts as one request.",
  parameters: publicDomainSearchParameters,
  responses: publicDomainSearchResponses,
};
const publicDomainSearchPost = {
  servers: publicDomainSearchServers,
  security: [],
  tags: ["Domain Search"],
  summary: "Check public domain availability in bulk",
  description: "Unauthenticated public search. Send an array of up to 20 domains, or one scalar `domain`, `domainName` or `q` value. One bulk request counts as one request against the client IP allowance.",
  requestBody: publicDomainSearchRequestBody,
  responses: publicDomainSearchResponses,
};

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "KmerHosting API",
    version: "v1",
    description: "Public API for resources owned by the authenticated KmerHosting account. Sensitive infrastructure operations require an explicit scope, an IPv4 allowlist and an idempotency key. Provider credentials, purchases and account administration remain unavailable.",
  },
  servers: [{ url: "https://api.kmerhosting.com", description: "Production" }],
  security: [{ bearerAuth: [] }],
  tags: [{ name: "Account" }, { name: "Services" }, { name: "Domains" }, { name: "Domain Search" }, { name: "Email Hosting" }, { name: "Shared Hosting" }, { name: "LXC" }, { name: "KVM" }, { name: "ConvertSuite" }],
  paths: {
    "/health": { get: { security: [], summary: "API health", responses: { "200": { description: "Healthy" } } } },
    "/api/domain-search": { get: { ...publicDomainSearchGet }, post: { ...publicDomainSearchPost } },
    "/api/domain/domain-search-fast": { get: { ...publicDomainSearchGet }, post: { ...publicDomainSearchPost } },
    "/v1/account": { get: { tags: ["Account"], summary: "Get the authenticated account", description: "Requires `account:read`.", responses: { "200": response("Account"), "401": { $ref: "#/components/responses/Error" } } } },
    "/v1/account/api-usage": { get: { tags: ["Account"], summary: "List API request activity", description: "Requires `account:usage:read`. Includes product and non-product operations, status, route, operation id and client IPv4.", responses: { "200": response("API usage") } } },
    "/v1/convertsuite/tools": { get: { tags: ["ConvertSuite"], summary: "List ConvertSuite tools", description: "Requires `convertsuite:read`. Available to API-key and OAuth credentials with the ConvertSuite capability.", responses: { "200": response("ConvertSuite tools"), "401": { $ref: "#/components/responses/Error" }, "403": { $ref: "#/components/responses/Error" } } } },
    "/v1/convertsuite/prepare-upload": { post: { tags: ["ConvertSuite"], parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Prepare a ConvertSuite processing job", "convertsuite:process", { type: "object", required: ["tool", "files"], additionalProperties: false, properties: { tool: { type: "string", description: "Tool ID returned by /v1/convertsuite/tools." }, options: { type: "object", additionalProperties: true }, files: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", required: ["originalName", "mimeType", "sizeBytes"], additionalProperties: false, properties: { originalName: { type: "string", minLength: 1, maxLength: 255 }, mimeType: { type: "string", minLength: 1, maxLength: 160 }, sizeBytes: { type: "integer", minimum: 1, maximum: 52428800 }, checksum: { type: ["string", "null"], maxLength: 128 } } } } } }, "One operation is reserved for each successful REST processing call; polling, starting and cancelling a job do not reserve additional operations."), "402": { $ref: "#/components/responses/Error" } } },
    "/v1/convertsuite/jobs/{jobId}": { get: { tags: ["ConvertSuite"], summary: "Get a ConvertSuite job", description: "Requires `convertsuite:read`. The response includes signed upload/download URLs where applicable.", parameters: [{ ...id, name: "jobId" }], responses: { "200": response("ConvertSuite job"), "404": { $ref: "#/components/responses/Error" } } } },
    "/v1/convertsuite/jobs/{jobId}/start": { post: { tags: ["ConvertSuite"], parameters: [{ ...id, name: "jobId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Start a ConvertSuite job", "convertsuite:process", { type: "object", additionalProperties: false }, "Job started") } },
    "/v1/convertsuite/jobs/{jobId}/cancel": { post: { tags: ["ConvertSuite"], parameters: [{ ...id, name: "jobId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Cancel a ConvertSuite job", "convertsuite:process", { type: "object", additionalProperties: false }, "Job cancelled") } },
    "/v1/services": { get: { tags: ["Services"], summary: "List all customer services", description: "Requires `services:read`.", responses: { "200": response("Services") } } },
    "/v1/services/{serviceId}": { get: { tags: ["Services"], summary: "Get one customer service", description: "Requires `services:read`.", parameters: [{ ...id, name: "serviceId" }], responses: { "200": response("Service"), "404": { $ref: "#/components/responses/Error" } } } },
    "/v1/domains": { get: { tags: ["Domains"], summary: "List owned domains", description: "Requires `domains:read`.", responses: { "200": response("Domains") } } },
    "/v1/domains/{domainId}": { get: { tags: ["Domains"], summary: "Get an owned domain", description: "Requires `domains:read`.", parameters: [{ ...id, name: "domainId" }], responses: { "200": response("Domain"), "404": { $ref: "#/components/responses/Error" } } } },
    "/v1/domains/{domainId}/auto-renew": { put: { tags: ["Domains"], parameters: [{ ...id, name: "domainId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Set domain auto-renew", "domains:write", { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } } }) } },
    "/v1/domains/{domainId}/nameservers": { put: { tags: ["Domains"], parameters: [{ ...id, name: "domainId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Queue a nameserver update", "domains:write", { type: "object", required: ["nameServers"], properties: { nameServers: { type: "array", minItems: 2, maxItems: 13, items: { type: "string", minLength: 1 } } } }, "Queued") } },
    "/v1/domains/{domainId}/dns": {
      get: { tags: ["Domains"], summary: "List DNS records", description: "Requires `domains:read`.", parameters: [{ ...id, name: "domainId" }], responses: { "200": response("DNS records") } },
      post: { tags: ["Domains"], parameters: [{ ...id, name: "domainId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Queue a DNS record creation", "domains:dns:write", { type: "object", required: ["type"], anyOf: [{ required: ["content"] }, { required: ["contents"] }], properties: { name: { type: "string", default: "@" }, type: { type: "string", enum: ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"] }, content: { type: "string" }, contents: { type: "array", minItems: 1, items: { type: "string" } }, ttl: { type: "integer", minimum: 1, maximum: 86400, default: 3600 }, priority: { type: ["integer", "null"] } } }, "Queued") },
    },
    "/v1/domains/{domainId}/dns/{recordId}": {
      put: { tags: ["Domains"], parameters: [{ ...id, name: "domainId" }, { ...id, name: "recordId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Queue a DNS record update", "domains:dns:write", { type: "object", minProperties: 1, properties: { name: { type: "string" }, type: { type: "string", enum: ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"] }, content: { type: "string" }, contents: { type: "array", minItems: 1, items: { type: "string" } }, ttl: { type: "integer", minimum: 1, maximum: 86400 }, priority: { type: ["integer", "null"] } } }, "Queued") },
      delete: { tags: ["Domains"], parameters: [{ ...id, name: "domainId" }, { ...id, name: "recordId" }, { $ref: "#/components/parameters/IdempotencyKey" }], summary: "Queue DNS record deletion", description: "Requires `domains:dns:write` and a unique `Idempotency-Key` header.", responses: { "200": response("Queued"), "409": { $ref: "#/components/responses/Error" } } },
    },
    "/v1/email/services": { get: { tags: ["Email Hosting"], summary: "List owned email hosting services", description: "Requires `email:read`.", responses: { "200": response("Email services") } } },
    "/v1/email/services/{serviceId}/provision": { post: { tags: ["Email Hosting"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Provision an owned email service", "email:write", { type: "object", additionalProperties: false }) } },
    "/v1/email/services/{serviceId}/dns/sync": { post: { tags: ["Email Hosting"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Synchronize email service DNS", "email:write", { type: "object", additionalProperties: false }) } },
    "/v1/hosting/services": { get: { tags: ["Shared Hosting"], summary: "List owned shared-hosting services", description: "Requires `hosting:read`.", responses: { "200": response("Shared hosting services") } } },
    "/v1/hosting/services/{serviceId}/stats": { get: { tags: ["Shared Hosting"], summary: "Get provider-neutral service statistics", description: "Requires `hosting:read`. DirectAdmin and cPanel are selected automatically.", parameters: [{ ...id, name: "serviceId" }], responses: { "200": response("Hosting statistics") } } },
    "/v1/hosting/services/{serviceId}/panel-access": { post: { tags: ["Shared Hosting"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Create a temporary hosting panel link", "hosting:panel:access", { type: "object", properties: { target: { type: "string", enum: ["panel", "filemanager"], default: "panel" } } }, "Panel access link"), description: "Requires the `hosting:panel:access` scope and a unique `Idempotency-Key` header. For Free Hosting, successful panel or File Manager link creation records qualifying activity. An inactivity-suspended Free Hosting service can be automatically reactivated before its deletion deadline; other suspended or terminated services remain unavailable." } },
    "/v1/lxc/instances": { get: { tags: ["LXC"], summary: "List owned LXC instances", description: "Requires `lxc:read`.", responses: { "200": response("LXC instances") } } },
    "/v1/lxc/instances/{serviceId}": { get: { tags: ["LXC"], summary: "Get LXC instance details", description: "Requires `lxc:read`.", parameters: [{ ...id, name: "serviceId" }], responses: { "200": response("LXC instance") } } },
    "/v1/lxc/instances/{serviceId}/metrics": { get: { tags: ["LXC"], summary: "Get LXC metrics for the last 24 hours", description: "Requires `lxc:read`.", parameters: [{ ...id, name: "serviceId" }], responses: { "200": response("LXC metrics") } } },
    "/v1/lxc/instances/{serviceId}/actions": { post: { tags: ["LXC"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Control an LXC instance", "lxc:power:write", { type: "object", required: ["action"], properties: { action: { type: "string", enum: ["start", "restart", "freeze", "stop"] } } }) } },
    "/v1/lxc/instances/{serviceId}/snapshots": { get: { tags: ["LXC"], summary: "List LXC snapshots", description: "Requires `lxc:read`.", parameters: [{ ...id, name: "serviceId" }], responses: { "200": response("LXC snapshots") } }, post: { tags: ["LXC"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Create, delete or restore an LXC snapshot", "lxc:snapshots:write", { type: "object", required: ["action", "name"], properties: { action: { type: "string", enum: ["create", "delete", "restore"] }, name: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,47}$" } } }) } },
    "/v1/lxc/instances/{serviceId}/password": { post: { tags: ["LXC"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Change the LXC root password", "lxc:credentials:write", { type: "object", required: ["password"], additionalProperties: false, properties: { password: { type: "string", minLength: 10, maxLength: 128, writeOnly: true } } }) } },
    "/v1/lxc/instances/{serviceId}/reinstall": { post: { tags: ["LXC"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Erase and reinstall an LXC instance", "lxc:reinstall", { type: "object", required: ["distribution"], additionalProperties: false, properties: { distribution: { type: "string", minLength: 1, maxLength: 80 } } }, "Reinstallation queued") } },
    "/v1/lxc/instances/{serviceId}/terminal-ticket": { post: { tags: ["LXC"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Create a short-lived LXC terminal ticket", "lxc:terminal:access", { type: "object", additionalProperties: false }, "Terminal ticket valid for 60 seconds") } },
    "/v1/lxc/instances/{serviceId}/auto-renew": { put: { tags: ["LXC"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Set LXC auto-renew", "lxc:subscription:write", { type: "object", required: ["enabled"], additionalProperties: false, properties: { enabled: { type: "boolean" } } }) } },
    "/v1/lxc/instances/{serviceId}/billing-period": { put: { tags: ["LXC"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Set the LXC billing period", "lxc:subscription:write", { type: "object", required: ["billingMonths"], additionalProperties: false, properties: { billingMonths: { type: "integer", enum: [1, 3, 6, 12] } } }) } },
    "/v1/kvm/instances": { get: { tags: ["KVM"], summary: "List owned KVM instances", description: "Requires `kvm:read`.", responses: { "200": response("KVM instances") } } },
    "/v1/kvm/instances/{serviceId}": { get: { tags: ["KVM"], summary: "Get KVM details", description: "Requires `kvm:read`.", parameters: [{ ...id, name: "serviceId" }], responses: { "200": response("KVM details") } } },
    "/v1/kvm/instances/{serviceId}/actions": { post: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Control a KVM instance", "kvm:power:write", { type: "object", required: ["action"], properties: { action: { type: "string", enum: ["start", "stop", "shutdown", "restart"] } } }) } },
    "/v1/kvm/instances/{serviceId}/auto-renew": { put: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Set KVM auto-renew", "kvm:subscription:write", { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } } }) } },
    "/v1/kvm/instances/{serviceId}/password": { post: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Reset the KVM root password", "kvm:credentials:write", { type: "object", required: ["password"], properties: { password: { type: "string", minLength: 8, maxLength: 128, writeOnly: true } } }) } },
    "/v1/kvm/instances/{serviceId}/renew": { post: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Renew a KVM instance", "kvm:subscription:write", { type: "object", properties: { billingMonths: { type: "integer", enum: [1, 3, 6, 12] } } }) } },
    "/v1/kvm/instances/{serviceId}/cancel": { post: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Schedule KVM cancellation", "kvm:subscription:write", { type: "object", additionalProperties: false }) } },
    "/v1/kvm/instances/{serviceId}/keep-service": { post: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Keep a KVM service and revoke cancellation", "kvm:subscription:write", { type: "object", additionalProperties: false }) } },
    "/v1/kvm/instances/{serviceId}/snapshots": {
      get: { tags: ["KVM"], summary: "List KVM snapshots", description: "Requires `kvm:read`.", parameters: [{ ...id, name: "serviceId" }], responses: { "200": response("Snapshots") } },
      post: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Create a KVM snapshot", "kvm:snapshots:write", { type: "object", required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 30, pattern: "^[A-Za-z0-9 -]+$" }, description: { type: "string", maxLength: 255 } } }) },
    },
    "/v1/kvm/instances/{serviceId}/snapshots/{snapshotId}": {
      patch: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { in: "path", name: "snapshotId", required: true, schema: { type: "string", maxLength: 160 } }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Update a KVM snapshot", "kvm:snapshots:write", { type: "object", minProperties: 1, properties: { name: { type: "string", minLength: 1, maxLength: 30, pattern: "^[A-Za-z0-9 -]+$" }, description: { type: "string", maxLength: 255 } } }) },
      delete: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { in: "path", name: "snapshotId", required: true, schema: { type: "string", maxLength: 160 } }, { $ref: "#/components/parameters/IdempotencyKey" }], summary: "Delete a KVM snapshot", description: "Requires `kvm:snapshots:write` and a unique `Idempotency-Key` header.", responses: { "200": response("Snapshot deleted"), "409": { $ref: "#/components/responses/Error" } } },
    },
    "/v1/kvm/instances/{serviceId}/snapshots/rollback": { post: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Rollback a KVM snapshot", "kvm:snapshots:write", { type: "object", required: ["snapshotId"], properties: { snapshotId: { type: "string", maxLength: 160 } } }) } },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "KMERHOSTING_API_KEY or OAuth access token", description: "`Authorization: Bearer kh_live_...` or a user-scoped `kh_oauth_...` token." } },
    parameters: { IdempotencyKey: { in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" } } },
    schemas: {
      Envelope: { type: "object", required: ["data", "request_id"], properties: { data: {}, request_id: { type: "string", format: "uuid" } } },
      Error: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message", "request_id"], properties: { code: { type: "string" }, message: { type: "string" }, request_id: { type: "string", format: "uuid" } } } } },
      PublicDomainSearchError: { type: "object", required: ["error", "message"], properties: { error: { type: "string", examples: ["search_rate_limited"] }, message: { type: "string" } } },
      PublicDomainProviderAttribute: { type: "object", required: ["key", "options", "isRequired"], properties: { key: { type: "string" }, type: { type: "string" }, options: { type: "array", items: { type: "string" } }, isRequired: { type: "boolean" }, description: { type: "string" } } },
      PublicDomainCatalogPrice: { type: "object", required: ["tld", "registration_price_usd", "renewal_price_usd", "transfer_price_usd"], properties: { tld: { type: "string", examples: [".com"] }, popular: { type: "boolean" }, is_promo: { type: "boolean" }, registration_price_usd: { type: ["number", "null"] }, renewal_price_usd: { type: ["number", "null"] }, transfer_price_usd: { type: ["number", "null"] }, restore_price_usd: { type: ["number", "null"] }, min_years: { type: "integer" }, max_years: { type: "integer" }, registration_periods: { type: "array", items: { type: "integer" } }, renewal_periods: { type: "array", items: { type: "integer" } }, transfer_periods: { type: "array", items: { type: "integer" } }, supports_privacy: { type: "boolean" }, provider_attributes: { type: "array", items: { $ref: "#/components/schemas/PublicDomainProviderAttribute" } } } },
      PublicDomainRegistrarResult: { type: "object", required: ["domainName", "available", "isAvailable", "status", "availabilitySource"], properties: { domainName: { type: "string" }, available: { type: "boolean" }, isAvailable: { type: "boolean" }, status: { type: "string", enum: ["available", "unavailable", "unknown", "unsupported"] }, isPremium: { type: "boolean" }, customerPriceUsd: { type: ["number", "null"] }, availabilitySource: { type: "string", enum: ["ote", "production"] }, error: { type: ["string", "null"] } } },
      PublicDomainSearchResult: { type: "object", required: ["domainName", "registrar", "price"], properties: { domainName: { type: "string" }, registrar: { $ref: "#/components/schemas/PublicDomainRegistrarResult" }, price: { anyOf: [{ $ref: "#/components/schemas/PublicDomainCatalogPrice" }, { type: "null" }] } } },
      PublicDomainSearchResponse: { type: "object", required: ["results", "bulkSearch", "availabilitySource", "registrarEnvironment", "requested", "accepted", "invalid", "unsupported", "generatedAt"], properties: { results: { type: "array", maxItems: 20, items: { $ref: "#/components/schemas/PublicDomainSearchResult" } }, bulkSearch: { type: "boolean" }, availabilitySource: { type: "string", enum: ["ote", "production"] }, registrarEnvironment: { type: "string", enum: ["ote", "production"] }, requested: { type: "integer" }, accepted: { type: "integer", maximum: 20 }, invalid: { type: "array", items: { type: "string" } }, unsupported: { type: "integer" }, generatedAt: { type: "string", format: "date-time" } } },
    },
    responses: { Error: { description: "API error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
  },
} as const;

type OpenApiOperation = { operationId?: string };
const httpMethods = new Set(["get", "post", "put", "patch", "delete"]);
for (const [path, pathItem] of Object.entries(openapi.paths)) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!httpMethods.has(method)) continue;
    (operation as OpenApiOperation).operationId = `${method}_${path}`
      .replace(/[{}]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  }
}
