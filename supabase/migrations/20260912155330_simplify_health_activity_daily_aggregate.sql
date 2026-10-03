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
  with filtered as (
    select hm.data_type, hm.recorded_at, hm.value
    from public.health_metrics hm
    where hm.user_id = p_user_id
      and hm.data_type in ('steps', 'active-zone-minutes')
      and hm.recorded_at >= (p_since_date::timestamp at time zone 'Asia/Bangkok')
      and hm.recorded_at < ((p_until_date + 1)::timestamp at time zone 'Asia/Bangkok')
  ),
  daily as (
    select
      (f.recorded_at at time zone 'Asia/Bangkok')::date as activity_date,
      sum(
        case when f.data_type = 'steps'
          then coalesce((f.value #>> '{steps,countSum}')::numeric, 0)
          else 0 end
      )::bigint as steps,
      sum(
        case when f.data_type = 'active-zone-minutes' then
          coalesce((f.value #>> '{activeZoneMinutes,sumInFatBurnHeartZone}')::numeric, 0)
          + coalesce((f.value #>> '{activeZoneMinutes,sumInCardioHeartZone}')::numeric, 0)
          + coalesce((f.value #>> '{activeZoneMinutes,sumInPeakHeartZone}')::numeric, 0)
        else 0 end
      )::integer as active_zone_minutes
    from filtered f
    group by (f.recorded_at at time zone 'Asia/Bangkok')::date
  )
  select
    d.activity_date,
    d.steps,
    d.active_zone_minutes,
    d.activity_date < (now() at time zone 'Asia/Bangkok')::date as is_complete_day
  from daily d
  order by d.activity_date;
$function$;

revoke all on function public.get_health_activity_daily_since(uuid, date, date) from public;
revoke all on function public.get_health_activity_daily_since(uuid, date, date) from anon;
revoke all on function public.get_health_activity_daily_since(uuid, date, date) from authenticated;
grant execute on function public.get_health_activity_daily_since(uuid, date, date) to service_role;
