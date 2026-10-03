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
  select
    r.activity_date,
    r.steps,
    r.active_zone_minutes,
    r.is_complete_day
  from public.health_activity_daily_rollups r
  where r.user_id = p_user_id
    and r.activity_date between p_since_date and p_until_date
  order by r.activity_date;
$function$;

revoke all on function public.get_health_activity_daily_since(uuid, date, date) from public;
revoke all on function public.get_health_activity_daily_since(uuid, date, date) from anon;
revoke all on function public.get_health_activity_daily_since(uuid, date, date) from authenticated;
grant execute on function public.get_health_activity_daily_since(uuid, date, date) to service_role;
