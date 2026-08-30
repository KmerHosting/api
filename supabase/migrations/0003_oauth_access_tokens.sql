-- OAuth credentials used by the remote MCP server. Tokens are opaque and only
-- their SHA-256 digests are stored. The dashboard OAuth function is the only
-- component that issues or revokes them.
create table if not exists public.dashboard_oauth_access_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  user_id uuid not null references public.dashboard_users(id) on delete cascade,
  token_hash text not null unique,
  scopes text[] not null default '{}'::text[],
  rate_limit_per_minute integer not null default 60 check (rate_limit_per_minute between 1 and 600),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

alter table public.dashboard_oauth_access_tokens enable row level security;

create index if not exists dashboard_oauth_access_tokens_user_idx
  on public.dashboard_oauth_access_tokens(user_id, created_at desc);

create table if not exists public.dashboard_oauth_token_rate_limits (
  oauth_token_id uuid not null references public.dashboard_oauth_access_tokens(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (oauth_token_id, window_start)
);

alter table public.dashboard_oauth_token_rate_limits enable row level security;

create or replace function public.consume_dashboard_oauth_rate_limit(p_token_id uuid, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  granted boolean;
begin
  insert into public.dashboard_oauth_token_rate_limits as rate_limit (oauth_token_id, window_start, request_count)
  values (p_token_id, date_trunc('minute', now()), 1)
  on conflict (oauth_token_id, window_start) do update
    set request_count = rate_limit.request_count + 1
    where rate_limit.request_count < p_limit
  returning true into granted;
  return coalesce(granted, false);
end;
$$;

revoke all on function public.consume_dashboard_oauth_rate_limit(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_dashboard_oauth_rate_limit(uuid, integer) to service_role;

create table if not exists public.dashboard_oauth_usage (
  id bigint generated always as identity primary key,
  oauth_token_id uuid not null references public.dashboard_oauth_access_tokens(id) on delete cascade,
  user_id uuid not null references public.dashboard_users(id) on delete cascade,
  request_id text not null,
  operation text not null,
  status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.dashboard_oauth_usage enable row level security;
create index if not exists dashboard_oauth_usage_user_created_idx
  on public.dashboard_oauth_usage(user_id, created_at desc);

create table if not exists public.dashboard_oauth_idempotency_keys (
  oauth_token_id uuid not null references public.dashboard_oauth_access_tokens(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (oauth_token_id, operation, idempotency_key)
);

alter table public.dashboard_oauth_idempotency_keys enable row level security;

create or replace function public.claim_dashboard_oauth_idempotency_key(
  p_oauth_token_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.dashboard_oauth_idempotency_keys;
  inserted boolean := false;
begin
  insert into public.dashboard_oauth_idempotency_keys (oauth_token_id, operation, idempotency_key, request_hash)
  values (p_oauth_token_id, p_operation, p_idempotency_key, p_request_hash)
  on conflict do nothing
  returning true into inserted;
  if inserted then return jsonb_build_object('state', 'created'); end if;

  select * into existing from public.dashboard_oauth_idempotency_keys
  where oauth_token_id = p_oauth_token_id and operation = p_operation and idempotency_key = p_idempotency_key;
  if existing.request_hash <> p_request_hash then return jsonb_build_object('state', 'conflict'); end if;
  if existing.response_body is not null then
    return jsonb_build_object('state', 'replay', 'response_status', existing.response_status, 'response_body', existing.response_body);
  end if;
  if existing.created_at < now() - interval '5 minutes' then
    delete from public.dashboard_oauth_idempotency_keys
    where oauth_token_id = p_oauth_token_id and operation = p_operation and idempotency_key = p_idempotency_key;
    insert into public.dashboard_oauth_idempotency_keys (oauth_token_id, operation, idempotency_key, request_hash)
    values (p_oauth_token_id, p_operation, p_idempotency_key, p_request_hash);
    return jsonb_build_object('state', 'created');
  end if;
  return jsonb_build_object('state', 'pending');
end;
$$;

create or replace function public.complete_dashboard_oauth_idempotency_key(
  p_oauth_token_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_response_status integer,
  p_response_body jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dashboard_oauth_idempotency_keys
  set response_status = p_response_status, response_body = p_response_body, completed_at = now()
  where oauth_token_id = p_oauth_token_id and operation = p_operation and idempotency_key = p_idempotency_key;
end;
$$;

revoke all on function public.claim_dashboard_oauth_idempotency_key(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_dashboard_oauth_idempotency_key(uuid, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.claim_dashboard_oauth_idempotency_key(uuid, text, text, text) to service_role;
grant execute on function public.complete_dashboard_oauth_idempotency_key(uuid, text, text, integer, jsonb) to service_role;
