import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { buildChatTrainingEvidence, readChatTrainingEvidence } from '../supabase/functions/hevy-actions/chatEvidence.ts';

// Fabricated source tables, users and sessions only; no live service is contacted.
const USER='11111111-1111-4111-8111-111111111111', OTHER='22222222-2222-4222-8222-222222222222';
const NOW=Date.parse('2026-10-04T12:00:00Z'), AT='2026-10-04T10:00:00Z';
const SET=(workout_id,kg=50,rpe=8,type='normal')=>({workout_id,exercise_index:0,set_index:0,set_type:type,weight_kg:kg,reps:10,rpe});
function raw() {
  return {mode:'workout',anchor_at:AT,last_success_at:AT,target:{id:'today',title:'Synthetic session',start_time:AT,end_time:'2026-10-04T11:00:00Z'},
    catalog:[{exercise_index:0,exercise_template_id:'press',title:'Synthetic press'}],
    workouts:[{id:'today',start_time:AT,end_time:'2026-10-04T11:00:00Z'},{id:'old',start_time:'2026-09-04T10:00:00Z',end_time:'2026-09-04T11:00:00Z'}],
    exercises:['today','old'].map(workout_id=>({workout_id,exercise_index:0,exercise_template_id:'press',title:'Synthetic press',notes:'PRIVATE_NOTE'})),sets:[SET('today'),SET('old')]};
}
test('chat training uses the full thirty-day boundary and specific workout, not latest globally',()=>{
  const f=raw(); f.workouts.push({id:'future',start_time:'2026-10-05T10:00:00Z',end_time:'2026-10-05T11:00:00Z'});
  const r=buildChatTrainingEvidence(f,NOW);
  assert.equal(r.periodDays,30); assert.equal(r.workout.id,'today'); assert.equal(r.exercises[0].history[0].workout_id,'old');
  assert.equal(r.coverage.availableWorkouts,2); assert.equal(r.exercises[0].current.average_rpe,8);
  assert.ok(!JSON.stringify(r).includes('PRIVATE_NOTE'));
  f.workouts[1].start_time='2026-09-04T09:59:59Z'; assert.equal(buildChatTrainingEvidence(f,NOW).exercises[0].history.length,0);
});
test('null effort stays missing; zero load survives and warmup aliases never count',()=>{
  for(const type of ['Warmup','warm-up','warm_up',' warm up ']) {
    const f=raw(); f.sets=[SET('today',0,null),{...SET('today',900,10,type),set_index:1},SET('old')];
    const r=buildChatTrainingEvidence(f,NOW); assert.equal(r.overall.working_sets,1); assert.equal(r.overall.average_rpe,null);
    assert.equal(r.exercises[0].current.working_set_details[0].weight_kg,0); assert.equal(r.overall.rpe_coverage_percent,0);
  }
});
test('missing IDs, duplicate identity, stale sync and capped sources abstain explicitly',()=>{
  const f=raw(); f.catalog[0].exercise_template_id=null;
  assert.equal(buildChatTrainingEvidence(f,NOW).exercises[0].comparable,false);
  const g=raw(); g.exercises.push({...g.exercises[1],exercise_index:1});
  assert.equal(buildChatTrainingEvidence(g,NOW).exercises[0].comparable,false);
  const h=raw(); h.last_success_at=null; assert.equal(buildChatTrainingEvidence(h,NOW).dataState,'stale');
  assert.equal(buildChatTrainingEvidence({...raw(),truncated:true},NOW).dataState,'unavailable');
});
test('compact reader performs one scoped RPC and propagates source failure',async()=>{
  const calls=[]; const db={async rpc(name,args){calls.push([name,args]);return {data:raw(),error:null};}};
  await readChatTrainingEvidence(db,USER,'today',null,NOW);
  assert.equal(calls.length,1); assert.equal(calls[0][0],'get_chat_training_evidence'); assert.deepEqual(calls[0][1],{p_user_id:USER,p_workout_id:'today',p_routine_id:null,p_live_routine:null});
  await assert.rejects(()=>readChatTrainingEvidence(db,USER,'../bad',null,NOW));
  await assert.rejects(()=>readChatTrainingEvidence({rpc:async()=>({data:null,error:'failed'})},USER,null,null,NOW));
});

test('real PostgreSQL reader isolates owners, joins by ID, preserves thirty days and denies public RPC access',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.hevy_workouts(id text,user_id uuid,title text,start_time timestamptz,end_time timestamptz,deleted_at timestamptz,created_at timestamptz default now(),synced_at timestamptz default now(),raw_payload jsonb default '{}',primary key(id,user_id));
      create table public.hevy_workout_exercises(workout_id text,user_id uuid,exercise_index int,exercise_template_id text,title text,raw_payload jsonb default '{}');
      create table public.hevy_workout_sets(workout_id text,user_id uuid,exercise_index int,set_index int,set_type text,weight_kg numeric,reps int,rpe numeric,distance_meters numeric,duration_seconds int,raw_payload jsonb default '{}');
      create table public.hevy_routines(id text,user_id uuid,title text);
      create table public.hevy_routine_exercises(routine_id text,user_id uuid,exercise_index int,exercise_template_id text,title text);
      create table public.hevy_routine_sets(routine_id text,user_id uuid,exercise_index int,set_index int,set_type text,weight_kg numeric,reps int,rep_range_start int,rep_range_end int,rpe numeric);
      create table public.hevy_sync_state(user_id uuid,resource text,last_success_at timestamptz);
      create table public.health_metrics(user_id uuid,data_type text,recorded_at timestamptz,synced_at timestamptz,value jsonb);
      grant select on all tables in schema public to service_role;`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261004113317_workout_recap_events.sql',import.meta.url),'utf8'));
    for(const [id,user,at] of [['today',USER,AT],['boundary',USER,'2026-09-04T10:00:00Z'],['outside',USER,'2026-09-04T09:59:59Z'],['later',USER,'2026-10-05T10:00:00Z'],['other-owner',OTHER,AT]]) {
      await db.query('insert into hevy_workouts(id,user_id,title,start_time,end_time) values($1,$2,$3,$4,$4::timestamptz+interval \'1 hour\')',[id,user,'Synthetic session',at]);
      await db.query('insert into hevy_workout_exercises(workout_id,user_id,exercise_index,exercise_template_id,title) values($1,$2,0,\'press\',\'Synthetic press\')',[id,user]);
      await db.query('insert into hevy_workout_sets(workout_id,user_id,exercise_index,set_index,set_type,weight_kg,reps,rpe) values($1,$2,0,0,\'normal\',50,10,8)',[id,user]);
    }
    const sourceSet={index:0,type:'normal',weight_kg:50,reps:10,rpe:8};
    const sourceExercise={index:0,exercise_template_id:'press',title:'Synthetic press',sets:[sourceSet]};
    await db.query('update hevy_workouts set raw_payload=$1',[{exercises:[sourceExercise]}]);
    await db.query('update hevy_workout_exercises set raw_payload=$1',[sourceExercise]);
    await db.query('update hevy_workout_sets set raw_payload=$1',[sourceSet]);
    await db.query('insert into hevy_sync_state values($1,\'workouts\',$2)',[USER,AT]);
    await db.exec('set role service_role');
    const r=(await db.query('select get_chat_training_evidence($1,$2,null) as data',[USER,'today'])).rows[0].data;
    assert.deepEqual(r.workouts.map(w=>w.id),['boundary','today']); assert.equal(r.sets.length,2);
    assert.equal(buildChatTrainingEvidence(r,NOW).dataState,'live');
    await db.exec('reset role');
    await db.query('delete from hevy_workout_sets where workout_id=\'boundary\'');
    const partial=(await db.query('select get_chat_training_evidence($1,$2,null) as data',[USER,'today'])).rows[0].data;
    assert.equal(partial.incomplete,true);assert.equal(buildChatTrainingEvidence(partial,NOW).dataState,'unavailable');
    await db.exec('set role service_role');
    assert.equal((await db.query('select get_chat_training_evidence($1,$2,null) as data',[USER,'other-owner'])).rows[0].data,null);
    await db.exec('reset role; set role anon');
    await assert.rejects(()=>db.query('select get_chat_training_evidence($1,null,null)',[USER]),/permission denied/);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(()=>db.query('select get_chat_training_evidence($1,null,null)',[USER]),/permission denied/);
  } finally {await db.close();}
});
