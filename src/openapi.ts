const id = { in: "path", required: true, schema: { type: "string", format: "uuid" } } as const;
const json = (schema: Record<string, unknown>) => ({ required: true, content: { "application/json": { schema } } });
const response = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } });
const mutation = (summary: string, scope: string, body: Record<string, unknown>, description = "Accepted") => ({
  summary,
  description: `Requires the \`${scope}\` scope and a unique \`Idempotency-Key\` header.`,
  requestBody: json(body),
  responses: { "200": response(description), "201": response(description), "202": response(description), "400": { $ref: "#/components/responses/Error" }, "401": { $ref: "#/components/responses/Error" }, "403": { $ref: "#/components/responses/Error" }, "409": { $ref: "#/components/responses/Error" } },
});

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "KmerHosting API",
    version: "v1",
    description: "Public API for resources owned by the authenticated KmerHosting account. Provider credentials, billing, purchases, account administration, destructive service operations and secrets are intentionally unavailable.",
  },
  servers: [{ url: "https://api.kmerhosting.com", description: "Production" }],
  security: [{ bearerAuth: [] }],
  tags: [{ name: "Account" }, { name: "Services" }, { name: "Domains" }, { name: "Email Hosting" }, { name: "Shared Hosting" }, { name: "LXC" }, { name: "KVM" }],
  paths: {
    "/health": { get: { security: [], summary: "API health", responses: { "200": { description: "Healthy" } } } },
    "/v1/account": { get: { tags: ["Account"], summary: "Get the authenticated account", description: "Requires `account:read`.", responses: { "200": response("Account"), "401": { $ref: "#/components/responses/Error" } } } },
    "/v1/account/api-usage": { get: { tags: ["Account"], summary: "List API request activity", description: "Requires `account:usage:read`. Includes product and non-product operations, status, route, operation id and client IPv4.", responses: { "200": response("API usage") } } },
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
    "/v1/hosting/services/{serviceId}/panel-access": { post: { tags: ["Shared Hosting"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Create a temporary hosting panel link", "hosting:panel:access", { type: "object", properties: { target: { type: "string", enum: ["panel", "filemanager"], default: "panel" } } }) } },
    "/v1/lxc/instances": { get: { tags: ["LXC"], summary: "List owned LXC instances", description: "Requires `lxc:read`.", responses: { "200": response("LXC instances") } } },
    "/v1/lxc/instances/{serviceId}": { get: { tags: ["LXC"], summary: "Get LXC instance details", description: "Requires `lxc:read`.", parameters: [{ ...id, name: "serviceId" }], responses: { "200": response("LXC instance") } } },
    "/v1/lxc/instances/{serviceId}/metrics": { get: { tags: ["LXC"], summary: "Get LXC metrics for the last 24 hours", description: "Requires `lxc:read`.", parameters: [{ ...id, name: "serviceId" }], responses: { "200": response("LXC metrics") } } },
    "/v1/lxc/instances/{serviceId}/actions": { post: { tags: ["LXC"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Control an LXC instance", "lxc:power:write", { type: "object", required: ["action"], properties: { action: { type: "string", enum: ["start", "restart", "freeze", "stop"] } } }) } },
    "/v1/lxc/instances/{serviceId}/snapshots": { get: { tags: ["LXC"], summary: "List LXC snapshots", description: "Requires `lxc:read`.", parameters: [{ ...id, name: "serviceId" }], responses: { "200": response("LXC snapshots") } }, post: { tags: ["LXC"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Create, delete or restore an LXC snapshot", "lxc:snapshots:write", { type: "object", required: ["action", "name"], properties: { action: { type: "string", enum: ["create", "delete", "restore"] }, name: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,47}$" } } }) } },
    "/v1/kvm/instances": { get: { tags: ["KVM"], summary: "List owned KVM instances", description: "Requires `kvm:read`.", responses: { "200": response("KVM instances") } } },
    "/v1/kvm/instances/{serviceId}": { get: { tags: ["KVM"], summary: "Get KVM details", description: "Requires `kvm:read`.", parameters: [{ ...id, name: "serviceId" }], responses: { "200": response("KVM details") } } },
    "/v1/kvm/instances/{serviceId}/actions": { post: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Control a KVM instance", "kvm:power:write", { type: "object", required: ["action"], properties: { action: { type: "string", enum: ["start", "stop", "shutdown", "restart"] } } }) } },
    "/v1/kvm/instances/{serviceId}/auto-renew": { put: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Set KVM auto-renew", "kvm:subscription:write", { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } } }) } },
    "/v1/kvm/instances/{serviceId}/snapshots": {
      get: { tags: ["KVM"], summary: "List KVM snapshots", description: "Requires `kvm:read`.", parameters: [{ ...id, name: "serviceId" }], responses: { "200": response("Snapshots") } },
      post: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Create a KVM snapshot", "kvm:snapshots:write", { type: "object", required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 30, pattern: "^[A-Za-z0-9 -]+$" }, description: { type: "string", maxLength: 255 } } }) },
    },
    "/v1/kvm/instances/{serviceId}/snapshots/{snapshotId}": {
      patch: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { in: "path", name: "snapshotId", required: true, schema: { type: "string", maxLength: 160 } }, { $ref: "#/components/parameters/IdempotencyKey" }], ...mutation("Update a KVM snapshot", "kvm:snapshots:write", { type: "object", minProperties: 1, properties: { name: { type: "string", minLength: 1, maxLength: 30, pattern: "^[A-Za-z0-9 -]+$" }, description: { type: "string", maxLength: 255 } } }) },
      delete: { tags: ["KVM"], parameters: [{ ...id, name: "serviceId" }, { in: "path", name: "snapshotId", required: true, schema: { type: "string", maxLength: 160 } }, { $ref: "#/components/parameters/IdempotencyKey" }], summary: "Delete a KVM snapshot", description: "Requires `kvm:snapshots:write` and a unique `Idempotency-Key` header.", responses: { "200": response("Snapshot deleted"), "409": { $ref: "#/components/responses/Error" } } },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "KMERHOSTING_API_KEY or OAuth access token", description: "`Authorization: Bearer kh_live_...` or a user-scoped `kh_oauth_...` token." } },
    parameters: { IdempotencyKey: { in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" } } },
    schemas: {
      Envelope: { type: "object", required: ["data", "request_id"], properties: { data: {}, request_id: { type: "string", format: "uuid" } } },
      Error: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message", "request_id"], properties: { code: { type: "string" }, message: { type: "string" }, request_id: { type: "string", format: "uuid" } } } } },
    },
    responses: { Error: { description: "API error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
  },
} as const;
