import React, { useEffect, useMemo, useState } from "react";
import { BottomSheet, Sparkline } from "./components";
import { Icon } from "./icons";
import { fetchRoutine, fetchRoutines, writeRoutine } from "./portalData";

function value(value, fallback = "—") {
  return value == null || Number.isNaN(Number(value)) ? fallback : Number(value);
}

function shortDate(input) {
  if (!input) return "—";
  return new Intl.DateTimeFormat("en", { timeZone: "Asia/Bangkok", month: "short", day: "numeric" }).format(new Date(input));
}

function exerciseChange(sessions = []) {
  const points = sessions.map((item) => Number(item.best_estimated_1rm_kg)).filter(Number.isFinite);
  if (points.length < 2 || !points[0]) return null;
  return ((points.at(-1) - points[0]) / points[0]) * 100;
}

export function ExerciseDetailSheet({ exercise, onClose }) {
  const sessions = exercise?.sessions || [];
  const change = exerciseChange(sessions);
  const values = sessions.map((item) => Number(item.best_estimated_1rm_kg)).filter(Number.isFinite);
  const lastThree = values.slice(-3);
  const plateau = lastThree.length === 3 && Math.max(...lastThree) - Math.min(...lastThree) < 1;
  return <BottomSheet title={exercise?.name || "Exercise progress"} onClose={onClose}>
    <p className="sheet-lead">Strength trend from logged working sets. Estimated 1RM is useful for direction, not a max-test prescription.</p>
    <div className="detail-stats">
      <div><small>Estimated 1RM</small><strong>{values.length ? `${value(values.at(-1)).toFixed(1)} kg` : "—"}</strong></div>
      <div><small>Range change</small><strong className={change != null && change < 0 ? "negative" : ""}>{change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</strong></div>
      <div><small>Sessions</small><strong>{sessions.length}</strong></div>
    </div>
    {values.length ? <div className="detail-chart"><Sparkline values={values.length > 1 ? values : [values[0], values[0]]} /></div> : null}
    <div className={`coach-note ${plateau ? "orange" : ""}`}><Icon name={plateau ? "info" : "sparkle"} size={19} /><div><strong>{!values.length ? "Building history" : plateau ? "Trend is flat" : "Trend is moving"}</strong><span>{!values.length ? "Complete logged working sets to unlock a reliable exercise trend." : plateau ? "Keep the load, improve reps or technique, then reassess after two sessions." : "Progress gradually while completed reps stay near your configured RPE target."}</span></div></div>
    <div className="session-list"><strong className="list-heading">Recent sessions</strong>{sessions.length ? sessions.slice().reverse().slice(0, 6).map((session, index) => <div className="session-row" key={`${session.workout_id || session.start_time || index}`}>
      <span><strong>{shortDate(session.start_time_bangkok || session.start_time || session.date)}</strong><small>{session.best_set?.weight_kg == null ? "No loaded set" : `${session.best_set.weight_kg} kg × ${session.best_set.reps ?? "—"}`}</small></span>
      <span><strong>{session.best_estimated_1rm_kg == null ? "—" : `${Number(session.best_estimated_1rm_kg).toFixed(1)} kg`}</strong><small>{session.average_rpe == null ? "RPE —" : `Avg RPE ${Number(session.average_rpe).toFixed(1)}`}</small></span>
    </div>) : <div className="empty-state compact">No completed sessions in this range.</div>}</div>
  </BottomSheet>;
}

export function MuscleDetailSheet({ muscles = [], settings, onClose }) {
  const min = Number(settings.training.targetSetsMin || 10);
  const max = Number(settings.training.targetSetsMax || 20);
  const demo = muscles.some((item) => item.demoPercent);
  const scale = Math.max(max + 4, ...muscles.map((item) => Number(item.hard_sets || 0)), 1);
  return <BottomSheet title="Muscle balance" onClose={onClose}>
    <p className="sheet-lead">{demo ? "Relative balance compared with the target level. Connect live training history to see hard-set counts." : `Hard sets in the selected period compared with your configured target of ${min}–${max} sets per muscle.`}</p>
    <div className="muscle-detail-list">{muscles.map((item) => {
      const sets = Number(item.hard_sets || 0);
      const below = item.demoPercent ? sets < 85 : sets < min;
      const above = item.demoPercent ? sets > 115 : sets > max;
      const status = below ? "Below target" : above ? "Above target" : "In range";
      const tone = below ? "low" : above ? "high" : "good";
      const percent = item.demoPercent ? Math.min(100, sets) : Math.min(100, (sets / scale) * 100);
      return <div className="muscle-detail-row" key={item.name}><div><strong>{item.name}</strong><span className={`status-pill ${tone}`}>{status}</span></div><div className="muscle-detail-bar" role="progressbar" aria-label={`${item.name} training volume`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(percent)}><i style={{ width: `${percent}%` }} /></div><b>{item.demoPercent ? `${sets}%` : `${sets} sets`}</b></div>;
    })}</div>
    <div className="method-block"><strong>How to use this</strong><p>Below target is a planning signal, not an instruction to add volume immediately. Consider recovery, exercise overlap, soreness, and performance first.</p></div>
  </BottomSheet>;
}

export function PostWorkoutSheet({ workout, settings, onClose }) {
  const rpe = Number(workout?.average_rpe);
  const target = Number(settings.training.targetRpe || 8);
  const duration = workout?.start_time_bangkok && workout?.end_time_bangkok
    ? Math.max(0, Math.round((new Date(workout.end_time_bangkok) - new Date(workout.start_time_bangkok)) / 60000)) : null;
  const review = Number.isFinite(rpe)
    ? rpe > Number(settings.training.maxRpe || 9) ? "Effort ran above your cap. Hold load next time and prioritize clean reps."
      : rpe < target - 1 ? "Effort was comfortably below target. A small load or rep increase may fit next time."
        : "Effort landed near target. Repeat or progress only if technique and recovery remain solid."
    : "RPE coverage is missing, so this review uses volume and completion only.";
  return <BottomSheet title={workout?.title || "Post-workout review"} onClose={onClose}>
    <p className="sheet-lead">A quick debrief from the most recent completed log.</p>
    <div className="detail-stats workout-scorecard">
      <div><small>Completed sets</small><strong>{value(workout?.completed_sets)}</strong></div>
      <div><small>Volume</small><strong>{Number(workout?.volume_kg || 0).toLocaleString()} kg</strong></div>
      <div><small>Duration</small><strong>{duration == null ? "—" : `${duration} min`}</strong></div>
    </div>
    <div className="coach-note orange"><Icon name="dumbbell" size={20} /><div><strong>{Number.isFinite(rpe) ? `Average RPE ${rpe.toFixed(1)} · target ${target}` : `Target RPE ${target}`}</strong><span>{review}</span></div></div>
    <p className="coverage">Wellness guidance only. Pain, unusual symptoms, or injury concerns should be assessed by a qualified clinician.</p>
  </BottomSheet>;
}

function routineList(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.routines || payload?.data || [];
}

function normalizeName(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function repRange(input) {
  const numbers = String(input || "").match(/\d+/g)?.map(Number) || [];
  if (!numbers.length) return null;
  return { start: numbers[0], end: numbers[1] || numbers[0] };
}

function routinePayload(detail, recommendation, create) {
  const target = normalizeName(recommendation.exercise);
  return {
    title: create ? `${detail.title} · adjusted` : detail.title,
    folder_id: detail.folder_id ?? null,
    notes: detail.notes ?? null,
    exercises: (detail.exercises || []).map((exercise) => {
      const match = normalizeName(exercise.title || exercise.exercise_template?.title).includes(target) || target.includes(normalizeName(exercise.title || exercise.exercise_template?.title));
      return {
        exercise_template_id: exercise.exercise_template_id,
        rest_seconds: exercise.rest_seconds ?? null,
        notes: exercise.notes ?? null,
        superset_id: exercise.superset_id ?? null,
        sets: (exercise.sets || []).map((set) => ({
          type: set.type || set.set_type || "normal",
          weight_kg: match ? recommendation.load : set.weight_kg ?? null,
          reps: set.reps ?? null,
          rep_range: match ? repRange(recommendation.reps) : set.rep_range ?? null,
          distance_meters: set.distance_meters ?? null,
          duration_seconds: set.duration_seconds ?? null,
          custom_metric: set.custom_metric ?? null,
        })),
      };
    }),
  };
}

export function RoutineRecommendationSheet({ recommendation, onClose }) {
  const [routines, setRoutines] = useState([]);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState("create");
  const [stage, setStage] = useState("loading");
  const [prepared, setPrepared] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchRoutines().then((payload) => {
      if (!active) return;
      const items = routineList(payload);
      setRoutines(items); setSelected(String(items[0]?.id || "")); setStage("ready");
    }).catch((reason) => { if (active) { setError(reason.message); setStage("error"); } });
    return () => { active = false; };
  }, []);

  const selectedRoutine = useMemo(() => routines.find((item) => String(item.id) === selected), [routines, selected]);
  const prepare = async () => {
    if (!selected) return;
    setStage("preparing"); setError("");
    try {
      const detail = await fetchRoutine(selected);
      const payload = routinePayload(detail, recommendation, mode === "create");
      const matched = (detail.exercises || []).some((item) => normalizeName(item.title || item.exercise_template?.title).includes(normalizeName(recommendation.exercise)));
      if (!matched) throw new Error(`${recommendation.exercise} was not found in this routine.`);
      setPrepared({ detail, payload, mode }); setStage("confirm");
    } catch (reason) { setError(reason.message); setStage("ready"); }
  };
  const confirm = async () => {
    setStage("writing"); setError("");
    try {
      await writeRoutine({ action: prepared.mode, routineId: selected, routine: prepared.payload, idempotencyKey: crypto.randomUUID() });
      setStage("success");
    } catch (reason) { setError(reason.message); setStage("confirm"); }
  };

  return <BottomSheet title="Review recommendation" onClose={onClose}>
    <div className="recommendation-detail"><span>{recommendation?.exercise || "Exercise"}</span><strong>{recommendation?.load == null ? "Build more history" : `${recommendation.load} kg × ${recommendation.reps}`}</strong><p>{recommendation?.explanation}</p></div>
    {recommendation?.load == null ? <div className="empty-state compact">Complete more sessions before changing a routine.</div> : null}
    {recommendation?.load != null && stage === "loading" ? <p className="storage-note">Loading Hevy routines…</p> : null}
    {recommendation?.load != null && stage !== "loading" && stage !== "success" ? <>
      <div className="routine-selector"><label><span>Base routine</span><select value={selected} onChange={(event) => { setSelected(event.target.value); setPrepared(null); setStage("ready"); }}>{routines.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div className="mode-switch" role="group" aria-label="Routine update mode"><button aria-pressed={mode === "create"} className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setPrepared(null); setStage("ready"); }}>Create copy</button><button aria-pressed={mode === "update"} className={mode === "update" ? "active" : ""} onClick={() => { setMode("update"); setPrepared(null); setStage("ready"); }}>Update existing</button></div></div>
      {stage === "confirm" ? <div className="confirmation-block"><strong>Ready to {prepared.mode === "create" ? "create" : "update"}</strong><span>{prepared.mode === "create" ? `${prepared.payload.title} will be added.` : `${selectedRoutine?.title} will be changed.`}</span><span>{recommendation.currentLoad} kg → {recommendation.load} kg for {recommendation.exercise}</span><span>Sets, rest, and exercise order stay unchanged.</span></div> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {stage === "confirm" ? <button className="primary-button full" onClick={confirm}>Confirm {prepared.mode === "create" ? "create in Hevy" : "update in Hevy"}</button> : <button className="primary-button full" disabled={!selected || stage === "preparing" || !routines.length} onClick={prepare}>{stage === "preparing" ? "Preparing…" : "Preview routine change"}</button>}
    </> : null}
    {stage === "error" ? <div className="empty-state compact"><strong>Hevy routines unavailable</strong><span>{error}</span></div> : null}
    {stage === "writing" ? <p className="storage-note" role="status" aria-live="polite">Sending confirmed change to Hevy…</p> : null}
    {stage === "success" ? <><div className="empty-state compact"><Icon name="sparkle" size={28} /><strong>Routine saved in Hevy</strong><span>The confirmed change has been applied.</span></div><button className="primary-button full" onClick={onClose}>Done</button></> : null}
  </BottomSheet>;
}
