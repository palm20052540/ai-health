import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "rolldown";

// Compile actual JSX to temporary files; fixtures only, with no network or Hevy writes.
const temporary = await mkdtemp(join(tmpdir(), "tong-training-render-"));
await build({
  input: { training: new URL("../src/TrainingView.jsx", import.meta.url).pathname, details: new URL("../src/DetailSheets.jsx", import.meta.url).pathname },
  external: ["react", "react/jsx-runtime"],
  output: { dir: temporary, format: "esm", entryFileNames: "[name].mjs", chunkFileNames: "[name]-[hash].mjs", paths: { react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime") } },
});
const { TrainingView, WorkoutTimelineSheet, ExerciseListSheet } = await import(pathToFileURL(join(temporary, "training.mjs")));
const { PostWorkoutSheet, ExerciseDetailSheet, RoutineRecommendationSheet } = await import(pathToFileURL(join(temporary, "details.mjs")));
after(() => rm(temporary, { recursive: true, force: true }));
const render = (Component, props = {}) => {
  const previous = globalThis.document;
  globalThis.document = { activeElement: null }; // BottomSheet remembers the opener; SSR does not run its effects.
  try { return renderToStaticMarkup(React.createElement(Component, props)); }
  finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
};

test("real Training JSX exposes exactly three accessible subtabs and honest live-empty state", () => {
  const html = render(TrainingView, { payload: { recent_workouts: [] }, view: { training: { exercises: [] } }, dataState: "live" });
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  for (const title of ["Latest session review", "Next session plan", "Long-term progress"]) assert.ok(html.includes(title));
  assert.ok(html.includes("No completed session yet"));
  assert.ok(!html.includes("Bench Press"));
  assert.ok(!html.includes("12,420"));
  assert.ok(html.includes('aria-labelledby="training-tab-latest"'));
});

test("latest review renders actual totals without converting missing effort into zero", () => {
  const html = render(TrainingView, { payload: { recent_workouts: [{ id: "synthetic-workout", title: "Synthetic session", start_time_bangkok: "2026-10-01T10:00:00+07:00", volume_kg: 4321, working_sets: 9, exercise_count: 3, average_rpe: null, rpe_count: 0, rpe_coverage_percent: 0 }] }, dataState: "live" });
  assert.ok(html.includes("4,321 kg"));
  assert.ok(html.includes("0% working-set coverage"));
  assert.ok(html.includes("More volume alone does not establish better performance"));
  assert.ok(!html.includes("Average RPE 0"));
  assert.ok(html.includes("Exercise detail is incomplete"));
});

test("missing RPE in workout detail stays unknown and cannot imply easy effort", () => {
  const html = render(PostWorkoutSheet, { workout: { average_rpe: null, volume_kg: null }, settings: { training: { targetRpe: 8 } } });
  assert.ok(html.includes("RPE unknown"));
  assert.ok(html.includes("No progression recommendation"));
  assert.ok(!html.includes("Average RPE 0"));
  assert.ok(!html.includes("0 kg"));
});

test("exercise detail uses date_bangkok and omits synthetic zeros", () => {
  const html = render(ExerciseDetailSheet, { exercise: { name: "Synthetic lift", sessions: [{ workout_id: "x", date_bangkok: "2026-10-01T10:00:00+07:00", best_estimated_1rm_kg: null, best_set: { weight_kg: null, reps: null }, average_rpe: null }] } });
  assert.ok(html.includes("Oct 1"));
  assert.ok(html.includes("RPE unknown"));
  assert.ok(html.includes("No loaded top set"));
  assert.ok(!html.includes("0.0 kg"));
});

test("empty timeline and exercise sheets never inject demo history or recommendations", () => {
  const timeline = render(WorkoutTimelineSheet, { workouts: [] });
  assert.ok(timeline.includes("No logged workouts"));
  assert.ok(!timeline.includes("Bench Press"));
  const exercises = render(ExerciseListSheet, { exerciseGroups: {}, initialMuscles: ["Core"] });
  assert.ok(exercises.includes("No exercises for this muscle yet"));
});

test("legacy routine entry point has no create, update, or confirmation action", () => {
  const html = render(RoutineRecommendationSheet, { recommendation: { exercise: "Synthetic lift", load: 50 } });
  assert.ok(html.includes("Hevy writes are not enabled here"));
  assert.ok(!html.includes("Confirm update"));
  assert.ok(!html.includes("Preview routine change"));
});
