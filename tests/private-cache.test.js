import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardCache, DASHBOARD_CACHE_KEY, FRESH_CACHE_MS, MAX_CACHE_MS } from "../src/dashboardCache.js";
import { cachedBrief, clearSavedBriefCache, setBriefCacheOwner, briefCacheExpired } from "../src/briefCache.js";
import worker from "../worker/index.js";
import { readFile } from "node:fs/promises";
const NOW = Date.parse("2026-09-20T05:00:00Z");
const fixture = (n = 1) => ({ generated_at: new Date(NOW).toISOString(), period: {days:30}, recap: {summary: {synthetic:n}, evidence:{}}, recent_workouts: [] });
const memory = () => { const data = new Map(); return { getItem:key=>data.get(key), setItem:(key,value)=>data.set(key,value), removeItem:key=>data.delete(key) }; };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };

test("cache is locked before verified identity and owner changes never restore another owner's records", async () => {
  const storage=memory(), client=createDashboardCache({storage,now:()=>NOW,fetcher:async()=>fixture()});
  assert.equal(client.read(30).status,"locked"); await assert.rejects(client.load(30));
  client.activate("owner-a"); await client.load(30);
  const restored=createDashboardCache({storage,now:()=>NOW+100,fetcher:async()=>fixture()});
  assert.equal(restored.read(30).payload,null);
  restored.activate("owner-b"); assert.equal(restored.read(30).payload,null); assert.equal(storage.getItem(DASHBOARD_CACHE_KEY),undefined);
});

test("warm tab navigation deduplicates requests and visibly reuses fresh snapshots", async () => {
  let calls=0; const wait=deferred();
  const client=createDashboardCache({storage:memory(),now:()=>NOW,fetcher:()=>{calls++;return wait.promise;}});client.activate("owner");
  const first=client.load(30), simultaneous=client.load(30); await Promise.resolve(); assert.equal(calls,1);
  wait.resolve(fixture()); await Promise.all([first,simultaneous]);
  for(let i=0;i<10;i++) await client.load(30);
  assert.equal(calls,1); assert.equal(client.read(30).status,"cached"); assert.equal(client.read(30).ageMs,0);
  // Measured request reduction: 11 sequential loads plus a concurrent duplicate -> 1 source read.
});

test("restored snapshots render read-only and revalidate without resetting their original age", async () => {
  let now=NOW,calls=0;const storage=memory(), fetcher=async()=>{calls++;return fixture();};
  const one=createDashboardCache({storage,now:()=>now,fetcher});one.activate("owner");await one.load(30);
  now+=20000;const two=createDashboardCache({storage,now:()=>now,fetcher});two.activate("owner");
  assert.equal(two.read(30).status,"stale");assert.equal(two.read(30).ageMs,20000);
  await two.load(30);assert.equal(calls,2);assert.equal(two.read(30).status,"live");
});

test("TTL boundaries, errors and hard expiry never re-age stale evidence", async () => {
  let now=NOW,fail=false;const client=createDashboardCache({storage:memory(),now:()=>now,fetcher:async()=>{if(fail)throw new Error("Offline");return fixture();}});client.activate("owner");await client.load(7);
  now+=FRESH_CACHE_MS;assert.equal(client.read(7).status,"stale");fail=true;await assert.rejects(client.load(7));
  assert.equal(client.read(7).status,"stale");assert.equal(client.read(7).storedAt,NOW);assert.equal(client.read(7).error,"Offline");
  now=NOW+MAX_CACHE_MS;assert.equal(client.read(7).payload,null);
});

test("Sync invalidation rejects obsolete returns and old finally cannot remove the new request", async () => {
  const a=deferred(),b=deferred();let calls=0;
  const client=createDashboardCache({storage:memory(),now:()=>NOW,fetcher:()=>++calls===1?a.promise:b.promise});client.activate("owner");
  const old=client.load(30);await Promise.resolve();client.invalidate();
  const fresh=client.load(30);await Promise.resolve();a.resolve(fixture(1));await assert.rejects(old,{cancelled:true});
  assert.equal(client.read(30).refreshing,true);b.resolve(fixture(2));await fresh;
  assert.equal(client.read(30).payload.recap.summary.synthetic,2);assert.equal(client.read(30).refreshing,false);
});

test("auth failure clears all periods/storage and requires a new identity check", async () => {
  let fail=false,locks=0;const storage=memory(),client=createDashboardCache({storage,now:()=>NOW,onAuthFailure:()=>locks++,fetcher:async()=>{if(fail)throw Object.assign(new Error("Forbidden"),{status:403});return fixture();}});client.activate("owner");
  await client.load(7);await client.load(30);fail=true;await assert.rejects(client.load(30,{force:true}));
  assert.equal(client.read(7).status,"locked");assert.equal(storage.getItem(DASHBOARD_CACHE_KEY),undefined);assert.equal(locks,1);
});

test("corrupt, future and expired storage and unavailable storage fail safely", async () => {
  for(const value of ["bad",JSON.stringify({version:1,owner:"owner",entries:[[30,{payload:fixture(),storedAt:NOW+1}]]}),JSON.stringify({version:1,owner:"owner",entries:[[30,{payload:fixture(),storedAt:NOW-MAX_CACHE_MS}]]})]) {
    const storage=memory();storage.setItem(DASHBOARD_CACHE_KEY,value);const client=createDashboardCache({storage,now:()=>NOW,fetcher:async()=>fixture()});client.activate("owner");assert.equal(client.read(30).payload,null);await client.load(30);assert.ok(client.read(30).payload);
  }
  const storage={getItem(){throw Error("Denied");},setItem(){throw Error("Quota");},removeItem(){throw Error("Denied");}};
  const client=createDashboardCache({storage,now:()=>NOW,fetcher:async()=>fixture()});client.activate("owner");await client.load(30);assert.ok(client.read(30).payload);
});

test("sample responses are never persisted; extra top-level fields are not cached", async () => {
  const storage=memory();let sample=true;const client=createDashboardCache({storage,now:()=>NOW,fetcher:async()=>sample?{...fixture(),sample:true}:{...fixture(),unapproved_extra:"synthetic-private-extra"}});client.activate("owner");await client.load(30);
  assert.equal(client.read(30).status,"sample");assert.equal(client.read(30).payload,null);sample=false;await client.load(30);
  assert.ok(!storage.getItem(DASHBOARD_CACHE_KEY).includes("unapproved_extra"));
});

test("large snapshots retain working in-memory data without overflowing persistent storage", async()=>{
  const storage=memory();const client=createDashboardCache({storage,now:()=>NOW,fetcher:async()=>({...fixture(),recap:{synthetic:"x".repeat(1600000)}})});client.activate("owner");await client.load(365);
  assert.ok(client.read(365).payload);assert.ok(storage.getItem(DASHBOARD_CACHE_KEY).length<1500000);
});

test("saved summary memory cache deduplicates, expires and rejects pre-invalidation replies", async()=>{
  setBriefCacheOwner("owner-a");let calls=0,now=NOW;const read=async()=>{calls++;return {status:"ready",report:{narrative:"Synthetic"}};};
  await Promise.all([cachedBrief("daily",read,()=>now),cachedBrief("daily",read,()=>now)]);assert.equal(calls,1);
  const warm=await cachedBrief("daily",read,()=>now);assert.equal(warm.cacheHit,true);assert.equal(calls,1);
  now+=30000;assert.equal(briefCacheExpired(warm,now),true);await cachedBrief("daily",read,()=>now);assert.equal(calls,2);
  const delayed=deferred();clearSavedBriefCache();const old=cachedBrief("training",()=>delayed.promise,()=>now);await Promise.resolve();setBriefCacheOwner("owner-b");delayed.resolve({status:"ready"});await assert.rejects(old,{cancelled:true});setBriefCacheOwner(null);
});

test("private session and dashboard require both trusted identity headers and no-store", async()=>{
  const env={ALLOWED_USER_EMAIL:"owner@example.test"};
  for(const path of ["/api/session","/api/dashboard"]) {
    const anonymous=await worker.fetch(new Request("https://site.example"+path),env);assert.equal(anonymous.status,403);
    const missingId=await worker.fetch(new Request("https://site.example"+path,{headers:{"oai-authenticated-user-email":"owner@example.test"}}),env);assert.equal(missingId.status,401);
  }
  const response=await worker.fetch(new Request("https://site.example/api/session",{headers:{"oai-authenticated-user-email":"owner@example.test","oai-authenticated-user-id":"synthetic-owner"}}),env);
  assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");assert.deepEqual(await response.json(),{ownerId:"synthetic-owner"});
});

test("UI invalidation clears derived decisions and sheets and gates BFCache/focus restores", async()=>{
  const app=await readFile(new URL("../src/App.jsx",import.meta.url),"utf8");
  assert.ok(app.includes('!verifiedOwnerRef.current && session.status !== "ready"'));
  assert.ok(app.includes('hidden={session.status !== "ready"} inert={session.status !== "ready"}'));
  for(const event of ['"focus"','"pageshow"','"pagehide"','"tong-fit:auth-failed"'])assert.ok(app.includes(event));
  assert.ok(app.indexOf('snapshots.invalidate(); sourceKeys.current.clear()')<app.indexOf('await syncDashboard()'));
  assert.ok(app.includes('generation !== sessionGeneration.current || syncRef.current'));
  assert.ok(app.includes('recoveryEvidence.status'));
  assert.ok(app.includes('setAppliedRecovery(null); setSheet(null)'));
});

test("failed Sync leaves an explicit unavailable state and can recover with a read-only refresh",async()=>{
  const client=createDashboardCache({storage:memory(),now:()=>NOW,fetcher:async()=>fixture()});client.activate("owner");await client.load(7);client.invalidate();client.markUnavailable("Synthetic sync failure");
  for(const days of [7,28,30,90,180,365]) {assert.equal(client.read(days).status,"unavailable");assert.equal(client.read(days).payload,null);}
  await client.load(30,{force:true});assert.equal(client.read(30).status,"live");
  const app=await readFile(new URL("../src/App.jsx",import.meta.url),"utf8");assert.ok(app.includes('new Set([activeDaysRef.current, 28])'));assert.ok(app.includes('focusRestoreRef.current?.isConnected'));
});

test("same owner preserves local preferences while different owners get separate namespaces",async()=>{
  const {ownerStorage}=await import("../src/ownerStorage.js");const storage=memory();storage.setItem("tong-fit:settings:v1","synthetic-legacy");
  const a=ownerStorage("a",storage);assert.equal(a.getItem("tong-fit:settings:v1"),"synthetic-legacy");a.setItem("input","synthetic-a");
  const b=ownerStorage("b",storage);assert.equal(b.getItem("tong-fit:settings:v1"),null);assert.equal(b.getItem("input"),null);b.setItem("input","synthetic-b");
  assert.equal(ownerStorage("a",storage).getItem("input"),"synthetic-a");
  const app=await readFile(new URL("../src/App.jsx",import.meta.url),"utf8");assert.ok(app.includes('key={session.ownerId}'));assert.ok(app.includes('persistRecovery(result, preferencesRef.current)'));
});

test("unchanged background refresh preserves Training draft identity but source/check-in/goal changes invalidate it",async()=>{
  const {trainingDraftContext}=await import("../src/trainingModel.js");
  const input={selected:"routine-a",routine:{id:"routine-a",exercises:[]},payload:fixture(),settings:{goals:{primary:"Fitness"}},recovery:{input:{painSeverity:0,fatigue:2},appliedAt:"2026-09-20T04:00:00Z",contextKey:"source-a",decision:"train",stale:false}};
  const key=trainingDraftContext(input);
  assert.equal(key,trainingDraftContext({...input,payload:{...input.payload,generated_at:"2026-09-20T06:00:00Z"},recovery:{...input.recovery,stale:true,decision:"unknown"}}));
  for(const changed of [{...input,payload:fixture(2)},{...input,settings:{goals:{primary:"Strength"}}},{...input,recovery:{...input.recovery,input:{painSeverity:2,fatigue:2}}},{...input,selected:"routine-b"}])assert.notEqual(key,trainingDraftContext(changed));
});
