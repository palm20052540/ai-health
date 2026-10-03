import test from "node:test";
import assert from "node:assert/strict";
import {
  finiteNumber, validRpe, isWorkingSet, exerciseIdentity, summarizeWorkingSets,
  buildExerciseProgressSessions, buildExerciseProgressEntries, buildTrainingSummary, displayMuscleGroup,
} from "../supabase/functions/hevy-actions/analytics.ts";

const workouts = [
  { id: "w1", start_time: "2026-01-01T10:00:00Z", end_time: "2026-01-01T11:00:00Z", start_time_bangkok: "2026-01-01T17:00:00" },
  { id: "w2", start_time: "2026-01-08T10:00:00Z", end_time: "2026-01-08T11:00:00Z", start_time_bangkok: "2026-01-08T17:00:00" },
];
const workoutMap = new Map(workouts.map((workout) => [workout.id, workout]));
const exercise = (workout_id, exercise_index, exercise_template_id, title = "Synthetic press") => ({ workout_id, exercise_index, exercise_template_id, title });
const set = (workout_id, exercise_index, set_index, weight_kg, reps, rpe, set_type = "normal") => ({ workout_id, exercise_index, set_index, weight_kg, reps, rpe, set_type });

// Every fixture below is fabricated and contains no health source data.
test("finiteNumber preserves numeric zero without inventing zero from absent or malformed data", () => {
  for (const value of [null, undefined, "", "  ", "abc", NaN, Infinity, -Infinity, true, false, [], [0], {}, () => 0]) {
    assert.equal(finiteNumber(value), null, String(value));
  }
  for (const value of [0, "0", " 0 "]) assert.equal(finiteNumber(value), 0);
  assert.equal(finiteNumber("8.5"), 8.5);
  assert.equal(finiteNumber(-3), -3);
});

test("logged RPE bounds are inclusive 1–10 and reject invalid evidence", () => {
  for (const value of [null, undefined, "", " ", 0, "0", -1, 0.9, 10.1, 11, Infinity, NaN, false]) assert.equal(validRpe(value), null);
  for (const value of [1, 7, 8.5, 10]) assert.equal(validRpe(value), value);
  assert.equal(validRpe("8.5"), 8.5);
});

test("warmups are excluded uniformly, including normalized source spelling", () => {
  for (const value of ["warmup", " Warmup ", "warm_up", "warm-up"]) assert.equal(isWorkingSet({ set_type: value }), false);
  assert.equal(isWorkingSet({ type: "warmup" }), false);
  for (const value of ["normal", "failure", "dropset", null, undefined]) assert.equal(isWorkingSet({ set_type: value }), true);
});

test("working-set coverage uses valid logged RPE only and never includes warmups", () => {
  const result = summarizeWorkingSets([
    set("w1", 0, 0, 1000, 20, 10, "warmup"),
    set("w1", 0, 1, 40, 10, 8),
    set("w1", 0, 2, 40, 10, null),
    set("w1", 0, 3, 40, 10, 0),
    set("w1", 0, 4, 40, 10, 11),
  ]);
  assert.equal(result.working_sets, 4);
  assert.equal(result.rpe_count, 1);
  assert.equal(result.rpe_coverage_percent, 25);
  assert.equal(result.average_rpe, 8);
  assert.equal(result.hard_sets, 1);
  assert.equal(result.volume_kg, 1600);
  assert.equal(result.max_weight_kg, 40);
  assert.equal(result.best_estimated_1rm_kg, 53.3);
});

test("empty RPE and e1RM remain missing rather than fabricated zero", () => {
  for (const sets of [[], [set("w1", 0, 0, null, null, null)], [set("w1", 0, 0, 0, 10, "")]]) {
    const result = summarizeWorkingSets(sets);
    assert.equal(result.average_rpe, null);
    assert.equal(result.rpe_count, 0);
    assert.equal(result.best_estimated_1rm_kg, null);
    assert.equal(result.best_set, null);
  }
  assert.equal(summarizeWorkingSets([set("w1", 0, 0, 0, 10, null)]).max_weight_kg, 0);
  assert.equal(summarizeWorkingSets([set("w1", 0, 0, null, 10, null)]).max_weight_kg, null);
});

test("progress joins workout and exercise index, reports dates, IDs, counts and working details", () => {
  const result = buildExerciseProgressSessions([
    exercise("w2", 0, "template-a"), exercise("w1", 0, "template-a"), exercise("deleted", 0, "template-a"),
  ], workoutMap, [
    set("w1", 0, 0, 200, 10, 10, "warmup"), set("w1", 0, 1, 40, 10, 8),
    set("w1", 1, 1, 999, 10, 10), // Different exercise in same workout.
    set("w2", 0, 1, 45, 10, "8.5"), set("w2", 0, 2, 45, 10, null),
    set("deleted", 0, 1, 999, 10, 10),
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((session) => session.workout_id), ["w1", "w2"]);
  assert.equal(result[0].exercise_template_id, "template-a");
  assert.equal(result[0].start_time, workouts[0].start_time);
  assert.equal(result[0].date_bangkok, workouts[0].start_time_bangkok);
  assert.equal(result[0].sets, result[0].working_sets);
  assert.equal(result[0].working_sets, 1);
  assert.equal(result[1].rpe_count, 1);
  assert.equal(result[1].rpe_coverage_percent, 50);
  assert.equal(result[1].average_rpe, 8.5);
  assert.deepEqual(result[0].best_set, { weight_kg: 40, reps: 10, rpe: 8, set_index: 1, estimated_1rm_kg: 53.3 });
  assert.equal(result[0].working_set_details.length, 1);
  assert.equal(result[1].working_set_details[1].rpe, null);
});

test("progress has no false e1RM point when load or reps are unavailable", () => {
  const [result] = buildExerciseProgressSessions([exercise("w1", 0, "bodyweight")], workoutMap, [
    set("w1", 0, 0, null, 10, 7), set("w1", 0, 1, 0, 10, 0),
  ]);
  assert.equal(result.best_estimated_1rm_kg, null);
  assert.equal(result.best_set, null);
  assert.equal(result.working_sets, 2);
  assert.equal(result.rpe_count, 1);
});

test("IDs separate same-name exercises and preserve renamed-template history", () => {
  const exercises = [exercise("w1", 0, "a", "Old name"), exercise("w2", 0, "a", "Same name"), exercise("w1", 1, "b", "Same name")];
  const sets = [set("w1", 0, 0, 40, 10, 7), set("w2", 0, 0, 50, 10, 8), set("w1", 1, 0, 100, 10, 9)];
  const templates = [{ id: "a", primary_muscle_group: "chest" }, { id: "b", primary_muscle_group: "chest" }];
  const summary = buildTrainingSummary(workouts, exercises, sets, templates, 30);
  assert.equal(summary.exercise_catalog.length, 2);
  assert.equal(summary.exercise_catalog.find((item) => item.exercise_template_id === "a").title, "Same name");
  assert.equal(summary.exercise_catalog.find((item) => item.exercise_template_id === "a").workout_appearances, 2);
  const entries = buildExerciseProgressEntries(summary.exercise_catalog, exercises, workoutMap, sets);
  assert.equal(entries.find((entry) => entry.exercise_template_id === "a").sessions.length, 2);
  assert.equal(entries.find((entry) => entry.exercise_template_id === "b").sessions.length, 1);
  assert.equal(summary.muscle_groups[0].strength_change_percent, 25); // Calculate trends before presentation rounding.
});

test("secondary muscles never double-count and unknown primary never comes from title inference", () => {
  const summary = buildTrainingSummary(workouts, [exercise("w1", 0, "a", "Bench press"), exercise("w1", 1, "unknown", "Bench press")], [
    set("w1", 0, 0, 40, 10, 8), set("w1", 1, 0, 20, 10, 8),
  ], [{ id: "a", primary_muscle_group: "chest", secondary_muscle_groups: ["triceps", "shoulders"] }], 30);
  assert.deepEqual(summary.muscle_groups.map((group) => group.name).sort(), ["Chest", "Other"]);
  assert.equal(summary.muscle_groups.reduce((sum, group) => sum + group.working_sets, 0), summary.working_sets);
  assert.equal(summary.muscle_groups.reduce((sum, group) => sum + group.volume_kg, 0), summary.total_volume_kg);
  assert.equal(summary.muscle_attribution, "primary_only");
  assert.equal(summary.exercise_catalog.find((item) => item.exercise_template_id === "unknown").muscle_group, "Other");
  assert.equal(displayMuscleGroup("abdominals"), "Core");
});

test("summary, recent-workout metrics and progress share the same denominator", () => {
  const exercises = [exercise("w1", 0, "a"), exercise("w2", 0, "a")];
  const sets = [set("w1", 0, 0, 50, 10, 10, "warmup"), set("w1", 0, 1, 40, 10, 8), set("w2", 0, 0, 45, 10, null)];
  const summary = buildTrainingSummary(workouts, exercises, sets, [{ id: "a", primary_muscle_group: "chest" }], 30);
  const sessions = buildExerciseProgressSessions(exercises, workoutMap, sets);
  const recentMetrics = workouts.map((workout) => summarizeWorkingSets(sets.filter((item) => item.workout_id === workout.id)));
  for (const rows of [sessions, recentMetrics]) {
    assert.equal(rows.reduce((sum, item) => sum + item.working_sets, 0), summary.completed_sets);
    assert.equal(rows.reduce((sum, item) => sum + item.rpe_count, 0), summary.rpe_count);
    assert.equal(rows.reduce((sum, item) => sum + item.volume_kg, 0), summary.total_volume_kg);
  }
  assert.equal(summary.average_rpe, 8);
  assert.equal(summary.rpe_coverage_percent, 50);
  assert.equal(summary.muscle_groups[0].rpe_coverage_percent, 50);
});

test("repeated exercise blocks are one workout appearance and cannot fabricate within-session strength progress", () => {
  const summary = buildTrainingSummary([workouts[0]], [exercise("w1", 0, "a"), exercise("w1", 2, "a")], [
    set("w1", 0, 0, 40, 10, 8), set("w1", 2, 0, 60, 10, 8),
  ], [{ id: "a", primary_muscle_group: "chest" }], 30);
  assert.equal(summary.exercise_catalog[0].workout_appearances, 1);
  assert.equal(summary.most_frequent_exercises[0].workout_appearances, 1);
  assert.equal(summary.muscle_groups[0].strength_change_percent, null);
});

test("legacy no-ID rows remain explicitly separate from identified same-name rows", () => {
  assert.notEqual(exerciseIdentity({ title: "Press" }), exerciseIdentity({ title: "Press", exercise_template_id: "a" }));
  const exercises = [exercise("w1", 0, null, "Press"), exercise("w1", 1, "a", "Press")];
  const summary = buildTrainingSummary(workouts, exercises, [], [], 30);
  const entries = buildExerciseProgressEntries(summary.exercise_catalog, exercises, workoutMap, []);
  assert.equal(entries.length, 2);
  for (const entry of entries) assert.equal(entry.sessions.length, 1);
  assert.equal(entries.find((entry) => entry.exercise_template_id == null).identity_source, "legacy_title");
});

test("core and warmup-only exercises retain session visibility without adding working exposure", () => {
  const summary = buildTrainingSummary(workouts, [exercise("w1", 0, "core"), exercise("w1", 1, "warm")], [
    set("w1", 0, 0, 0, 10, 8), set("w1", 1, 0, 50, 10, 10, "warmup"),
  ], [{ id: "core", primary_muscle_group: "abdominals" }, { id: "warm", primary_muscle_group: "chest" }], 30);
  assert.equal(summary.exercise_catalog.length, 2);
  assert.equal(summary.exercise_catalog.find((item) => item.exercise_template_id === "warm").workout_appearances, 0);
  assert.equal(summary.working_sets, 1);
  assert.deepEqual(summary.muscle_groups.map((group) => group.name), ["Core"]);
});
