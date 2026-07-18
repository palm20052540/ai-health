create schema if not exists extensions;
create schema if not exists vault;

create extension if not exists pgcrypto;
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create table if not exists public.health_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  oauth_scope text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.health_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  data_type text not null,
  value jsonb not null,
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_metrics_user_data_type_recorded_source_key
    unique (user_id, data_type, recorded_at, source)
);

create table if not exists public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  run_at timestamptz not null default now(),
  status text not null check (status in ('success', 'error')),
  error_message text,
  records_synced integer not null default 0,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_health_tokens_updated_at on public.health_tokens;
create trigger set_health_tokens_updated_at
before update on public.health_tokens
for each row execute function public.set_updated_at();

drop trigger if exists set_health_metrics_updated_at on public.health_metrics;
create trigger set_health_metrics_updated_at
before update on public.health_metrics
for each row execute function public.set_updated_at();

alter table public.health_tokens enable row level security;
alter table public.health_metrics enable row level security;
alter table public.sync_logs enable row level security;

drop policy if exists "Users can read own health tokens" on public.health_tokens;
create policy "Users can read own health tokens"
on public.health_tokens
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own health metrics" on public.health_metrics;
create policy "Users can read own health metrics"
on public.health_metrics
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own sync logs" on public.sync_logs;
create policy "Users can read own sync logs"
on public.sync_logs
for select
to authenticated
using ((select auth.uid()) = user_id);

grant select on public.health_tokens to authenticated;
grant select on public.health_metrics to authenticated;
grant select on public.sync_logs to authenticated;

grant select, insert, update, delete on public.health_tokens to service_role;
grant select, insert, update, delete on public.health_metrics to service_role;
grant select, insert, update, delete on public.sync_logs to service_role;

select cron.unschedule('sync-health-data-every-30-minutes')
where exists (
  select 1
  from cron.job
  where jobname = 'sync-health-data-every-30-minutes'
);

select cron.schedule(
  'sync-health-data-every-30-minutes',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'health_project_url') || '/functions/v1/sync-health-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'health_sync_shared_secret')
    ),
    body := jsonb_build_object('source', 'pg_cron', 'scheduled_at', now())
  ) as request_id;
  $$
);
