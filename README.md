# KmerHosting API

A simple server-side API for managing your KmerHosting services.

[![API](https://img.shields.io/badge/API-v1-161616)](https://api.kmerhosting.com/docs)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-Swagger-85ea2d)](https://api.kmerhosting.com/openapi.json)

## Get started

Explore the API with Swagger:

[api.kmerhosting.com/docs](https://api.kmerhosting.com/docs)

## Authentication

Send your KmerHosting API key with every request:

```bash
export KMERHOSTING_API_KEY="kh_live_..."

curl https://api.kmerhosting.com/v1/services \
  -H "Authorization: Bearer $KMERHOSTING_API_KEY"
```

Keep your key on your server. Never use it in browser code, mobile apps, repositories or logs.

## Available resources

- Account and services
- Domains, DNS and nameservers
- Email Hosting
- Shared Hosting
- LXC VPS
- Service status and details

Supported actions are limited to resources owned by the authenticated account.

## Safe requests

Every write request requires an idempotency key:

```bash
curl -X POST https://api.kmerhosting.com/v1/example \
  -H "Authorization: Bearer $KMERHOSTING_API_KEY" \
  -H "Idempotency-Key: a-unique-request-id"
```

The API does not expose passwords, provider credentials, billing operations, transfers, ownership changes, destructive infrastructure operations or internal administration tools.

## Documentation

- [Swagger UI](https://api.kmerhosting.com/docs)
- [OpenAPI specification](https://api.kmerhosting.com/openapi.json)
- [SDKs](https://github.com/KmerHosting/sdk)
- [Issues](https://github.com/KmerHosting/api/issues)

## License

Proprietary. KmerHosting API access is subject to KmerHosting terms.
