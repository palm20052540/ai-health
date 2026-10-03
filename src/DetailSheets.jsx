import { sourceInstant } from "./dates.js";
import React from "react";
import { BottomSheet, Sparkline } from "./components";
import { Icon } from "./icons";
import { finiteNumber, rpeCoverage, sessionDate } from "./trainingModel";

function value(input, fallback = "—") {
  return finiteNumber(input) ?? fallback;
}
function shortDate(input) {
  if (!input) return "—";
  const instant = sourceInstant(input);
  if (!instant) return "—";
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", { timeZone: "Asia/Bangkok", month: "short", day: "numeric" }).format(date);
}
function exerciseChange(sessions = []) {
  const points = sessions.map((item) => finiteNumber(item.best_estimated_1rm_kg)).filter((item) => item != null && item > 0);
  return points.length < 2 || !points[0] ? null : ((points.at(-1) - points[0]) / points[0]) * 100;
}

export function ExerciseDetailSheet({ exercise, onClose }) {
  const sessions = (exercise?.sessions || []).slice().sort((a, b) => String(sessionDate(a)).localeCompare(String(sessionDate(b))));
  const change = exerciseChange(sessions);
  const values = sessions.map((item) => finiteNumber(item.best_estimated_1rm_kg)).filter((item) => item != null && item > 0);
  const lastThree = values.slice(-3);
  const flat = lastThree.length === 3 && Math.max(...lastThree) - Math.min(...lastThree) < 1;
  return <BottomSheet title={exercise?.name || "Exercise progress"} onClose={onClose}>
    <p className="sheet-lead">Logged working sets only. Estimated 1RM is useful for describing a trend, not a max-test prescription.</p>
    <div className="detail-stats">
      <div><small>Estimated 1RM</small><strong>{values.length ? `${values.at(-1).toFixed(1)} kg` : "—"}</strong></div>
      <div><small>Range change</small><strong className={change != null && change < 0 ? "negative" : ""}>{change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</strong></div>
      <div><small>Sessions</small><strong>{sessions.length}</strong></div>
    </div>
    {values.length > 1 ? <div className="detail-chart"><Sparkline values={values} /></div> : null}
    <div className={`coach-note ${flat ? "orange" : ""}`}><Icon name={flat ? "info" : "sparkle"} size={19} /><div><strong>{values.length < 2 ? "Building history" : flat ? "Recent estimates are similar" : "Observed estimate trend"}</strong><span>{values.length < 2 ? "Two recorded sessions are needed to draw a trend." : "Changes in reps, effort, technique, and recovery affect this estimate. Use a current recovery check-in and verified routine history before adjusting targets."}</span></div></div>
    <div className="session-list"><strong className="list-heading">Recent sessions</strong>{sessions.length ? sessions.slice().reverse().slice(0, 6).map((session, index) => {
      const effort = rpeCoverage(session);
      const estimate = finiteNumber(session.best_estimated_1rm_kg);
      const weight = finiteNumber(session.best_set?.weight_kg);
      return <div className="session-row" key={`${session.workout_id || sessionDate(session) || index}-${index}`}>
        <span><strong>{shortDate(sessionDate(session))}</strong><small>{weight == null ? "No loaded top set" : `${weight} kg × ${value(session.best_set?.reps)}`}</small></span>
        <span><strong>{estimate == null || estimate <= 0 ? "—" : `${estimate.toFixed(1)} kg`}</strong><small>{effort.average == null ? "RPE unknown" : `Avg RPE ${effort.average.toFixed(1)}`} · {effort.percent == null ? "coverage unknown" : `${Math.round(effort.percent)}% coverage`}</small></span>
      </div>;
    }) : <div className="empty-state compact">No completed sessions in this range.</div>}</div>
  </BottomSheet>;
}

export function MuscleDetailSheet({ muscles = [], settings, onClose }) {
  const min = finiteNumber(settings?.training?.targetSetsMin) ?? 10;
  const max = finiteNumber(settings?.training?.targetSetsMax) ?? 20;
  const scale = Math.max(1, ...muscles.map((item) => finiteNumber(item.hard_sets) ?? 0));
  return <BottomSheet title="Muscle balance" onClose={onClose}>
    <p className="sheet-lead">Recorded hard sets (RPE ≥7) in the selected period, attributed to the exercise’s primary muscle only. Unrecorded RPE is not counted as a hard set.</p>
    <div className="muscle-detail-list">{muscles.length ? muscles.map((item) => {
      const sets = finiteNumber(item.hard_sets);
      const percent = sets == null ? 0 : Math.min(100, sets / scale * 100);
      return <div className="muscle-detail-row" key={item.name}><div><strong>{item.name}</strong><span className="status-pill">{sets == null ? "Unknown" : "Recorded"}</span></div><div className="muscle-detail-bar" role="meter" aria-label={`${item.name} recorded hard sets`} aria-valuemin="0" aria-valuemax={scale} aria-valuenow={sets ?? 0} aria-valuetext={sets == null ? "Unknown" : `${sets} sets`}><i style={{ width: `${percent}%` }} /></div><b>{sets == null ? "—" : `${sets} sets`}</b></div>;
    }) : <div className="empty-state compact">No muscle records in this range.</div>}</div>
    <div className="method-block"><strong>How to use this</strong><p>Your configured set target is {min}–{max}. A period total is not directly comparable with a weekly target. Consider the actual time window, incomplete RPE, recovery, overlap, and performance before adding work.</p></div>
  </BottomSheet>;
}

export function PostWorkoutSheet({ workout, settings, onClose }) {
  const effort = rpeCoverage(workout);
  const target = finiteNumber(settings?.training?.targetRpe) ?? 8;
  const cap = finiteNumber(settings?.training?.maxRpe) ?? 9;
  const start = sessionDate(workout), end = sourceInstant(workout?.end_time || workout?.end_time_bangkok);
  const difference = start && end ? (new Date(end) - new Date(start)) / 60000 : null;
  const duration = difference != null && Number.isFinite(difference) ? Math.max(0, Math.round(difference)) : null;
  const completeEffort = effort.average != null && effort.percent != null && effort.percent >= 80;
  const review = !completeEffort
    ? "RPE is missing or incompletely recorded. No progression recommendation is made from this workout."
    : effort.average > cap ? "Logged effort exceeded your cap. Check recovery before repeating or adjusting the session."
      : "Logged effort is available, but one workout alone does not establish readiness to progress. Compare exercise history and current recovery in Next session plan.";
  const volume = finiteNumber(workout?.volume_kg);
  return <BottomSheet title={workout?.title || "Post-workout review"} onClose={onClose}>
    <p className="sheet-lead">A debrief from the completed log. Working volume alone is not evidence of better performance.</p>
    <div className="detail-stats workout-scorecard">
      <div><small>Working sets</small><strong>{value(workout?.working_sets ?? workout?.completed_sets)}</strong></div>
      <div><small>Working volume</small><strong>{volume == null ? "—" : `${volume.toLocaleString()} kg`}</strong></div>
      <div><small>Duration</small><strong>{duration == null ? "—" : `${duration} min`}</strong></div>
    </div>
    <div className="coach-note orange"><Icon name="dumbbell" size={20} /><div><strong>{effort.average == null ? `RPE unknown · target ${target}` : `Average RPE ${effort.average.toFixed(1)} · target ${target}`}</strong><span>{review}</span><span>{effort.percent == null ? "Working-set RPE coverage unknown." : `${Math.round(effort.percent)}% of working sets have RPE recorded.`}</span></div></div>
    <p className="coverage">Wellness guidance only. Pain, unusual symptoms, or injury concerns should be assessed by a qualified clinician.</p>
  </BottomSheet>;
}

// Legacy entry point remains read-only. Plans are prepared in the Training subtab.
export function RoutineRecommendationSheet({ onClose }) {
  return <BottomSheet title="Next session planning" onClose={onClose}><p className="sheet-lead">Open Training → Next session plan, then choose a real Hevy routine. Each exercise is matched by its stable ID and checked against current recovery and effort history.</p><div className="empty-state compact"><strong>Hevy writes are not enabled here</strong><span>Plan adjustments stay in your local draft and do not change a routine.</span></div></BottomSheet>;
}
