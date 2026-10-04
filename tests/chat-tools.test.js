import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_TOOLS, callChatTool } from '../worker/chatTools.js';
import { handleBriefMcp } from '../worker/briefMcp.js';
import { compactLiveRoutine, buildChatTrainingEvidence } from '../supabase/functions/hevy-actions/chatEvidence.ts';
import { buildChatRecoveryEvidence } from '../supabase/functions/hevy-actions/chatRecovery.ts';

const NOW=Date.parse('2026-10-04T12:00:00Z');
test('new chat tools are owner-gated, discovery reads no health data and injected ownership is rejected',async()=>{
  let reads=0; const deps={readWorkoutChat:async(id)=>{reads++;return {workoutId:id};},chatEvent:async(body)=>body};
  const request=(name,args={},identity=false)=>new Request('https://site.example/mcp',{method:'POST',headers:identity?{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'}:{},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
  const env={ALLOWED_USER_EMAIL:'owner@example.test'};
  assert.equal((await handleBriefMcp(request('get_workout_recap_input'),env,deps)).status,401);assert.equal(reads,0);
  const r=await(await handleBriefMcp(request('get_workout_recap_input',{workoutId:'synthetic'},true),env,deps)).json();
  assert.equal(r.result.structuredContent.workoutId,'synthetic');assert.equal(reads,1);
  const injected=await(await handleBriefMcp(request('get_workout_recap_input',{workoutId:'synthetic',ownerId:'other'},true),env,deps)).json();
  assert.equal(injected.result.isError,true);assert.equal(reads,1);
  const eventId='evt_'+'a'.repeat(64);
  const scoped=await callChatTool('claim_post_workout_recap',{eventId,sourceHash:'b'.repeat(64)},deps,'trusted-owner');
  assert.equal(scoped.ownerId,'trusted-owner');assert.equal(scoped.operation,'claim');
  assert.throws(()=>callChatTool('claim_post_workout_recap',{eventId},deps,'owner'));
  assert.throws(()=>callChatTool('mark_post_workout_sent',{eventId,claimToken:'not-valid',messageId:'synthetic'},deps,'owner'));
  assert.equal(CHAT_TOOLS.length,7);
});
test('live routine identity and complete set structure are preserved without source notes',()=>{
  const r=compactLiveRoutine({id:'r1',title:'Synthetic routine',notes:'PRIVATE_NOTE',exercises:[{title:'Synthetic press',exercise_template_id:'press',sets:[{type:'warmup',weight_kg:0,reps:8,rpe:null},{type:'normal',weight_kg:30,rep_range:{start:8,end:12},rpe:8,duration_seconds:40,distance_meters:12}]}]},'r1',NOW);
  assert.equal(r.exercises[0].sets[1].rep_range_start,8);assert.equal(r.exercises[0].sets[1].duration_seconds,40);
  assert.equal(r.exercises[0].sets[0].weight_kg,0);assert.ok(!JSON.stringify(r).includes('PRIVATE_NOTE'));
  assert.throws(()=>compactLiveRoutine({id:'wrong',exercises:[]},'r1',NOW));
  const evidence=buildChatTrainingEvidence({mode:'routine',anchor_at:new Date(NOW).toISOString(),last_success_at:new Date(NOW).toISOString(),routine:{id:r.id,title:r.title,fetched_at:r.fetched_at},catalog:r.exercises,workouts:[],exercises:[],sets:[]},NOW);
  assert.equal(evidence.dataState,'live');assert.equal(evidence.exercises[0].comparable,false);assert.equal(evidence.interpretation.localGoalAndCheckInIncluded,false);
  const old=structuredClone(r);old.fetched_at='2026-09-01T00:00:00Z';
  assert.equal(buildChatTrainingEvidence({mode:'routine',anchor_at:new Date(NOW).toISOString(),last_success_at:new Date(NOW).toISOString(),routine:old,catalog:r.exercises,workouts:[],exercises:[],sets:[]},NOW).dataState,'stale');
});
test('morning evidence keeps measured and sync times separate and never invents last-night sleep',()=>{
  const records=[];
  for(let d=4;d>=0;d--)for(const type of ['sleep','daily-heart-rate-variability','daily-resting-heart-rate'])records.push({data_type:type,recorded_at:new Date(NOW-d*86400000-3600000).toISOString(),synced_at:new Date(NOW).toISOString(),value:type==='sleep'?420:type==='daily-heart-rate-variability'?60:55,
    interval:type==='sleep'?{startTime:'2026-10-03T16:00:00Z',endTime:'2026-10-04T00:00:00Z',private:'PRIVATE'}:null});
  const r=buildChatRecoveryEvidence({records},NOW);assert.equal(r.dataState,'live');assert.equal(r.sleepEndedToday,true);
  assert.equal(r.signals[0].baseline.readings,4);assert.equal(r.signals[0].baseline.average,420);assert.equal(r.currentCheckInIncluded,false);
  assert.ok(!JSON.stringify(r).includes('PRIVATE'));
  records.at(-1).value=null;assert.equal(buildChatRecoveryEvidence({records},NOW).dataState,'partial');
  for(const row of records)row.interval=null;assert.equal(buildChatRecoveryEvidence({records},NOW).sleepEndedToday,null);
  assert.equal(buildChatRecoveryEvidence({records:[],truncated:true},NOW).dataState,'unavailable');
});
