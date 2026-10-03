drop function if exists public.get_health_activity_daily_since(uuid, date);

create or replace function public.get_health_activity_daily_since(
  p_user_id uuid,
  p_since_date date,
  p_until_date date
)
returns table (
  activity_date date,
  steps bigint,
  active_zone_minutes integer,
  is_complete_day boolean
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with step_ranked as (
    select
      hm.user_id,
      date_trunc('hour', hm.recorded_at)
        + floor(extract(minute from hm.recorded_at) / 30)::integer * interval '30 minutes' as interval_start,
      (hm.value #>> '{steps,countSum}')::numeric as steps,
      row_number() over (
        partition by hm.user_id,
          date_trunc('hour', hm.recorded_at)
            + floor(extract(minute from hm.recorded_at) / 30)::integer * interval '30 minutes'
        order by hm.synced_at desc, hm.updated_at desc, hm.recorded_at desc
      ) as rn
    from public.health_metrics hm
    where hm.user_id = p_user_id
      and hm.data_type = 'steps'
      and hm.recorded_at >= (p_since_date::timestamp at time zone 'Asia/Bangkok')
      and hm.recorded_at < ((p_until_date + 1)::timestamp at time zone 'Asia/Bangkok')
      and (hm.value #>> '{steps,countSum}') is not null
  ),
  steps_daily as (
    select
      sr.user_id,
      (sr.interval_start at time zone 'Asia/Bangkok')::date as activity_date,
      sum(sr.steps)::bigint as steps
    from step_ranked sr
    where sr.rn = 1
    group by sr.user_id, (sr.interval_start at time zone 'Asia/Bangkok')::date
  ),
  azm_ranked as (
    select
      hm.user_id,
      date_trunc('hour', hm.recorded_at)
        + floor(extract(minute from hm.recorded_at) / 30)::integer * interval '30 minutes' as interval_start,
      coalesce((hm.value #>> '{activeZoneMinutes,sumInFatBurnHeartZone}')::numeric, 0) as fat_burn_minutes,
      coalesce((hm.value #>> '{activeZoneMinutes,sumInCardioHeartZone}')::numeric, 0) as cardio_minutes,
      coalesce((hm.value #>> '{activeZoneMinutes,sumInPeakHeartZone}')::numeric, 0) as peak_minutes,
      row_number() over (
        partition by hm.user_id,
          date_trunc('hour', hm.recorded_at)
            + floor(extract(minute from hm.recorded_at) / 30)::integer * interval '30 minutes'
        order by hm.synced_at desc, hm.updated_at desc, hm.recorded_at desc
      ) as rn
    from public.health_metrics hm
    where hm.user_id = p_user_id
      and hm.data_type = 'active-zone-minutes'
      and hm.recorded_at >= (p_since_date::timestamp at time zone 'Asia/Bangkok')
      and hm.recorded_at < ((p_until_date + 1)::timestamp at time zone 'Asia/Bangkok')
  ),
  azm_daily as (
    select
      ar.user_id,
      (ar.interval_start at time zone 'Asia/Bangkok')::date as activity_date,
      sum(ar.fat_burn_minutes + ar.cardio_minutes + ar.peak_minutes)::integer as active_zone_minutes
    from azm_ranked ar
    where ar.rn = 1
    group by ar.user_id, (ar.interval_start at time zone 'Asia/Bangkok')::date
  )
  select
    coalesce(s.activity_date, a.activity_date) as activity_date,
    s.steps,
    a.active_zone_minutes,
    coalesce(s.activity_date, a.activity_date)
      < (now() at time zone 'Asia/Bangkok')::date as is_complete_day
  from steps_daily s
  full join azm_daily a
    on a.user_id = s.user_id
    and a.activity_date = s.activity_date
  where coalesce(s.activity_date, a.activity_date) >= p_since_date
    and coalesce(s.activity_date, a.activity_date) <= p_until_date
  order by activity_date;
$function$;

revoke all on function public.get_health_activity_daily_since(uuid, date, date) from public;
revoke all on function public.get_health_activity_daily_since(uuid, date, date) from anon;
revoke all on function public.get_health_activity_daily_since(uuid, date, date) from authenticated;
grant execute on function public.get_health_activity_daily_since(uuid, date, date) to service_role;
