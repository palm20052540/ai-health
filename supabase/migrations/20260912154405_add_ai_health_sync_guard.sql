create table if not exists public.ai_health_sync_guards (
  user_id uuid not null,
  source text not null,
  last_started_at timestamptz not null default now(),
  last_completed_at timestamptz,
  status text not null default 'in_progress',
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (user_id, source),
  constraint ai_health_sync_guards_source_check
    check (source in ('hevy', 'google_health')),
  constraint ai_health_sync_guards_status_check
    check (status in ('in_progress', 'success', 'error'))
);

alter table public.ai_health_sync_guards enable row level security;

revoke all on table public.ai_health_sync_guards from public;
revoke all on table public.ai_health_sync_guards from anon;
revoke all on table public.ai_health_sync_guards from authenticated;
grant select, insert, update, delete on table public.ai_health_sync_guards to service_role;

create or replace function public.try_acquire_ai_health_sync(
  p_user_id uuid,
  p_source text,
  p_cooldown_seconds integer default 900,
  p_stale_after_seconds integer default 300
)
returns table (
  acquired boolean,
  status text,
  retry_after_seconds integer
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  affected integer := 0;
  current_row public.ai_health_sync_guards%rowtype;
  now_at timestamptz := clock_timestamp();
begin
  if p_source not in ('hevy', 'google_health') then
    raise exception 'Unsupported sync source: %', p_source;
  end if;

  insert into public.ai_health_sync_guards (
    user_id, source, last_started_at, status, last_error, updated_at
  ) values (
    p_user_id, p_source, now_at, 'in_progress', null, now_at
  )
  on conflict (user_id, source) do update
    set last_started_at = excluded.last_started_at,
        status = 'in_progress',
        last_error = null,
        updated_at = excluded.updated_at
  where (
    public.ai_health_sync_guards.status = 'in_progress'
    and public.ai_health_sync_guards.last_started_at
      <= now_at - make_interval(secs => greatest(p_stale_after_seconds, 1))
  ) or (
    public.ai_health_sync_guards.status <> 'in_progress'
    and public.ai_health_sync_guards.last_started_at
      <= now_at - make_interval(secs => greatest(p_cooldown_seconds, 1))
  );

  get diagnostics affected = row_count;
  if affected = 1 then
    return query select true, 'acquired'::text, 0;
    return;
  end if;

  select * into current_row
  from public.ai_health_sync_guards g
  where g.user_id = p_user_id and g.source = p_source;

  if current_row.status = 'in_progress' then
    return query select false, 'in_progress'::text,
      greatest(1, ceil(extract(epoch from (
        current_row.last_started_at
          + make_interval(secs => greatest(p_stale_after_seconds, 1)) - now_at
      )))::integer);
  else
    return query select false, 'cooldown_active'::text,
      greatest(1, ceil(extract(epoch from (
        current_row.last_started_at
          + make_interval(secs => greatest(p_cooldown_seconds, 1)) - now_at
      )))::integer);
  end if;
end;
$function$;

revoke all on function public.try_acquire_ai_health_sync(uuid, text, integer, integer) from public;
revoke all on function public.try_acquire_ai_health_sync(uuid, text, integer, integer) from anon;
revoke all on function public.try_acquire_ai_health_sync(uuid, text, integer, integer) from authenticated;
grant execute on function public.try_acquire_ai_health_sync(uuid, text, integer, integer) to service_role;
