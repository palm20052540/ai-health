import React, { useState } from "react";
import { BottomSheet, RangeControl } from "./components";
import { historyDate } from "./metricHistory.js";
import { validRpe } from "./recoveryModel.js";
import { finiteNumber, rpeCoverage } from "./trainingModel.js";
import { trainingHistory, workingRecords } from "./trainingHistory.js";

const number = (value, unit = "") => { const n = finiteNumber(value); return n == null ? "Unavailable" : `${n.toLocaleString("en", { maximumFractionDigits: 1 })}${unit}`; };
export function WorkingSetRecords({ session }) {
  const rows = workingRecords(session);
  return rows.length ? <ol className="working-records">{rows.map((set, index) => <li key={`${set.set_index ?? index}-${index}`}><strong>Set {finiteNumber(set.set_index) == null ? index + 1 : finiteNumber(set.set_index) + 1}</strong><span>{number(set.weight_kg, " kg")} × {number(set.reps, " reps")}</span><span>RPE {number(validRpe(set.rpe))}</span>{finiteNumber(set.duration_seconds) != null ? <span>{number(set.duration_seconds, " sec")}</span> : null}{finiteNumber(set.distance_meters) != null ? <span>{number(set.distance_meters, " m")}</span> : null}</li>)}</ol> : <p className="history-coverage">Individual working-set records are unavailable for this entry.</p>;
}
export function TrainingHistorySheet({ payload, range, dataState, returnTab = "Training", onRangeChange, onClose }) {
  const [selected, setSelected] = useState(null);
  const available = ["live", "stale"].includes(dataState);
  const workouts = available ? trainingHistory(payload, range) : [];
  const workout = workouts.find((row) => row.id === selected);
  return <BottomSheet title={workout ? "Session records" : "Training history"} onClose={onClose}>
    <div className="metric-history">
      <p className="sheet-lead">Hevy · recorded working sets · Bangkok time</p>
      <RangeControl value={range} onChange={(value) => { setSelected(null); onRangeChange(value); }} />
      <p className="history-coverage">Only workouts represented in this snapshot are listed. Recent workout summaries are limited to five; older sessions can have exercise records without full workout totals.</p>
      {dataState === "stale" ? <p className="data-note">Cached history · refresh before using it for training decisions.</p> : null}
      {!available ? <p role="status" className="empty-state compact">{dataState === "loading" ? "Loading training records…" : "Training history is unavailable. No sample sessions are shown."}</p> : workout ? <>
        <button type="button" className="text-button" onClick={() => setSelected(null)}>Back to session list</button>
        <h3>{workout.title}</h3><p className="history-coverage">{historyDate(workout.date)}</p>
        {workout.summary ? <p>{number(workout.summary.working_sets ?? workout.summary.completed_sets, " working sets")} · {number(workout.summary.volume_kg, " kg working volume")}</p> : <p className="history-coverage">Full workout totals are unavailable; available exercise records follow.</p>}
        {workout.exercises.length ? workout.exercises.map((exercise) => {
          const effort = rpeCoverage(exercise.session);
          return <article className="history-exercise" key={exercise.key}><h4>{exercise.name}</h4><p className="history-coverage">{number(exercise.session.working_sets ?? exercise.session.sets, " working sets")} · Avg RPE {number(effort.average)} · {number(effort.percent, "% RPE coverage")}</p><WorkingSetRecords session={exercise.session} /></article>;
        }) : <p className="empty-state compact">Exercise records were not returned for this workout.</p>}
      </> : workouts.length ? <><p className="history-coverage">{workouts.length} recorded sessions · newest first</p><ol className="history-records">{workouts.map((row) => <li key={row.id}><button type="button" className="history-session-button" onClick={() => setSelected(row.id)}><span><strong>{row.title}</strong><time dateTime={row.date}>{historyDate(row.date)}</time><small>{row.exercises.length} available exercise entries</small></span><span>View records</span></button></li>)}</ol></> : <p className="empty-state compact">No recorded sessions returned for this period.</p>}
      <button type="button" className="secondary-button full" onClick={onClose}>Back to {returnTab}</button>
    </div>
  </BottomSheet>;
}
