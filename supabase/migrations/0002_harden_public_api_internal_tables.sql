-- Apply after 0001 on installations that already created the internal API tables.
-- Only the VPS gateway's service-role key can call the RPC functions below.

alter table public.dashboard_api_key_rate_limits enable row level security;
alter table public.dashboard_api_idempotency_keys enable row level security;

alter table public.dashboard_api_keys
  alter column scopes set default array['account:read','services:read','domains:read','email:read','hosting:read','vps:read']::text[];

-- Upgrade only the legacy default scope set. Explicitly scoped customer keys stay unchanged.
update public.dashboard_api_keys
set scopes = array['account:read','services:read','domains:read','email:read','hosting:read','vps:read']::text[]
where scopes = array['account:read','services:read','domains:read','email:read','vps:read']::text[];
