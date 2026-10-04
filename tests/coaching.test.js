import test, { after } from "node:test";
import assert from "node:assert/strict";
import { exerciseCoach, dailyFocus, sessionFocus } from "../src/coaching.js";
import { buildLatestSessionReview } from "../src/trainingModel.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "rolldown";
const NOW=Date.parse("2026-09-20T00:00:00Z");
const session=(id,date,extra={})=>({exercise_template_id:"synthetic-lift",workout_id:id,start_time:date,working_sets:4,rpe_count:4,rpe_coverage_percent:100,average_rpe:8,best_set:{weight_kg:50,reps:8},...extra});
const comparison=(current={},previous={})=>({exercise_template_id:"synthetic-lift",current:session("b","2026-09-19",current),previous:session("a","2026-09-17",previous)});

test("coach distinguishes matched performance from load/volume changes",()=>{
  assert.equal(exerciseCoach(comparison(),NOW).label,"Holding steady");
  assert.equal(exerciseCoach(comparison({average_rpe:7}),NOW).label,"Same work, easier");
  assert.equal(exerciseCoach(comparison({average_rpe:9}),NOW).label,"Same work, harder");
  assert.equal(exerciseCoach(comparison({best_set:{weight_kg:50,reps:9}}),NOW).tone,"positive");
  assert.equal(exerciseCoach(comparison({best_set:{weight_kg:50,reps:7}}),NOW).label,"Reps dipped");
  for(const extra of [{best_set:{weight_kg:55,reps:8}},{working_sets:5,rpe_count:5}])assert.equal(exerciseCoach(comparison(extra),NOW).label,"Mixed comparison");
  assert.equal(exerciseCoach(comparison({volume_kg:999999}),NOW).label,"Holding steady");
});

test("effort must have a consistent denominator and known valid RPE before positive wording",()=>{
  for(const extra of [{average_rpe:null},{average_rpe:0},{average_rpe:11},{rpe_count:2},{rpe_count:5},{rpe_count:3.5},{working_sets:0},{rpe_coverage_percent:null},{rpe_coverage_percent:99},{working_sets:5,rpe_count:3,rpe_coverage_percent:60}])assert.notEqual(exerciseCoach(comparison({...extra,best_set:{weight_kg:50,reps:9}}),NOW).tone,"positive");
  assert.equal(exerciseCoach(comparison({working_sets:5,rpe_count:4,rpe_coverage_percent:80,best_set:{weight_kg:50,reps:9}},{working_sets:5,rpe_count:4,rpe_coverage_percent:80}),NOW).tone,"positive");
  assert.equal(exerciseCoach(comparison({average_rpe:8.01},{average_rpe:8.04}),NOW).label,"Holding steady");
});

test("contradictory set details, ambiguous IDs, invalid reps and future sessions never imply progress",()=>{
  const partial=comparison({working_set_details:[{type:"warm-up",rpe:3},{type:"normal",rpe:7}],best_set:{weight_kg:50,reps:9}});
  assert.notEqual(exerciseCoach(partial,NOW).tone,"positive");
  for(const extra of [{exercise_template_id:"other"},{workout_id:"a"},{start_time:"invalid"},{start_time:"2027-01-01"},{best_set:{weight_kg:50,reps:0}},{best_set:{weight_kg:null,reps:9}}])assert.equal(exerciseCoach(comparison(extra),NOW).label,"Comparison needed");
  assert.equal(exerciseCoach({...comparison(),previous:null},NOW).label,"Comparison needed");
});

test("duplicate prior exercise entries are withheld from the comparison",()=>{
  const a=session("a","2026-09-17"),b=session("b","2026-09-19");
  const result=buildLatestSessionReview({recent_workouts:[{id:"b",start_time:b.start_time}],exercise_progress:[{exercise_template_id:"synthetic-lift",sessions:[a,{...a,exercise_index:1},b]}]});
  assert.equal(result.exercises[0].previous,null);
});

test("daily focus keeps insufficient and stale evidence away from training clearance",()=>{
  assert.equal(dailyFocus([],"stale").title,"Refresh before deciding");
  assert.equal(dailyFocus([],"live").title,"Check recovery first");
  assert.equal(dailyFocus([{id:"training_readiness",rating:"caution"}],"live").title,"Start easy, then reassess");
  assert.equal(dailyFocus([{id:"training_readiness",rating:"steady"}],"live").title,"Make consistency the goal");
  assert.equal(sessionFocus([]).title,"Build a clearer comparison");
});

const temporary=await mkdtemp(join(tmpdir(),"tong-coach-render-"));
await build({input:{saved:new URL("../src/SavedAssistantBrief.jsx",import.meta.url).pathname,recovery:new URL("../src/RecoveryCheckIn.jsx",import.meta.url).pathname,daily:new URL("../src/DailyBrief.jsx",import.meta.url).pathname,training:new URL("../src/TrainingView.jsx",import.meta.url).pathname},external:["react","react/jsx-runtime"],output:{dir:temporary,format:"esm",entryFileNames:"[name].mjs",paths:{react:import.meta.resolve("react"),"react/jsx-runtime":import.meta.resolve("react/jsx-runtime")}}});
const {BriefThemeCards,SavedBriefStatus}=await import(pathToFileURL(join(temporary,"saved.mjs")));
const {RecoveryCheckIn}=await import(pathToFileURL(join(temporary,"recovery.mjs")));
const {DailyBriefContent}=await import(pathToFileURL(join(temporary,"daily.mjs")));
const {TrainingView}=await import(pathToFileURL(join(temporary,"training.mjs")));
after(()=>rm(temporary,{recursive:true,force:true}));
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));

test("evidence and limits remain accessible but collapsed; missing rating stays visible",()=>{
  const html=render(BriefThemeCards,{themes:[{id:"sleep",rating:"insufficient",summary:"Not enough history",evidence:["Synthetic evidence"],uncertainty:"Synthetic uncertainty"}]});
  assert.ok(html.includes("Not enough data"));assert.ok(html.includes('details class="context-details"'));assert.ok(!html.includes(" open"));assert.ok(html.includes("Synthetic evidence"));assert.ok(html.includes("Synthetic uncertainty"));
  assert.equal(render(SavedBriefStatus,{brief:{status:"ready",cacheHit:true}}),"");
});

test("Recovery keeps rest/pain instructions visible and never calls an empty check-in applied",()=>{
  const props={settings:{goals:{primary:"Fitness"}},storage:{getItem(){return null;}},onApply(){}};
  const empty=render(RecoveryCheckIn,{...props,recovery:{stale:true,input:{painLocation:"",painSeverity:"",fatigue:""}}});
  assert.ok(empty.includes("Check in before training"));assert.ok(empty.includes("Check-in not applied yet"));assert.ok(!empty.includes("Your submitted check-in is applied"));
  const rest=render(RecoveryCheckIn,{...props,recovery:{stale:false,decision:"rest",reasons:["High pain reported."],modifications:["Avoid strenuous training and movements that cause pain.","Seek qualified medical advice."],input:{painSeverity:8,fatigue:4},appliedAt:"2026-09-20T00:00:00Z",confidence:"Low"}});
  const beforeDetails=rest.split('<details')[0];assert.ok(beforeDetails.includes("Rest today"));assert.ok(beforeDetails.includes("Avoid strenuous training"));assert.ok(beforeDetails.includes("Seek qualified medical advice"));
});

test("Health next action and Training subtabs precede expandable supporting material",()=>{
  const health=render(DailyBriefContent,{dataState:"missing",onOpenRecovery(){}});assert.ok(health.includes("Open Recovery"));assert.ok(health.indexOf("Next step")<health.indexOf("daily-brief-themes"));
  const training=render(TrainingView,{payload:{recent_workouts:[{id:"b",title:"Synthetic session",start_time:"2026-09-19"}]},assistantReview:React.createElement("div",null,"Synthetic assistant take")});
  assert.ok(training.indexOf('role="tablist"')<training.indexOf("Synthetic assistant take"));assert.ok(training.includes("Open next session plan"));
});

test("presentation change leaves the saved-report safety validator intact",async()=>{
  const source=await readFile(new URL("../src/assistantReports.js",import.meta.url),"utf8");assert.ok(source.includes("const UNSAFE"));assert.ok(source.includes("validateReportOutput"));
  const app=await readFile(new URL("../src/App.jsx",import.meta.url),"utf8");assert.ok(app.includes("Sources, cache and method"));assert.ok(app.includes("training guidance is on hold"));
});

test("coach accepts source integer-rounded RPE coverage without treating rounded-down partial effort as complete",()=>{
  const common={working_sets:6,rpe_count:5,rpe_coverage_percent:83};
  assert.equal(exerciseCoach(comparison({...common,best_set:{weight_kg:50,reps:9}},common),NOW).tone,"positive");
  assert.notEqual(exerciseCoach(comparison({working_sets:6,rpe_count:4,rpe_coverage_percent:67,best_set:{weight_kg:50,reps:9}},common),NOW).tone,"positive");
});

test("positive comparisons verify top sets against working records and reject warm-up summaries",()=>{
  const working=reps=>Array.from({length:4},(_,index)=>({set_index:index,type:"normal",weight_kg:50,reps,rpe:8}));
  assert.equal(exerciseCoach(comparison({working_set_details:working(8),best_set:{weight_kg:50,reps:9}},{working_set_details:working(8)}),NOW).label,"Comparison needed");
  assert.equal(exerciseCoach(comparison({best_set:{type:"Warm-Up",weight_kg:50,reps:9}}),NOW).label,"Comparison needed");
  assert.equal(exerciseCoach(comparison({working_set_details:[...working(9),{type:"WARM_UP",weight_kg:200,reps:50,rpe:1}],best_set:{weight_kg:50,reps:9}},{working_set_details:working(8)}),NOW).tone,"positive");
});
