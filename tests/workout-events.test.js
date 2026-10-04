import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { workoutSubscriptionInput, workoutSubscriptionId, drainWorkoutEvents } from '../supabase/functions/hevy-actions/workoutEvents.ts';

const USER='11111111-1111-4111-8111-111111111111';
async function database(){
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table hevy_workouts(id text,user_id uuid,title text,start_time timestamptz,end_time timestamptz,deleted_at timestamptz,created_at timestamptz default now(),synced_at timestamptz default now(),raw_payload jsonb default '{}',primary key(id,user_id));
    create table hevy_workout_exercises(workout_id text,user_id uuid,exercise_index int,exercise_template_id text,title text,raw_payload jsonb default '{}');
    create table hevy_workout_sets(workout_id text,user_id uuid,exercise_index int,set_index int,set_type text,weight_kg numeric,reps int,rpe numeric,distance_meters numeric,duration_seconds int,raw_payload jsonb default '{}');
    create table hevy_routines(id text,user_id uuid,title text);
    create table hevy_routine_exercises(routine_id text,user_id uuid,exercise_index int,exercise_template_id text,title text);
    create table hevy_routine_sets(routine_id text,user_id uuid,exercise_index int,set_index int,set_type text,weight_kg numeric,reps int,rep_range_start int,rep_range_end int,rpe numeric);
    create table hevy_sync_state(user_id uuid,resource text,last_success_at timestamptz);
    create table health_metrics(user_id uuid,data_type text,recorded_at timestamptz,synced_at timestamptz,value jsonb);
    grant select,insert,update,delete on all tables in schema public to service_role;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261004113317_workout_recap_events.sql',import.meta.url),'utf8'));
  await db.exec('set role service_role');
  await db.query(`insert into hevy_chat_subscriptions(id,user_id,site_owner_id,callback_url,signing_secret,verified_at,activated_at,expires_at)
    values('sub_synthetic',$1,'owner','https://callback.example.test','synthetic-not-a-real-secret',now(),now()-interval '2 hours',now()+interval '1 day')`,[USER]);
  await db.query('insert into hevy_sync_state values($1,\'workouts\',null)',[USER]);
  return db;
}
const sourceSet={index:0,type:'normal',weight_kg:50,reps:10,rpe:8};
const sourceExercise={index:0,exercise_template_id:'press',title:'Synthetic press',sets:[sourceSet]};
async function workout(db,id,{children=true,old=false,preexisting=false}={}){
  await db.query(`insert into hevy_workouts(id,user_id,title,start_time,end_time,created_at,synced_at,raw_payload)
    values($1,$2,'Synthetic session',now()-interval '1 hour'-$3::interval,now()-interval '30 minutes'-$3::interval,
      now()-interval '5 minutes'-$4::interval,now()-interval '1 minute',$5)`,[id,USER,old?'3 days':'0 days',preexisting?'3 days':'0 days',{exercises:[sourceExercise]}]);
  if(children)await fillChildren(db,id);
}
async function fillChildren(db,id){
  await db.query('insert into hevy_workout_exercises values($1,$2,0,\'press\',\'Synthetic press\',$3)',[id,USER,sourceExercise]);
  await db.query('insert into hevy_workout_sets values($1,$2,0,0,\'normal\',50,10,8,null,null,$3)',[id,USER,sourceSet]);
}
async function finish(db){await db.query('update hevy_sync_state set last_success_at=clock_timestamp() where user_id=$1',[USER]);}
const count=async(db,table)=>(await db.query(`select count(*)::int as n from ${table}`)).rows[0].n;

test('completion marker queues once only after all source children match; no backlog or edits',async()=>{
  const db=await database();try{
    await workout(db,'partial',{children:false});await workout(db,'backfill',{old:true});await workout(db,'existing',{preexisting:true});
    await finish(db);assert.equal(await count(db,'hevy_chat_events'),0);
    await fillChildren(db,'partial');await finish(db);assert.equal(await count(db,'hevy_chat_events'),1);assert.equal(await count(db,'hevy_chat_deliveries'),1);
    await finish(db);await finish(db);assert.equal(await count(db,'hevy_chat_events'),1);
    await db.query('update hevy_workout_sets set rpe=9 where workout_id=\'partial\'');
    assert.equal((await db.query('select chat_workout_is_complete($1,\'partial\') as complete',[USER])).rows[0].complete,false);
    assert.equal((await db.query('select * from claim_chat_event_deliveries($1,4)',[USER])).rows.length,0);
  }finally{await db.close();}
});
test('two workouts have distinct durable events, delivery leases, replay dedupe and separate chat claims',async()=>{
  const db=await database();try{
    await workout(db,'first');await workout(db,'second');await finish(db);
    const events=(await db.query('select event_id,workout_id from hevy_chat_events order by workout_id')).rows;
    assert.equal(events.length,2);assert.notEqual(events[0].event_id,events[1].event_id);
    const claimed=(await db.query('select claim_chat_event_deliveries($1,4) as value',[USER])).rows.map(row=>row.value);
    assert.equal(claimed.length,2);assert.equal((await db.query('select * from claim_chat_event_deliveries($1,4)',[USER])).rows.length,0);
    const a=claimed[0];assert.equal((await db.query('select finish_chat_event_delivery($1,$2,$3,$4,\'accepted\') as done',[USER,a.subscription_id,a.event_id,a.lease_token])).rows[0].done,true);
    await finish(db);assert.equal(await count(db,'hevy_chat_deliveries'),2);
    assert.equal((await db.query('select claim_chat_recap($1,\'wrong\',$2) as result',[USER,events[0].event_id])).rows[0].result.status,'unavailable');
    const c=(await db.query('select claim_chat_recap($1,\'owner\',$2) as result',[USER,events[0].event_id])).rows[0].result;
    assert.equal(c.status,'claimed');assert.equal((await db.query('select claim_chat_recap($1,\'owner\',$2) as result',[USER,events[0].event_id])).rows[0].result.status,'processing');
    assert.equal((await db.query('select mark_chat_recap_sent($1,\'owner\',$2,$3,\'synthetic-message\') as done',[USER,events[0].event_id,c.claimToken])).rows[0].done,true);
    assert.equal((await db.query('select claim_chat_recap($1,\'owner\',$2) as result',[USER,events[0].event_id])).rows[0].result.status,'already_sent');
    assert.equal((await db.query('select claim_chat_recap($1,\'owner\',$2) as result',[USER,events[1].event_id])).rows[0].result.status,'claimed');
  }finally{await db.close();}
});
test('recap queue failure cannot roll back source success and a later no-op retries it',async()=>{
  const db=await database();try{
    await workout(db,'deferred');
    await db.exec('reset role; revoke insert on hevy_chat_events from service_role; set role service_role');
    await finish(db);
    assert.equal(await count(db,'hevy_chat_events'),0);
    assert.ok((await db.query('select last_success_at from hevy_sync_state')).rows[0].last_success_at);
    await db.exec('reset role; grant insert on hevy_chat_events to service_role; set role service_role');
    await finish(db);assert.equal(await count(db,'hevy_chat_events'),1);
  }finally{await db.close();}
});
test('expired/unsubscribed/deleted sources cannot deliver and metadata is private',async()=>{
  const db=await database();try{
    await workout(db,'new');await finish(db);await db.query('update hevy_workouts set deleted_at=now() where id=\'new\'');
    assert.equal((await db.query('select * from claim_chat_event_deliveries($1,4)',[USER])).rows.length,0);
    await db.query('update hevy_workouts set deleted_at=null where id=\'new\'');await db.exec("update hevy_chat_subscriptions set expires_at=now()-interval '1 second'");
    assert.equal((await db.query('select * from claim_chat_event_deliveries($1,4)',[USER])).rows.length,0);
    for(const role of ['anon','authenticated']){
      await db.exec(`reset role;set role ${role}`);
      for(const table of ['hevy_chat_subscriptions','hevy_chat_events','hevy_chat_deliveries'])await assert.rejects(()=>db.query(`select * from ${table}`),/permission denied/);
      await assert.rejects(()=>db.query('select * from claim_chat_event_deliveries($1,4)',[USER]),/permission denied/);
    }
  }finally{await db.close();}
});
test('an expired subscription restarts at now and never revives old pending notifications',async()=>{
  const db=await database();try{
    await workout(db,'old-queue');await finish(db);assert.equal(await count(db,'hevy_chat_deliveries'),1);
    await db.exec("update hevy_chat_subscriptions set expires_at=now()-interval '1 second'");
    await db.query("select save_chat_subscription($1,'owner','sub_synthetic','https://callback.example.test','new-synthetic-secret',now()+interval '1 day')",[USER]);
    assert.equal(await count(db,'hevy_chat_deliveries'),0);
    await finish(db);assert.equal(await count(db,'hevy_chat_deliveries'),0);
    assert.equal(await count(db,'hevy_chat_events'),1);
  }finally{await db.close();}
});
test('optional queue cancellation does not cancel completed source success',async()=>{
  const db=await database();try{
    await workout(db,'cancelled-queue');
    await db.exec(`reset role;create function fail_synthetic_queue() returns trigger language plpgsql as $$begin raise exception 'synthetic queue timeout' using errcode='57014';end;$$;
      create trigger synthetic_timeout before insert on hevy_chat_events for each row execute function fail_synthetic_queue();set role service_role;`);
    await finish(db);assert.ok((await db.query('select last_success_at from hevy_sync_state')).rows[0].last_success_at);
    assert.equal(await count(db,'hevy_chat_events'),0);
    await db.exec('reset role;drop trigger synthetic_timeout on hevy_chat_events;set role service_role');
    await finish(db);assert.equal(await count(db,'hevy_chat_events'),1);
  }finally{await db.close();}
});
test('subscription parser preserves bounded native scope and identity; no-op does no evidence/model work',async()=>{
  const params={name:'training.workout_completed',arguments:{},delivery:{mode:'webhook',url:'https://callback.example.test',secret:'whsec_'+btoa('synthetic-native-secret-material')},_meta:{version:'synthetic'}};
  assert.equal(workoutSubscriptionInput(params,true).ttl,86400000);
  assert.notEqual(await workoutSubscriptionId(USER,'owner',params.delivery.url),await workoutSubscriptionId(USER,'other',params.delivery.url));
  for(const bad of [{...params,arguments:{user_id:USER}},{...params,delivery:{...params.delivery,url:'http://callback.example.test'}},{...params,ttlMs:-1},{...params,_meta:'wrong'}])assert.throws(()=>workoutSubscriptionInput(bad,true));
  let queries=0;const db={rpc:async(name)=>{queries++;assert.equal(name,'claim_chat_event_deliveries');return {data:[],error:null};}};
  assert.deepEqual(await drainWorkoutEvents(db,USER,()=>{throw new Error('no callback on no-op');}),{accepted:0});assert.equal(queries,1);
});
