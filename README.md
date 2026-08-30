# KmerHosting API

Public, versioned API gateway for KmerHosting customer resources.

## What is implemented in v1

- `GET /health`
- `GET /openapi.json` and Swagger UI at `GET /docs`
- `GET /v1/account`
- `GET /v1/services` and `GET /v1/services/{serviceId}`
- `GET /v1/domains`
- `GET /v1/email/services`
- `GET /v1/vps/instances`
- Domain auto-renew, nameserver and DNS-record management
- Email service provisioning and DNS synchronization
- Shared-hosting statistics and short-lived DirectAdmin access links
- LXC VPS lifecycle actions, auto-renew and snapshot management

Every customer route requires `Authorization: Bearer $KMERHOSTING_API_KEY`. Every mutation also requires an `Idempotency-Key`. The API intentionally omits passwords, provider credentials, internal administration routes, billing, purchases, service cancellation, VPS rebuilds, transfers, ownership changes and rollback operations.

## Deploy on the VPS

1. Apply `supabase/migrations/0001_public_api_keys.sql` in the KmerHosting Supabase project.
2. Configure the same random `KMERHOSTING_GATEWAY_SECRET` in the VPS environment and in the `domain-api`, `eh-mail-api`, `hosting-api-gateway` and `dashboard-kvm-provider` Supabase Edge Functions. It must be at least 32 characters and must never be sent to a client.
3. Deploy the corresponding product backend commits before enabling public API write scopes.
4. Clone the repository to `/opt/kmerhosting-api`, run `bun install`, and copy `.env.example` to `/etc/kmerhosting-api.env` with the real values. Set file mode `0600`.
5. Create the dedicated `kmerapi` system user, install `deploy/kmerhosting-api.service`, then enable it with `systemctl enable --now kmerhosting-api`.
6. Install `deploy/nginx/api.kmerhosting.com.conf`, obtain the TLS certificate with Certbot, test with `nginx -t`, then reload Nginx.

The service listens on `127.0.0.1:8787`; do not open that port publicly. Nginx is the only public entry point.

## Example

```bash
export KMERHOSTING_API_KEY='kh_live_...'
curl --fail-with-body https://api.kmerhosting.com/v1/services \
  -H "Authorization: Bearer $KMERHOSTING_API_KEY"
```

## Scopes

The migration gives existing keys read-only scopes: `account:read`, `services:read`, `domains:read`, `email:read`, `hosting:read`, and `vps:read`. The Dashboard lets customers choose narrowly scoped keys for the supported actions. Do not create broad keys for browser code.
