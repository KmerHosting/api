# KmerHosting API

A simple server-side API for managing your KmerHosting services.

[![API](https://img.shields.io/badge/API-v1-161616)](https://api.kmerhosting.com/docs)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-Swagger-85ea2d)](https://api.kmerhosting.com/openapi.json)

## Get started

Explore the API with Swagger:

[api.kmerhosting.com/docs](https://api.kmerhosting.com/docs)

## Authentication

For server-to-server integrations, send a KmerHosting API key. Remote MCP clients use the user-scoped OAuth access token issued by the KmerHosting Dashboard.

```bash
export KMERHOSTING_API_KEY="kh_live_..."

curl https://api.kmerhosting.com/v1/services \
  -H "Authorization: Bearer $KMERHOSTING_API_KEY"
```

Keep API keys on your server. Never use them in browser code, mobile apps, repositories or logs. OAuth tokens are short-lived, user-scoped and revocable from the admin console.

## Available resources

- Account, API activity and services
- Domains, DNS and nameservers
- Email Hosting
- Shared Hosting
- LXC VPS inventory, metrics, power, snapshots, credentials, reinstall, terminal tickets and subscription settings
- Existing KVM VPS inventory, power, credentials, lifecycle and snapshots
- ConvertSuite tools and REST processing jobs (Pro and Business ConvertSuite plans)

Supported actions are limited to resources owned by the authenticated account.

## Safe requests

Every write request requires an idempotency key:

```bash
curl -X POST https://api.kmerhosting.com/v1/example \
  -H "Authorization: Bearer $KMERHOSTING_API_KEY" \
  -H "Idempotency-Key: a-unique-request-id"
```

API activity is available with the `account:usage:read` scope at `GET /v1/account/api-usage`; it includes product and non-product routes, operation IDs, statuses and source IPv4 values. Dangerous infrastructure operations require their dedicated scope and an API key restricted to trusted IPv4 addresses. Root-password values and temporary access secrets are accepted or returned only by their specific short-lived operation and are never stored in activity logs. The API does not expose provider credentials, purchases, transfers, ownership changes, raw provider proxies, or internal administration tools.

### ConvertSuite REST API

ConvertSuite REST processing is available to active Pro and Business ConvertSuite plans. API keys need the `convertsuite:read` and `convertsuite:process` capabilities. Start with `GET /v1/convertsuite/tools`, then call `POST /v1/convertsuite/prepare-upload` with an `Idempotency-Key`; upload the returned signed URLs, start the job, and poll `GET /v1/convertsuite/jobs/{jobId}`. A successful prepare call reserves exactly one ConvertSuite operation, regardless of the number of input files. Job status, start and cancel requests do not reserve additional operations.

The full contract, including every ConvertSuite route and schema, is available in [Swagger UI](https://api.kmerhosting.com/docs) and [OpenAPI](https://api.kmerhosting.com/openapi.json).

## Documentation

- [Swagger UI](https://api.kmerhosting.com/docs)
- [OpenAPI specification](https://api.kmerhosting.com/openapi.json)
- [SDKs](https://github.com/KmerHosting/sdk)
- [Issues](https://github.com/KmerHosting/api/issues)

## License

Proprietary. KmerHosting API access is subject to KmerHosting terms.


## Public domain availability search

Domain availability search is intentionally public and separate from authenticated account operations:

- `GET https://domain.kmerhosting.com/api/domain-search?domain=example.com`
- `GET https://domain.kmerhosting.com/api/domain-search?domains=example.com,example.org`
- `POST https://domain.kmerhosting.com/api/domain-search` with up to 20 domains

No API key is required. The operation is included in the OpenAPI document with an operation-level server pointing to `domain.kmerhosting.com`. The Domain customer UI is centralized in `https://dashboard.kmerhosting.com/domains/`; moving the legacy portal UI does not move or remove the public search API.
