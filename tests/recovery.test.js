import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecoveryDecision, finiteNumber, validRpe, validateCheckIn, sourceFreshness, recoveryState, loadRecovery, persistRecovery } from '../src/recoveryModel.js';
import { buildLiveView } from '../src/healthView.js';
import { daysForRange } from '../src/portalData.js';
const NOW = Date.parse('2026-10-03T05:00:00Z');
const settings = { goals: { primary: 'Strength' }, training: { targetRpe: 8 }, personal: {} };
const input = { painLocation: '', painSeverity: 0, fatigue: 0 };
function payload() {
 const metric = { recorded_at: '2026-10-03T00:00:00Z', synced_at: '2026-10-03T04:00:00Z' };
 return { recap: { freshness: { hevy: { ...metric, start_time: metric.recorded_at }, google_health: { sleep: metric, 'daily-heart-rate-variability': metric, 'daily-resting-heart-rate': metric } }, summary: { sleep: { asleep_minutes: { latest: 450, average: 440, count: 7 } }, recovery: { hrv_ms: { latest: 60, average: 60, count: 7 }, resting_heart_rate_bpm: { latest: 58, average: 58, count: 7 } } } } };
}
test('missing values preserve null; explicit numeric zero survives', () => {
 for (const item of [null, undefined, '', ' ', 'bad', false, true, {}, [], NaN, Infinity]) assert.equal(finiteNumber(item), null);
 for (const item of [0, '0', ' 0 ']) assert.equal(finiteNumber(item), 0);
 for (const item of [null, undefined, '', 0, 11, -1]) assert.equal(validRpe(item), null);
 assert.equal(validRpe('8.5'), 8.5);
});
test('check-in needs explicit severity/fatigue, requires location only with pain', () => {
 assert.match(validateCheckIn({}), /pain severity/);
 assert.equal(validateCheckIn(input), '');
 assert.match(validateCheckIn({ ...input, painSeverity: 1 }), /where/);
 assert.match(validateCheckIn({ ...input, fatigue: 11 }), /fatigue/);
});
test('pain and fatigue take precedence over missing sensor data', () => {
 assert.equal(buildRecoveryDecision(null, settings, { ...input, painSeverity: 8, painLocation: 'Knee' }, NOW).decision, 'rest');
 assert.equal(buildRecoveryDecision(null, settings, { ...input, fatigue: 8 }, NOW).decision, 'rest');
 assert.equal(buildRecoveryDecision(null, settings, { ...input, painSeverity: 2, painLocation: 'Shoulder' }, NOW).decision, 'reduce');
});
test('train decision requires current baseline and fresh explicit check-in', () => {
 assert.equal(buildRecoveryDecision(payload(), settings, input, NOW).decision, 'train');
 const incomplete=payload(); incomplete.recap.summary.recovery.hrv_ms.count=null;
 assert.equal(buildRecoveryDecision(incomplete, settings, input, NOW).decision, 'unknown');
 assert.equal(buildRecoveryDecision({ ...payload(), sample: true }, settings, input, NOW).decision, 'unknown');
 assert.equal(buildRecoveryDecision(payload(), { ...settings, personal: { limitations: 'Restricted movement' } }, input, NOW).decision, 'unknown');
 assert.equal(buildRecoveryDecision(payload(), settings, { ...input, fatigue: 5 }, NOW).decision, 'reduce');
});
test('newest source never hides old or missing measurements', () => {
 const old=payload(); old.recap.freshness.google_health.sleep={ recorded_at:'2026-09-20T00:00:00Z', synced_at:'2026-10-03T04:00:00Z' };
 assert.equal(sourceFreshness(old, NOW).find(row=>row.id==='sleep').status,'stale');
 assert.equal(buildRecoveryDecision(old, settings, input, NOW).decision,'unknown');
 assert.equal(sourceFreshness(null,NOW).every(row=>row.status==='missing'),true);
});
test('goal, evidence, day and elapsed time invalidate applied recommendation', () => {
 const source=payload(), applied=buildRecoveryDecision(source,settings,input,NOW);
 assert.equal(recoveryState(applied,source,settings,NOW).stale,false);
 assert.equal(recoveryState(applied,source,{...settings,goals:{primary:'Physique'}},NOW).decision,'unknown');
 assert.equal(recoveryState(applied,source,settings,NOW+86400000).stale,true);
 assert.equal(recoveryState(applied,source,settings,NOW+13*3600000).stale,true);
 const changed=payload();changed.recap.summary.recovery.hrv_ms.latest=20;
 assert.equal(recoveryState(applied,changed,settings,NOW).stale,true);
});
test('storage retains only input, never health snapshots or ready decisions', () => {
 let saved; const storage={getItem:()=>saved,setItem:(_key,value)=>saved=value};
 const applied=buildRecoveryDecision(payload(),settings,input,NOW);assert.equal(persistRecovery(applied,storage),true);
 assert.deepEqual(loadRecovery(storage),{input});assert.ok(!saved.includes('contextKey'));
 assert.equal(persistRecovery(applied,{setItem:()=>{throw Error('blocked')}}),false);
 assert.equal(loadRecovery({getItem:()=>'{'}),null);
});
test('legacy recommendation never interprets missing RPE as permission to increase', () => {
 const view=buildLiveView({ exercise_progress:[{query:'Synthetic lift',exercise_template_id:'test',sessions:[{best_set:{weight_kg:100,reps:8},average_rpe:null},{best_set:{weight_kg:100,reps:8},average_rpe:null}]}] },settings);
 assert.equal(view.training.recommendation.load,100);assert.equal(view.training.exercises[0].exercise_template_id,'test');
 assert.equal(buildLiveView({},settings).training.evidence[2].value,'—');
 assert.equal(daysForRange('3M'),90);
});

test('all supported sample markers withhold recovery and live status', async () => {
 const { dashboardDataState } = await import('../src/portalData.js');
 for (const marker of [{sample:true},{demo:true},{is_sample:true},{mode:'sample'},{mode:'demo'},{data_state:'sample'}]) {
  const source={...payload(),generated_at:new Date(NOW).toISOString(),...marker};
  assert.equal(dashboardDataState(source,{status:'live'}),'sample');
  assert.equal(buildRecoveryDecision(source,settings,input,NOW).decision,'unknown');
 }
 assert.equal(dashboardDataState({}, {status:'live'}),'missing');
});
