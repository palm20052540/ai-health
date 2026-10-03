create table if not exists public.health_activity_daily_rollups (
  user_id uuid not null,
  activity_date date not null,
  steps bigint,
  active_zone_minutes integer,
  is_complete_day boolean not null,
  computed_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);

alter table public.health_activity_daily_rollups enable row level security;

revoke all on table public.health_activity_daily_rollups from public;
revoke all on table public.health_activity_daily_rollups from anon;
revoke all on table public.health_activity_daily_rollups from authenticated;
grant select, insert, update, delete on table public.health_activity_daily_rollups to service_role;

create or replace function public.refresh_health_activity_daily_rollup(
  p_user_id uuid,
  p_activity_date date
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  affected integer;
begin
  with step_ranked as (
    select
      date_trunc('hour', hm.recorded_at)
        + floor(extract(minute from hm.recorded_at) / 30)::integer * interval '30 minutes' as interval_start,
      (hm.value #>> '{steps,countSum}')::numeric as steps,
      row_number() over (
        partition by date_trunc('hour', hm.recorded_at)
          + floor(extract(minute from hm.recorded_at) / 30)::integer * interval '30 minutes'
        order by hm.synced_at desc, hm.updated_at desc, hm.recorded_at desc
      ) as rn
    from public.health_metrics hm
    where hm.user_id = p_user_id
      and hm.data_type = 'steps'
      and hm.recorded_at >= (p_activity_date::timestamp at time zone 'Asia/Bangkok')
      and hm.recorded_at < ((p_activity_date + 1)::timestamp at time zone 'Asia/Bangkok')
      and (hm.value #>> '{steps,countSum}') is not null
  ),
  azm_ranked as (
    select
      date_trunc('hour', hm.recorded_at)
        + floor(extract(minute from hm.recorded_at) / 30)::integer * interval '30 minutes' as interval_start,
      coalesce((hm.value #>> '{activeZoneMinutes,sumInFatBurnHeartZone}')::numeric, 0)
        + coalesce((hm.value #>> '{activeZoneMinutes,sumInCardioHeartZone}')::numeric, 0)
        + coalesce((hm.value #>> '{activeZoneMinutes,sumInPeakHeartZone}')::numeric, 0) as minutes,
      row_number() over (
        partition by date_trunc('hour', hm.recorded_at)
          + floor(extract(minute from hm.recorded_at) / 30)::integer * interval '30 minutes'
        order by hm.synced_at desc, hm.updated_at desc, hm.recorded_at desc
      ) as rn
    from public.health_metrics hm
    where hm.user_id = p_user_id
      and hm.data_type = 'active-zone-minutes'
      and hm.recorded_at >= (p_activity_date::timestamp at time zone 'Asia/Bangkok')
      and hm.recorded_at < ((p_activity_date + 1)::timestamp at time zone 'Asia/Bangkok')
  ),
  totals as (
    select
      (select sum(s.steps)::bigint from step_ranked s where s.rn = 1) as steps,
      (select sum(a.minutes)::integer from azm_ranked a where a.rn = 1) as active_zone_minutes
  )
  insert into public.health_activity_daily_rollups (
    user_id, activity_date, steps, active_zone_minutes, is_complete_day, computed_at
  )
  select
    p_user_id,
    p_activity_date,
    t.steps,
    t.active_zone_minutes,
    p_activity_date < (now() at time zone 'Asia/Bangkok')::date,
    now()
  from totals t
  where t.steps is not null or t.active_zone_minutes is not null
  on conflict (user_id, activity_date) do update
    set steps = excluded.steps,
        active_zone_minutes = excluded.active_zone_minutes,
        is_complete_day = excluded.is_complete_day,
        computed_at = excluded.computed_at;

  get diagnostics affected = row_count;
  return affected;
end;
$function$;

revoke all on function public.refresh_health_activity_daily_rollup(uuid, date) from public;
revoke all on function public.refresh_health_activity_daily_rollup(uuid, date) from anon;
revoke all on function public.refresh_health_activity_daily_rollup(uuid, date) from authenticated;
grant execute on function public.refresh_health_activity_daily_rollup(uuid, date) to service_role;
