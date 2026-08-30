-- Run this migration before deploying the API gateway. Existing keys receive read-only scopes.
alter table public.dashboard_api_keys
  add column if not exists scopes text[] not null default array['account:read','services:read','domains:read','email:read','vps:read']::text[],
  add column if not exists rate_limit_per_minute integer not null default 60;

alter table public.dashboard_api_keys
  drop constraint if exists dashboard_api_keys_rate_limit_per_minute_check;

alter table public.dashboard_api_keys
  add constraint dashboard_api_keys_rate_limit_per_minute_check
  check (rate_limit_per_minute between 1 and 600);

create table if not exists public.dashboard_api_key_rate_limits (
  api_key_id uuid not null references public.dashboard_api_keys(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (api_key_id, window_start)
);

create or replace function public.consume_dashboard_api_key_rate_limit(p_api_key_id uuid, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  granted boolean;
begin
  insert into public.dashboard_api_key_rate_limits as rate_limit (api_key_id, window_start, request_count)
  values (p_api_key_id, date_trunc('minute', now()), 1)
  on conflict (api_key_id, window_start) do update
    set request_count = rate_limit.request_count + 1
    where rate_limit.request_count < p_limit
  returning true into granted;

  return coalesce(granted, false);
end;
$$;

revoke all on function public.consume_dashboard_api_key_rate_limit(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_dashboard_api_key_rate_limit(uuid, integer) to service_role;

create table if not exists public.dashboard_api_idempotency_keys (
  api_key_id uuid not null references public.dashboard_api_keys(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (api_key_id, operation, idempotency_key)
);

create or replace function public.claim_dashboard_api_idempotency_key(
  p_api_key_id uuid,
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
  existing public.dashboard_api_idempotency_keys;
  inserted boolean := false;
begin
  insert into public.dashboard_api_idempotency_keys (api_key_id, operation, idempotency_key, request_hash)
  values (p_api_key_id, p_operation, p_idempotency_key, p_request_hash)
  on conflict do nothing
  returning true into inserted;

  if inserted then
    return jsonb_build_object('state', 'created');
  end if;

  select * into existing
  from public.dashboard_api_idempotency_keys
  where api_key_id = p_api_key_id and operation = p_operation and idempotency_key = p_idempotency_key;

  if existing.request_hash <> p_request_hash then
    return jsonb_build_object('state', 'conflict');
  end if;
  if existing.response_body is not null then
    return jsonb_build_object('state', 'replay', 'response_status', existing.response_status, 'response_body', existing.response_body);
  end if;
  if existing.created_at < now() - interval '5 minutes' then
    delete from public.dashboard_api_idempotency_keys
      where api_key_id = p_api_key_id and operation = p_operation and idempotency_key = p_idempotency_key;
    insert into public.dashboard_api_idempotency_keys (api_key_id, operation, idempotency_key, request_hash)
    values (p_api_key_id, p_operation, p_idempotency_key, p_request_hash);
    return jsonb_build_object('state', 'created');
  end if;
  return jsonb_build_object('state', 'pending');
end;
$$;

create or replace function public.complete_dashboard_api_idempotency_key(
  p_api_key_id uuid,
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
  update public.dashboard_api_idempotency_keys
  set response_status = p_response_status, response_body = p_response_body, completed_at = now()
  where api_key_id = p_api_key_id and operation = p_operation and idempotency_key = p_idempotency_key;
end;
$$;

revoke all on function public.claim_dashboard_api_idempotency_key(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_dashboard_api_idempotency_key(uuid, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.claim_dashboard_api_idempotency_key(uuid, text, text, text) to service_role;
grant execute on function public.complete_dashboard_api_idempotency_key(uuid, text, text, integer, jsonb) to service_role;
