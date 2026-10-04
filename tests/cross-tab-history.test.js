import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "rolldown";
import { exerciseHistory, trainingHistory, workingRecords } from "../src/trainingHistory.js";
import { buildMetricHistory, historyMetric } from "../src/metricHistory.js";
const temporary=await mkdtemp(join(tmpdir(),"tong-history-tabs-"));
await build({input:{history:new URL("../src/TrainingHistorySheet.jsx",import.meta.url).pathname,detail:new URL("../src/DetailSheets.jsx",import.meta.url).pathname},external:["react","react/jsx-runtime"],output:{dir:temporary,format:"esm",entryFileNames:"[name].mjs",paths:{react:import.meta.resolve("react"),"react/jsx-runtime":import.meta.resolve("react/jsx-runtime")}}});
const {TrainingHistorySheet,WorkingSetRecords}=await import(pathToFileURL(join(temporary,"history.mjs")));
const {ExerciseDetailSheet}=await import(pathToFileURL(join(temporary,"detail.mjs")));
after(()=>rm(temporary,{recursive:true,force:true}));
const render=(Component,props)=>{const previous=globalThis.document;globalThis.document={activeElement:null};try{return renderToStaticMarkup(React.createElement(Component,props));}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}};
const session=(id,date,extra={})=>({workout_id:id,exercise_template_id:"press-a",date,exercise_index:0,title:"Synthetic press",working_sets:2,working_set_details:[{set_index:1,set_type:"normal",weight_kg:0,reps:8,rpe:7},{set_index:0,set_type:"Warm-up",weight_kg:10,reps:5,rpe:2}],...extra});
const fixture=()=>({generated_at:"2026-09-20T05:00:00Z",recap:{evidence:{recovery_daily:[{date:"2026-09-19T06:00:00",type:"daily-heart-rate-variability",value:41.5},{date:"2026-09-18",type:"sleep",value:400}]}},recent_workouts:[{id:"new",title:"Synthetic Push",start_time:"2026-09-19T12:00:00Z",working_sets:2,volume_kg:0}],exercise_progress:[{exercise_template_id:"press-a",query:"Synthetic press",sessions:[session("old","2026-08-20T12:00:00Z"),session("middle","2026-09-15T12:00:00Z"),session("new","2026-09-19T12:00:00Z")]}]});

test("Recovery aliases open actual Sleep HRV and resting-HR records",async()=>{
  assert.equal(historyMetric("Sleep consistency"),"Sleep");assert.equal(historyMetric("HRV baseline"),"HRV");assert.equal(historyMetric("Resting HR"),"Resting heart rate");
  const hrv=buildMetricHistory(fixture(),"HRV","7D");assert.equal(hrv.rows[0].displayValue,"41.5 ms");assert.equal(hrv.rows[0].note,"Daily HRV measurement");
  const app=await readFile(new URL("../src/App.jsx",import.meta.url),"utf8");assert.ok(app.includes('<Recovery storage={preferencesRef.current} range={ranges.Recovery} setRange={setRange} openMetric={openHealthMetric}'));assert.ok(app.includes('label === "Recent training load"'));assert.ok(app.includes('ranges[sheet.tab]'));
});

test("session history joins only stable workout IDs, orders and date-filters without invented totals",()=>{
  const data=fixture(),original=JSON.stringify(data);const rows=trainingHistory(data,"7D");assert.deepEqual(rows.map(x=>x.id),["new","middle"]);assert.equal(rows[0].title,"Synthetic Push");assert.equal(rows[1].summary,undefined);assert.equal(rows[1].exercises.length,1);
  assert.equal(trainingHistory(data,"3M").length,3);assert.equal(JSON.stringify(data),original);assert.equal(trainingHistory({...data,sample:true}).length,0);
  data.exercise_progress[0].sessions.push(session(null,"2026-09-18"),session("future","2027-01-01"),session("unknown","invalid"));assert.equal(trainingHistory(data,"7D").length,2);
});

test("exercise drilldown refuses same-title different-ID and mismatched session joins",()=>{
  const data=fixture();data.exercise_progress.push({exercise_template_id:"press-b",query:"Synthetic press",sessions:[session("other","2026-09-18",{exercise_template_id:"press-b"})]});data.exercise_progress[0].sessions.push(session("bad","2026-09-18",{exercise_template_id:"press-b"}));
  assert.equal(exerciseHistory(data,"press-a").sessions.length,3);assert.equal(exerciseHistory(data,"press-b").sessions.length,1);assert.equal(exerciseHistory(data,null).sessions.length,0);
});

test("working-set history normalizes warmup aliases, keeps real zero, and preserves absent effort",()=>{
  const data=session("x","2026-09-19");data.working_set_details.push({set_index:2,type:" WARM_UP ",weight_kg:999,reps:1,rpe:1},{set_index:3,type:"normal",weight_kg:null,reps:null,rpe:0});
  assert.equal(workingRecords(data).length,2);const html=render(WorkingSetRecords,{session:data});assert.ok(html.includes("0 kg"));assert.ok(html.includes("RPE Unavailable"));assert.ok(!html.includes("999"));assert.ok(!html.includes("10 kg"));assert.ok(!html.includes("RPE 0"));
});

test("Training history renders real sessions, source/coverage and read-only cache labels",()=>{
  const html=render(TrainingHistorySheet,{payload:fixture(),range:"7D",dataState:"stale",returnTab:"Recovery"});assert.ok(html.includes("Synthetic Push"));assert.ok(html.includes("Recorded workout"));assert.ok(html.includes("two summaries")===false);assert.ok(html.includes("limited to five"));assert.ok(html.includes("Back to Recovery"));assert.ok(html.includes("Cached history"));assert.ok(html.includes("View records"));assert.ok(html.includes('aria-label="Close Training history"'));
});

test("sample missing and loading Training history never render personal records",()=>{
  for(const dataState of ["sample","loading","unavailable"]){const html=render(TrainingHistorySheet,{payload:fixture(),range:"7D",dataState});assert.ok(!html.includes("Synthetic Push"));assert.ok(!html.includes("Recorded workout"));}
  assert.ok(render(TrainingHistorySheet,{payload:{generated_at:fixture().generated_at},range:"7D",dataState:"live"}).includes("No recorded sessions"));
});

test("exercise detail exposes all returned sessions and working-set disclosure instead of a six-row cutoff",()=>{
  const sessions=Array.from({length:8},(_,i)=>session(`w${i}`,`2026-09-${String(i+1).padStart(2,"0")}`));const html=render(ExerciseDetailSheet,{exercise:{name:"Synthetic press",sessions},onClose(){}});assert.equal((html.match(/Working-set records/g)||[]).length,8);assert.ok(html.includes("All returned sessions · 8"));assert.ok(html.includes("Sep 1, 2026"));assert.ok(html.includes('>Back</button>'));
});
