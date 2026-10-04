-- Chat-only compact source reader. No changes to existing source records or cron.
-- It is callable only by the existing server-side service role.
create or replace function public.get_chat_training_evidence(
  p_user_id uuid, p_workout_id text default null, p_routine_id text default null, p_live_routine jsonb default null
) returns jsonb language plpgsql stable security invoker set search_path = '' as $function$
declare
  v_target public.hevy_workouts%rowtype;
  v_routine public.hevy_routines%rowtype;
  v_anchor timestamptz;
  v_catalog jsonb;
  v_result jsonb;
begin
  if p_workout_id is not null and p_routine_id is not null then
    raise exception 'Choose a workout or routine, not both';
  end if;
  if p_routine_id is null then
    select * into v_target from public.hevy_workouts
    where user_id = p_user_id and deleted_at is null and end_time >= start_time and end_time <= statement_timestamp()
      and (p_workout_id is null or id = p_workout_id)
    order by start_time desc, id limit 1;
    if not found then return null; end if;
    v_anchor := v_target.start_time;
    select coalesce(jsonb_agg(jsonb_build_object('exercise_index',e.exercise_index,
      'exercise_template_id',e.exercise_template_id,'title',e.title) order by e.exercise_index),'[]'::jsonb)
    into v_catalog from public.hevy_workout_exercises e
    where e.user_id=p_user_id and e.workout_id=v_target.id;
  else
    -- Caller is service_role; the Edge Function fetched this compact catalog
    -- from the fixed Hevy API, rather than trusting an old routine-cache timestamp.
    if p_live_routine is null or p_live_routine->>'id'<>p_routine_id
      or jsonb_typeof(p_live_routine->'exercises') is distinct from 'array' then return null; end if;
    v_routine.id:=p_routine_id;v_routine.title:=p_live_routine->>'title';
    v_anchor := statement_timestamp();
    v_catalog:=p_live_routine->'exercises';
  end if;
  with window_workouts as materialized (
    select w.id,w.title,w.start_time,w.end_time from public.hevy_workouts w
    where w.user_id=p_user_id and w.deleted_at is null and w.end_time is not null
      and (w.id=v_target.id or w.start_time >= v_anchor-interval '30 days' and w.start_time < v_anchor)
      and (w.id=v_target.id or exists(select 1 from jsonb_array_elements(
        case when jsonb_typeof(w.raw_payload->'exercises')='array' then w.raw_payload->'exercises' else '[]'::jsonb end) x
        where x->>'exercise_template_id' in (select c->>'exercise_template_id' from jsonb_array_elements(v_catalog) c)))
    order by w.start_time desc,w.id limit 101
  ), picked_exercises as materialized (
    select e.workout_id,e.exercise_index,e.exercise_template_id,e.title
    from public.hevy_workout_exercises e join window_workouts w on w.id=e.workout_id
    where e.user_id=p_user_id and (e.workout_id=v_target.id or e.exercise_template_id in
      (select x->>'exercise_template_id' from jsonb_array_elements(v_catalog) x))
    order by e.workout_id,e.exercise_index limit 1501
  ), picked_sets as materialized (
    select s.workout_id,s.exercise_index,s.set_index,s.set_type,s.weight_kg,s.reps,s.rpe,
      s.distance_meters,s.duration_seconds
    from public.hevy_workout_sets s join picked_exercises e
      on e.workout_id=s.workout_id and e.exercise_index=s.exercise_index
    where s.user_id=p_user_id order by s.workout_id,s.exercise_index,s.set_index limit 10001
  ) select jsonb_build_object(
    'mode',case when p_routine_id is null then 'workout' else 'routine' end,
    'target',case when p_routine_id is null then jsonb_build_object('id',v_target.id,'title',v_target.title,
      'start_time',v_target.start_time,'end_time',v_target.end_time) else null end,
    'routine',case when p_routine_id is null then null else jsonb_build_object('id',v_routine.id,'title',v_routine.title,'fetched_at',p_live_routine->>'fetched_at') end,
    'anchor_at',v_anchor,'catalog',v_catalog,
    'last_success_at',(select last_success_at from public.hevy_sync_state where user_id=p_user_id and resource='workouts'),
    'workouts',coalesce((select jsonb_agg(to_jsonb(w) order by w.start_time,w.id) from window_workouts w),'[]'::jsonb),
    'exercises',coalesce((select jsonb_agg(to_jsonb(e)) from picked_exercises e),'[]'::jsonb),
    'sets',coalesce((select jsonb_agg(to_jsonb(s)) from picked_sets s),'[]'::jsonb),
    'incomplete',exists(select 1 from window_workouts w where not public.chat_workout_is_complete(p_user_id,w.id)),
    'truncated',(select count(*)>100 from window_workouts) or (select count(*)>1500 from picked_exercises)
      or (select count(*)>10000 from picked_sets) or jsonb_array_length(v_catalog)>100
  ) into v_result;
  return v_result;
end;
$function$;
revoke all on function public.get_chat_training_evidence(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.get_chat_training_evidence(uuid,text,text,jsonb) to service_role;

create or replace function public.get_chat_recovery_evidence(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $function$
  with observations as materialized (
    select data_type,recorded_at,synced_at,
      case data_type when 'sleep' then value #> '{sleep,summary,minutesAsleep}'
        when 'daily-heart-rate-variability' then value #> '{dailyHeartRateVariability,averageHeartRateVariabilityMilliseconds}'
        else value #> '{dailyRestingHeartRate,beatsPerMinute}' end as value,
      case when data_type='sleep' then value #> '{sleep,summary,stagesSummary}' else null end as stages,
      case when data_type='sleep' then value #> '{sleep,interval}' else null end as interval
    from public.health_metrics where user_id=p_user_id
      and data_type in ('sleep','daily-heart-rate-variability','daily-resting-heart-rate')
      and recorded_at >= statement_timestamp()-interval '28 days' and recorded_at <= statement_timestamp()
    order by recorded_at,data_type limit 301
  ) select jsonb_build_object('period_days',28,'generated_at',statement_timestamp(),
    'truncated',(select count(*)>300 from observations),
    'records',coalesce((select jsonb_agg(to_jsonb(o)) from observations o),'[]'::jsonb));
$function$;
revoke all on function public.get_chat_recovery_evidence(uuid) from public,anon,authenticated;
grant execute on function public.get_chat_recovery_evidence(uuid) to service_role;

-- Native event registration owns these secrets. Never expose these rows to clients.
create table public.hevy_chat_subscriptions (
  id text primary key, user_id uuid not null, site_owner_id text not null,
  callback_url text not null, signing_secret text not null, previous_secret text,
  rotation_until timestamptz, verified_at timestamptz not null,
  activated_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null
);
create table public.hevy_chat_events (
  user_id uuid not null,workout_id text not null,event_id text not null unique,
  occurred_at timestamptz not null default clock_timestamp(),
  chat_status text not null default 'pending' check(chat_status in ('pending','claimed','sent')),
  claim_token uuid,claim_until timestamptz,message_id text,
  primary key(user_id,workout_id)
);
create table public.hevy_chat_deliveries (
  subscription_id text not null references public.hevy_chat_subscriptions(id) on delete cascade,
  event_id text not null references public.hevy_chat_events(event_id),
  status text not null default 'pending' check(status in ('pending','accepted','terminal')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,lease_until timestamptz,
  primary key(subscription_id,event_id)
);
alter table public.hevy_chat_subscriptions enable row level security;
alter table public.hevy_chat_events enable row level security;
alter table public.hevy_chat_deliveries enable row level security;
revoke all on public.hevy_chat_subscriptions,public.hevy_chat_events,public.hevy_chat_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.hevy_chat_subscriptions,public.hevy_chat_events,public.hevy_chat_deliveries to service_role;
create index hevy_chat_due on public.hevy_chat_deliveries(next_attempt_at) where status='pending';
create index hevy_chat_new_workouts on public.hevy_workouts(user_id,created_at) where deleted_at is null;

create or replace function public.save_chat_subscription(p_user_id uuid,p_owner_id text,p_id text,p_url text,p_secret text,p_expires_at timestamptz)
returns void language plpgsql security invoker set search_path='' as $function$
declare previous public.hevy_chat_subscriptions%rowtype; stamp timestamptz:=clock_timestamp(); n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into previous from public.hevy_chat_subscriptions where id=p_id for update;
  if found and (previous.user_id<>p_user_id or previous.site_owner_id<>p_owner_id) then raise exception 'Owner mismatch'; end if;
  select count(*) into n from public.hevy_chat_subscriptions where user_id=p_user_id and expires_at>stamp and id<>p_id;
  if n>=4 or p_expires_at<=stamp or p_expires_at>stamp+interval '7 days' then raise exception 'Subscription limit'; end if;
  if previous.expires_at<=stamp then delete from public.hevy_chat_deliveries where subscription_id=p_id; end if;
  insert into public.hevy_chat_subscriptions(id,user_id,site_owner_id,callback_url,signing_secret,previous_secret,rotation_until,verified_at,activated_at,expires_at)
    values(p_id,p_user_id,p_owner_id,p_url,p_secret,
      case when previous.signing_secret is distinct from p_secret then previous.signing_secret when previous.rotation_until>stamp then previous.previous_secret else null end,
      case when previous.signing_secret is distinct from p_secret then stamp+interval '5 minutes' when previous.rotation_until>stamp then previous.rotation_until else null end,
      stamp,case when previous.expires_at>stamp then previous.activated_at else stamp end,p_expires_at)
    on conflict(id) do update set callback_url=excluded.callback_url,signing_secret=excluded.signing_secret,
      previous_secret=excluded.previous_secret,rotation_until=excluded.rotation_until,verified_at=excluded.verified_at,
      activated_at=excluded.activated_at,expires_at=excluded.expires_at;
end;
$function$;
revoke all on function public.save_chat_subscription(uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.save_chat_subscription(uuid,text,text,text,text,timestamptz) to service_role;

-- A header insertion alone is not completion: importer replaces children afterward.
-- Verify the stored child payloads and normalized measurement columns against the
-- header's full Hevy payload in one database snapshot. Malformed data fails closed.
create or replace function public.chat_workout_is_complete(p_user_id uuid,p_workout_id text)
returns boolean language plpgsql stable security invoker set search_path='' as $function$
declare w public.hevy_workouts%rowtype; ex jsonb; se jsonb; ei integer; si integer; n integer;
begin
  select * into w from public.hevy_workouts where user_id=p_user_id and id=p_workout_id and deleted_at is null;
  if not found or w.end_time is null or w.end_time<w.start_time or w.end_time>statement_timestamp()
    or jsonb_typeof(w.raw_payload->'exercises') is distinct from 'array'
    or jsonb_array_length(w.raw_payload->'exercises') not between 1 and 100 then return false; end if;
  select count(*) into n from public.hevy_workout_exercises where user_id=p_user_id and workout_id=p_workout_id;
  if n<>jsonb_array_length(w.raw_payload->'exercises') then return false; end if;
  for ex,ei in select value,coalesce((value->>'index')::integer,(ordinality-1)::integer) from jsonb_array_elements(w.raw_payload->'exercises') with ordinality loop
    if not exists(select 1 from public.hevy_workout_exercises e where e.user_id=p_user_id and e.workout_id=p_workout_id and e.exercise_index=ei
      and e.raw_payload=ex and e.exercise_template_id is not distinct from ex->>'exercise_template_id') then return false; end if;
    if jsonb_typeof(ex->'sets') is distinct from 'array' or jsonb_array_length(ex->'sets')>300 then return false; end if;
    select count(*) into n from public.hevy_workout_sets where user_id=p_user_id and workout_id=p_workout_id and exercise_index=ei;
    if n<>jsonb_array_length(ex->'sets') then return false; end if;
    for se,si in select value,coalesce((value->>'index')::integer,(ordinality-1)::integer) from jsonb_array_elements(ex->'sets') with ordinality loop
      if not exists(select 1 from public.hevy_workout_sets s where s.user_id=p_user_id and s.workout_id=p_workout_id and s.exercise_index=ei and s.set_index=si
        and s.raw_payload=se and s.weight_kg is not distinct from (se->>'weight_kg')::numeric
        and s.reps is not distinct from (se->>'reps')::integer and s.rpe is not distinct from (se->>'rpe')::numeric
        and s.distance_meters is not distinct from (se->>'distance_meters')::numeric
        and s.duration_seconds is not distinct from (se->>'duration_seconds')::integer
        and s.set_type is not distinct from se->>'type') then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$function$;
revoke all on function public.chat_workout_is_complete(uuid,text) from public,anon,authenticated;
grant execute on function public.chat_workout_is_complete(uuid,text) to service_role;

-- One successful-import marker, not one event per set or row. No HTTP in the DB.
create or replace function public.queue_completed_chat_workouts()
returns trigger language plpgsql security invoker set search_path='' as $function$
declare first_activation timestamptz;
begin
  if new.resource<>'workouts' or new.last_success_at is null then return new; end if;
  if tg_op='UPDATE' and new.last_success_at is not distinct from old.last_success_at then return new; end if;
  select min(activated_at) into first_activation from public.hevy_chat_subscriptions where user_id=new.user_id and expires_at>clock_timestamp();
  if first_activation is null then return new; end if;
  insert into public.hevy_chat_events(user_id,workout_id,event_id)
    select w.user_id,w.id,'evt_'||encode(sha256(convert_to(w.user_id::text||':'||w.id,'UTF8')),'hex')
    from public.hevy_workouts w where w.user_id=new.user_id and w.deleted_at is null
      and w.created_at>=first_activation and w.end_time>=first_activation and w.synced_at<=new.last_success_at
      and not exists(select 1 from public.hevy_chat_events e where e.user_id=w.user_id and e.workout_id=w.id)
      and public.chat_workout_is_complete(w.user_id,w.id)
    on conflict(user_id,workout_id) do nothing;
  insert into public.hevy_chat_deliveries(subscription_id,event_id)
    select s.id,e.event_id from public.hevy_chat_events e join public.hevy_workouts w on w.user_id=e.user_id and w.id=e.workout_id
    join public.hevy_chat_subscriptions s on s.user_id=e.user_id
    where e.user_id=new.user_id and e.chat_status<>'sent' and e.occurred_at>clock_timestamp()-interval '7 days' and s.expires_at>clock_timestamp()
      and w.created_at>=s.activated_at and w.end_time>=s.activated_at and w.deleted_at is null
    on conflict(subscription_id,event_id) do nothing;
  return new;
exception when query_canceled or others then
  -- Recap infrastructure must not break an otherwise completed health import.
  -- The next existing import marker rescans unqueued candidates, even on no-op.
  raise warning 'Workout recap queue deferred';
  return new;
end;
$function$;
revoke all on function public.queue_completed_chat_workouts() from public,anon,authenticated;
grant execute on function public.queue_completed_chat_workouts() to service_role;
create trigger hevy_chat_after_completed_import after insert or update of last_success_at on public.hevy_sync_state
for each row execute function public.queue_completed_chat_workouts();

create or replace function public.claim_chat_event_deliveries(p_user_id uuid,p_limit integer default 4)
returns setof jsonb language plpgsql security invoker set search_path='' as $function$
declare r record; token uuid;
begin
  for r in select d.subscription_id,d.event_id,e.workout_id,e.occurred_at,s.callback_url,s.signing_secret,s.previous_secret,s.rotation_until
    from public.hevy_chat_deliveries d join public.hevy_chat_events e using(event_id)
    join public.hevy_chat_subscriptions s on s.id=d.subscription_id
    join public.hevy_workouts w on w.id=e.workout_id and w.user_id=e.user_id
    where e.user_id=p_user_id and s.user_id=p_user_id and s.expires_at>clock_timestamp()
      and d.status='pending' and d.attempts<8 and d.next_attempt_at<=clock_timestamp()
      and (d.lease_until is null or d.lease_until<clock_timestamp()) and w.deleted_at is null
      and e.occurred_at>clock_timestamp()-interval '7 days' and e.occurred_at>=s.activated_at
      and w.created_at>=s.activated_at and w.end_time>=s.activated_at and public.chat_workout_is_complete(w.user_id,w.id)
    order by e.occurred_at limit least(greatest(p_limit,1),4) for update of d skip locked
  loop
    token:=gen_random_uuid();
    update public.hevy_chat_deliveries set lease_token=token,lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1
      where subscription_id=r.subscription_id and event_id=r.event_id;
    return next to_jsonb(r)||jsonb_build_object('lease_token',token);
  end loop;
end;
$function$;
revoke all on function public.claim_chat_event_deliveries(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_chat_event_deliveries(uuid,integer) to service_role;

create or replace function public.finish_chat_event_delivery(p_user_id uuid,p_subscription_id text,p_event_id text,p_lease_token uuid,p_result text)
returns boolean language plpgsql security invoker set search_path='' as $function$
declare n integer;
begin
  if p_result not in ('accepted','terminal','retry') then return false; end if;
  update public.hevy_chat_deliveries d set status=case when p_result='retry' then 'pending' else p_result end,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(21600,60*power(2,least(d.attempts,8))::integer)),lease_until=null,lease_token=null
    where d.subscription_id=p_subscription_id and d.event_id=p_event_id and d.lease_token=p_lease_token
      and exists(select 1 from public.hevy_chat_events e where e.event_id=d.event_id and e.user_id=p_user_id);
  get diagnostics n=row_count; return n=1;
end;
$function$;
revoke all on function public.finish_chat_event_delivery(uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_chat_event_delivery(uuid,text,text,uuid,text) to service_role;

create or replace function public.claim_chat_recap(p_user_id uuid,p_owner_id text,p_event_id text)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare e public.hevy_chat_events%rowtype; token uuid;
begin
  select * into e from public.hevy_chat_events where user_id=p_user_id and event_id=p_event_id for update;
  if not found or not exists(select 1 from public.hevy_chat_deliveries d join public.hevy_chat_subscriptions s on s.id=d.subscription_id
    where d.event_id=p_event_id and s.user_id=p_user_id and s.site_owner_id=p_owner_id and s.expires_at>clock_timestamp()
      and e.occurred_at>=s.activated_at) then return jsonb_build_object('status','unavailable'); end if;
  if e.chat_status='sent' then return jsonb_build_object('status','already_sent','messageId',e.message_id); end if;
  if e.claim_until>clock_timestamp() then return jsonb_build_object('status','processing'); end if;
  if not public.chat_workout_is_complete(p_user_id,e.workout_id) then return jsonb_build_object('status','unavailable'); end if;
  token:=gen_random_uuid();
  update public.hevy_chat_events set chat_status='claimed',claim_token=token,claim_until=clock_timestamp()+interval '10 minutes'
    where user_id=p_user_id and event_id=p_event_id;
  return jsonb_build_object('status','claimed','claimToken',token,'workoutId',e.workout_id,'expiresAt',clock_timestamp()+interval '10 minutes');
end;
$function$;
revoke all on function public.claim_chat_recap(uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_chat_recap(uuid,text,text) to service_role;

create or replace function public.mark_chat_recap_sent(p_user_id uuid,p_owner_id text,p_event_id text,p_claim_token uuid,p_message_id text)
returns boolean language plpgsql security invoker set search_path='' as $function$
declare n integer;
begin
  if length(p_message_id) not between 1 and 200 then return false; end if;
  update public.hevy_chat_events e set chat_status='sent',message_id=p_message_id,claim_until=null
    where e.user_id=p_user_id and e.event_id=p_event_id and e.claim_token=p_claim_token
      and (e.chat_status<>'sent' or e.message_id=p_message_id)
      and exists(select 1 from public.hevy_chat_deliveries d join public.hevy_chat_subscriptions s on s.id=d.subscription_id
        where d.event_id=e.event_id and s.user_id=p_user_id and s.site_owner_id=p_owner_id);
  get diagnostics n=row_count; return n=1;
end;
$function$;
revoke all on function public.mark_chat_recap_sent(uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.mark_chat_recap_sent(uuid,text,text,uuid,text) to service_role;
