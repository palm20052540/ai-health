import test from "node:test";
import assert from "node:assert/strict";
import { buildLatestSessionReview, buildNextSessionPlan, buildProgressCoverage, buildRoutinePayload, finiteNumber, rpeCoverage, routineDetail, routineList } from "../src/trainingModel.js";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const settings = { goals: { primary: "Physique" }, training: { style: "Hypertrophy", targetRpe: 8, maxRpe: 9 } };
function session(id, date, overrides = {}) {
  return { exercise_template_id: "bench-id", workout_id: id, date_bangkok: date, working_sets: 3, rpe_count: 3, rpe_coverage_percent: 100, average_rpe: 7, best_set: { weight_kg: 50, reps: 8 }, best_estimated_1rm_kg: 63.3, volume_kg: 1200, ...overrides };
}
function fixture() {
  return {
    routine: { id: "routine-a", title: "Actual Hevy A", exercises: [{ title: "Bench Press", exercise_template_id: "bench-id", sets: [1, 2, 3].map(() => ({ type: "normal", weight_kg: 50, reps: 8, rpe: 8 })) }] },
    payload: { generated_at: "2026-10-03T11:00:00Z", period: { days: 30 }, recap: { freshness: { hevy: { synced_at: "2026-10-03T10:00:00Z" } }, summary: { training: { rpe_coverage_percent: 100 } } }, exercise_progress: [{ exercise_template_id: "bench-id", query: "Bench Press", muscle_group: "Chest", sessions: [session("w1", "2026-09-28T10:00:00+07:00"), session("w2", "2026-10-01T10:00:00+07:00")] }], recent_workouts: [{ id: "w2", title: "Push", start_time_bangkok: "2026-10-01T10:00:00+07:00", working_sets: 3, volume_kg: 1200 }, { id: "w1", title: "Push", start_time_bangkok: "2026-09-28T10:00:00+07:00", working_sets: 3, volume_kg: 1100 }] },
    recovery: { decision: "train", appliedAt: "2026-10-03T11:30:00Z", stale: false, input: { painSeverity: 0, painLocation: "", fatigue: 0 } },
    settings, dataState: "live", now: NOW,
  };
}
const row = (input) => buildNextSessionPlan(input).rows[0];

test("missing numeric data never turns into zero", () => {
  for (const input of [null, undefined, "", "   ", false, true, NaN, Infinity, "oops", [], [0], {}]) assert.equal(finiteNumber(input), null);
  for (const input of [0, "0", 7.5, "7.5"]) assert.equal(finiteNumber(input), Number(input));
  assert.deepEqual(rpeCoverage({ average_rpe: null, working_sets: 3, rpe_count: null }), { average: null, workingSets: 3, count: null, percent: null });
  assert.equal(rpeCoverage({ average_rpe: 11 }).average, null);
  assert.equal(rpeCoverage({ average_rpe: 0 }).average, null);
  assert.equal(rpeCoverage({ average_rpe: 7, working_sets: 4, rpe_count: 2 }).percent, 50);
});

test("verified effort permits only an optional rep increase, never a mandatory load increase", () => {
  const input = fixture();
  const plan = row(input);
  assert.equal(plan.status, "optional-progression");
  assert.deepEqual([plan.prescription.loadKg, plan.prescription.sets, plan.prescription.reps], [50, 3, 9]);
  assert.match(plan.reasons.join(" "), /Repeating the baseline is also valid/);
  assert.equal(input.routine.exercises[0].sets[0].reps, 8, "the routine is never mutated");
});

test("goals change the progression rationale and strength holds at its rep emphasis", () => {
  const input = fixture();
  input.settings = { goals: { primary: "Strength" }, training: { ...settings.training, style: "Strength" } };
  assert.equal(row(input).status, "hold");
  assert.equal(row(input).prescription.reps, 8);
  assert.match(row(input).reasons.join(" "), /Strength/);
});

test("same exercise name with a different ID is never matched", () => {
  const input = fixture();
  input.routine.exercises[0].exercise_template_id = "machine-bench-id";
  assert.equal(row(input).status, "abstain");
  assert.equal(row(input).history.length, 0);
  input.routine.exercises[0].exercise_template_id = null;
  assert.match(row(input).reasons.join(" "), /no stable exercise ID/);
});

test("missing or mismatched session IDs abstain, even when catalog and names match", () => {
  const input = fixture();
  delete input.payload.exercise_progress[0].sessions[0].exercise_template_id;
  assert.equal(row(input).status, "abstain");
  input.payload.exercise_progress[0].sessions[0].exercise_template_id = "other-id";
  assert.equal(row(input).status, "abstain");
});

test("null, missing, invalid, or low-coverage RPE blocks progression", () => {
  for (const change of [{ average_rpe: 0 }, { average_rpe: null }, { average_rpe: "" }, { average_rpe: 20 }, { rpe_coverage_percent: 50 }, { rpe_count: null, rpe_coverage_percent: null }, { working_sets: null }]) {
    const input = fixture();
    Object.assign(input.payload.exercise_progress[0].sessions[1], change);
    assert.equal(row(input).status, "abstain", JSON.stringify(change));
    assert.equal(row(input).prescription.loadKg, 50);
  }
});

test("no sample, unavailable, stale, sparse, or missing-freshness prescription", () => {
  for (const change of ["unavailable", "loading", "sample", "stale-sync", "no-sync", "old-history", "one-session"]) {
    const input = fixture();
    if (["unavailable", "loading"].includes(change)) input.dataState = change;
    if (change === "sample") input.payload.is_sample = true;
    if (change === "stale-sync") input.payload.recap.freshness.hevy.synced_at = "2026-09-01T10:00:00Z";
    if (change === "no-sync") input.payload.recap.freshness.hevy.synced_at = null;
    if (change === "old-history") input.payload.exercise_progress[0].sessions[0].date_bangkok = "2026-08-01T10:00:00Z";
    if (change === "one-session") input.payload.exercise_progress[0].sessions.pop();
    assert.equal(row(input).status, "abstain", change);
  }
});

test("a check-in must be applied recently and still match its context", () => {
  for (const change of [{ stale: true }, { decision: "unknown" }, { appliedAt: null }, { appliedAt: "2026-10-01T11:00:00Z" }]) {
    const input = fixture(); Object.assign(input.recovery, change);
    assert.equal(row(input).status, "abstain", JSON.stringify(change));
  }
});

test("pain blocks automatic exercise targets and local target editing", () => {
  const input = fixture();
  input.recovery.input.painSeverity = 1;
  const result = row(input);
  assert.equal(result.status, "abstain");
  assert.equal(result.editable, false);
  assert.deepEqual(result.prescription, { loadKg: null, sets: null, reps: null });
  assert.match(result.reasons.join(" "), /Do not increase through pain/);
});

test("rest stops planned work; reduce, high fatigue, or high RPE lower load and sets", () => {
  const rest = fixture(); rest.recovery.decision = "rest";
  assert.equal(row(rest).status, "rest"); assert.equal(row(rest).prescription.sets, 0);
  for (const reason of ["reduce", "fatigue", "rpe"]) {
    const input = fixture();
    if (reason === "reduce") input.recovery.decision = "reduce";
    if (reason === "fatigue") input.recovery.input.fatigue = 7;
    if (reason === "rpe") input.payload.exercise_progress[0].sessions[1].average_rpe = 9.5;
    const result = row(input);
    assert.equal(result.status, "reduce", reason);
    assert.deepEqual([result.prescription.loadKg, result.prescription.sets], [45, 2]);
  }
});

test("routine target above recent completed load is not repeated as an increase", () => {
  const input = fixture();
  input.routine.exercises[0].sets.forEach((set) => { set.weight_kg = 100; set.reps = 20; });
  const result = row(input);
  assert.equal(result.status, "hold");
  assert.deepEqual([result.prescription.loadKg, result.prescription.reps], [50, 8]);
});

test("warmups are excluded from plan sets, varied sets stay an explicit reference", () => {
  const input = fixture();
  input.routine.exercises[0].sets.unshift({ type: "warmup", weight_kg: 20, reps: 10 });
  assert.equal(row(input).baseline.sets, 3);
  input.routine.exercises[0].sets[1].weight_kg = 45;
  assert.equal(row(input).status, "abstain");
  assert.equal(row(input).baseline.loadKg, null);
  assert.equal(row(input).baseline.setDetails[0].loadKg, 45);
});

test("repeated entries in one workout do not count as independent sessions", () => {
  const input = fixture();
  input.payload.exercise_progress[0].sessions[1].workout_id = "w1";
  assert.equal(row(input).status, "abstain");
});

test("latest review reports logged volume and compares exercises by stable identity", () => {
  const input = fixture();
  input.payload.exercise_progress[0].sessions[1].best_set.reps = 9;
  const review = buildLatestSessionReview(input.payload);
  assert.equal(review.latest.id, "w2");
  assert.equal(review.exercises[0].previous.workout_id, "w1");
  assert.match(review.exercises[0].narrative, /1 more top-set reps at the same 50 kg/);
  assert.match(review.narrative, /More volume alone does not establish better performance/);
});

test("latest review does not compare same-name exercises with missing identity", () => {
  const input = fixture();
  input.payload.exercise_progress[0].exercise_template_id = null;
  const result = buildLatestSessionReview(input.payload).exercises[0];
  assert.equal(result.previous, null);
  assert.match(result.narrative, /no cross-session comparison/);
  assert.equal(buildLatestSessionReview({}).latest, null);
});

test("long range makes short observed coverage explicit without fabricating months", () => {
  const input = fixture();
  const result = buildProgressCoverage(input.payload, "1Y", NOW);
  assert.equal(result.requestedDays, 365);
  assert.equal(result.observedDays, 4);
  assert.equal(result.workouts, 2);
  assert.equal(result.incompleteRange, true);
  assert.match(result.narrative, /span 4 of the requested 365 days/);
  assert.match(result.narrative, /only 30 days/);
  assert.equal(buildProgressCoverage({}, "3M", NOW).requestedDays, 90);
  assert.match(buildProgressCoverage({}, "3M", NOW).narrative, /No recorded/);
});

test("routine payload preserves RPE, unrelated IDs, and warmup load", () => {
  const input = fixture();
  input.routine.exercises[0].sets.unshift({ type: "warmup", weight_kg: 20, reps: 8, rpe: 4 });
  input.routine.exercises.push({ title: "Bench Press", exercise_template_id: "machine-id", sets: [{ weight_kg: 30, reps: 12, rpe: 7.5 }] });
  const output = buildRoutinePayload(input.routine, { exercise_template_id: "bench-id", load: 52.5, reps: "8–10" }, true);
  assert.equal(output.exercises[0].sets[0].weight_kg, 20);
  assert.equal(output.exercises[0].sets[0].rpe, 4);
  assert.equal(output.exercises[0].sets[1].rpe, 8);
  assert.equal(output.exercises[0].sets[1].weight_kg, 52.5);
  assert.equal(output.exercises[1].sets[0].weight_kg, 30);
  assert.equal(output.exercises[1].sets[0].rpe, 7.5);
  assert.throws(() => buildRoutinePayload(input.routine, { exercise: "Bench Press", load: 52.5 }), /stable exercise ID/);
  assert.throws(() => buildRoutinePayload(input.routine, { exercise_template_id: "missing" }), /not present/);
});

test("routine envelope parsing handles supported responses", () => {
  const input = fixture().routine;
  assert.equal(routineList({ routines: [input] })[0].id, "routine-a");
  assert.equal(routineList({ routines: {} }).length, 0);
  assert.equal(routineDetail({ routine: input }), input);
  assert.equal(routineDetail(input), input);
});


test("an explicitly pain-free check-in does not inherit pain from a remembered location", () => {
  const input = fixture(); input.recovery.input.painLocation = "Shoulder";
  assert.equal(row(input).status, "optional-progression");
});
test("additional sample markers and missing input ratings prevent automatic targets", () => {
  for (const marker of [{ sample: true }, { mode: "sample" }, { mode: "demo" }]) {
    const input = fixture(); Object.assign(input.payload, marker);
    assert.equal(row(input).status, "abstain");
  }
  const input = fixture(); input.recovery.input.fatigue = null;
  assert.equal(row(input).status, "abstain");
});

test('warmup aliases share backend semantics and preserve their routine targets', () => {
 for (const type of ['Warmup','warm-up','warm_up',' warm up ']) {
  const input=fixture(); input.routine.exercises[0].sets.unshift({ type, weight_kg:20, reps:10, rpe:3 });
  assert.equal(row(input).baseline.sets,3);
  const changed=buildRoutinePayload(input.routine,{exercise_template_id:'bench-id',load:55,reps:'9'});
  assert.equal(changed.exercises[0].sets[0].weight_kg,20);
 }
});
