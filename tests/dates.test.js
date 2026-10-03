import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceInstant } from '../src/dates.js';
import { sessionDate, buildProgressCoverage } from '../src/trainingModel.js';
import { buildLiveView } from '../src/healthView.js';

test('Bangkok local timestamps represent the same instant independently of browser zone', () => {
 for (const value of ['2026-10-03T23:30:00','2026-10-03 23:30:00','2026-10-03T23:30:00+07:00','2026-10-03T16:30:00Z']) assert.equal(sourceInstant(value),'2026-10-03T16:30:00.000Z');
 assert.equal(sourceInstant('2026-10-03'),'2026-10-02T17:00:00.000Z');
 for (const value of [null,undefined,'','bad',0]) assert.equal(sourceInstant(value),null);
});
test('canonical UTC wins, while legacy Bangkok-only workout dates remain correct', () => {
 assert.equal(sessionDate({start_time:'2026-10-03T16:30:00Z',start_time_bangkok:'2026-10-03T23:30:00'}),'2026-10-03T16:30:00.000Z');
 assert.equal(sessionDate({date_bangkok:'2026-10-03T23:30:00'}),'2026-10-03T16:30:00.000Z');
});
test('same-evening Bangkok sessions are not dropped as future workouts', () => {
 const coverage=buildProgressCoverage({period:{days:30},exercise_progress:[{sessions:[{workout_id:'synthetic',date_bangkok:'2026-10-03T23:30:00'}]}]},'30D',Date.parse('2026-10-03T17:00:00Z'));
 assert.equal(coverage.workouts,1);assert.equal(coverage.observedDays,1);
});
test('recovery chart labels do not jump to the next day after 17:00 Bangkok time', () => {
 const view=buildLiveView({recap:{evidence:{recovery_daily:[{date:'2026-10-03T23:30:00',type:'daily-heart-rate-variability',value:50}]}}},{});
 assert.deepEqual(view.recovery.chart.labels,['Oct 3','Oct 3']);
});
