import React, { useEffect, useMemo, useState } from "react";
import { BottomSheet, Insight, Sparkline } from "./components";
import { Icon } from "./icons";
import { fetchRoutine, fetchRoutines } from "./portalData";
import { buildLatestSessionReview, buildNextSessionPlan, buildProgressCoverage, finiteNumber, PROGRESS_RANGES, routineDetail, routineList, rpeCoverage, sessionDate } from "./trainingModel";

const MUSCLES = ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core", "Other"];
const TABS = [{ id: "latest", label: "Latest session review" }, { id: "next", label: "Next session plan" }, { id: "progress", label: "Long-term progress" }];
const EMPTY_SETTINGS = {};

function dateText(value, short = false) {
  if (!value) return "—";
  const parsed = new Date(String(value).length === 10 ? `${value}T00:00:00+07:00` : value);
  if (!Number.isFinite(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en", { timeZone: "Asia/Bangkok", month: "short", day: "numeric", ...(short ? {} : { year: "numeric" }) }).format(parsed);
}
function amount(value, unit = "") {
  const number = finiteNumber(value);
  return number == null ? "—" : `${number.toLocaleString("en", { maximumFractionDigits: 1 })}${unit}`;
}
function topSet(session) {
  const weight = finiteNumber(session?.best_set?.weight_kg), reps = finiteNumber(session?.best_set?.reps);
  return weight == null || reps == null ? "Loaded top set unavailable" : `${amount(weight)} kg × ${reps}`;
}
function sampledDateLabels(dates, max = 5) {
  if (dates.length <= max) return dates.map((date) => dateText(date, true));
  return Array.from({ length: max }, (_, index) => dateText(dates[Math.round(index / (max - 1) * (dates.length - 1))], true));
}
function SummaryStat({ label, value, detail }) {
  return <div className="muscle-stat"><dt>{label}</dt><dd><strong>{value}</strong><span>{detail}</span></dd></div>;
}
function EmptyState({ title, children }) {
  return <div className="empty-state compact training-state"><strong>{title}</strong><span>{children}</span></div>;
}

function LatestSession({ payload, onWorkout }) {
  const review = useMemo(() => buildLatestSessionReview(payload), [payload]);
  if (!review.latest) return <EmptyState title="No completed session yet">A real Hevy workout is needed before a session review can be shown.</EmptyState>;
  const { latest, previous, exercises } = review;
  const effort = rpeCoverage(latest);
  const volume = finiteNumber(latest.volume_kg), priorVolume = finiteNumber(previous?.volume_kg);
  const delta = volume != null && priorVolume != null ? volume - priorVolume : null;
  return <>
    <Insight tone="orange" icon="dumbbell" title={latest.title || "Latest completed session"} copy={`${dateText(sessionDate(latest))} · Review the logged work before choosing the next target.`} />
    <section className="training-review-card">
      <div className="section-title-row"><h2>Session overview</h2><button type="button" className="text-button" onClick={() => onWorkout?.(latest)}>Details <Icon name="chevron" size={16} /></button></div>
      <dl className="muscle-summary-grid" aria-label="Latest session summary">
        <SummaryStat label="Working volume" value={amount(volume, " kg")} detail="warm-up sets excluded" />
        <SummaryStat label="Working sets" value={amount(latest.working_sets ?? latest.completed_sets)} detail={`${amount(latest.exercise_count)} exercises`} />
        <SummaryStat label="Average RPE" value={amount(effort.average)} detail={effort.percent == null ? "coverage unknown" : `${Math.round(effort.percent)}% working-set coverage`} />
      </dl>
      <p className="training-coverage">{delta == null ? "No prior session-volume comparison is available." : `${delta >= 0 ? "+" : ""}${amount(delta)} kg versus the previous logged workout (${previous.title || "Workout"}, ${dateText(sessionDate(previous), true)}). The exercise mix may differ.`}</p>
      <p className="coverage">{review.narrative}</p>
    </section>
    <section><div className="section-title-row"><h2>Exercise comparisons</h2></div>
      <div className="training-comparison-list">{exercises.length ? exercises.map((exercise) => <article className="training-comparison-row" key={exercise.key}>
        <div><strong>{exercise.name}</strong><span className="training-status-pill">{exercise.previous ? "Same exercise ID" : "Limited comparison"}</span></div>
        <p>{topSet(exercise.current)}</p><small>{exercise.previous ? `Previous: ${topSet(exercise.previous)} · ${dateText(sessionDate(exercise.previous), true)}` : "No verified prior comparison"}</small>
        <p className="training-coverage">{exercise.narrative}</p>
      </article>) : <EmptyState title="Exercise detail is incomplete">The session total is real. Exercise-level history for this workout is not available in the selected dataset.</EmptyState>}</div>
    </section>
  </>;
}

function setReference(baseline) {
  if (!baseline.setDetails?.length) return "No working-set targets in this routine";
  return baseline.setDetails.map((set, index) => `Set ${index + 1}: ${amount(set.loadKg, " kg")} × ${set.reps ?? (set.repMin == null ? "—" : `${set.repMin}–${set.repMax ?? set.repMin}`)}`).join(" · ");
}

function PlanRows({ plan, context }) {
  const [overrides, setOverrides] = useState({ context: "", values: {} });
  const active = overrides.context === context ? overrides.values : {};
  const update = (key, field, value) => setOverrides((current) => ({ context, values: { ...(current.context === context ? current.values : {}), [key]: { ...(current.context === context ? current.values[key] : {}), [field]: value } } }));
  return <div className="training-plan-list">{plan.rows.map((row) => {
    const adjusted = active[row.key];
    const fields = { ...row.prescription, ...adjusted };
    return <article className="training-plan-card" key={row.key}>
      <div className="section-title-row"><h3>{row.name}</h3><span className={`training-status-pill ${row.status}`}>{adjusted ? "Your adjusted draft" : row.label}</span></div>
      <p className="training-coverage">Routine reference · {setReference(row.baseline)}</p>
      {row.status === "abstain" && row.editable ? <p className="coverage">These are unchanged routine reference values. Evidence is insufficient for an automatic target.</p> : null}
      <div className="training-plan-fields">
        <label><span>Load (kg)</span><input aria-label={`${row.name} load in kg`} type="number" min="0" max="1000" step="0.5" placeholder="Per-set / unknown" disabled={!row.editable} value={fields.loadKg ?? ""} onChange={(event) => update(row.key, "loadKg", event.target.value)} /></label>
        <label><span>Working sets</span><input aria-label={`${row.name} working sets`} type="number" min="0" max="30" step="1" placeholder="—" disabled={!row.editable} value={fields.sets ?? ""} onChange={(event) => update(row.key, "sets", event.target.value)} /></label>
        <label><span>Reps / set</span><input aria-label={`${row.name} reps per set`} type="number" min="1" max="100" step="1" placeholder="Per-set / unknown" disabled={!row.editable} value={fields.reps ?? ""} onChange={(event) => update(row.key, "reps", event.target.value)} /></label>
      </div>
      <ul className="training-plan-reasons">{row.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      {adjusted ? <><p className="coverage">Your edits are local choices, not validated recommendations. They do not override pain or recovery limits.</p><button type="button" className="text-button" onClick={() => setOverrides((current) => { const next = { ...current.values }; delete next[row.key]; return { context, values: next }; })}>Reset this exercise</button></> : null}
    </article>;
  })}</div>;
}

function NextSessionPlan({ payload, settings, recovery, dataState }) {
  const [routines, setRoutines] = useState([]);
  const [selected, setSelected] = useState("");
  const [listState, setListState] = useState("loading");
  const [detailState, setDetailState] = useState({ id: "", status: "idle", routine: null, error: "" });
  const [listError, setListError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setListState("loading"); setListError("");
    fetchRoutines().then((response) => {
      if (!active) return;
      const items = routineList(response);
      setRoutines(items); setSelected((id) => items.some((item) => String(item.id) === id) ? id : String(items[0]?.id || "")); setListState("ready");
    }).catch((error) => { if (active) { setListState("error"); setListError(error.message || "Routines could not be loaded."); } });
    return () => { active = false; };
  }, [retry]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setDetailState({ id: selected, status: "loading", routine: null, error: "" });
    fetchRoutine(selected).then((response) => {
      if (!active) return;
      const detail = routineDetail(response);
      if (!detail || !Array.isArray(detail.exercises) || (detail.id != null && String(detail.id) !== selected)) throw new Error("The routine response did not match the selected routine.");
      setDetailState({ id: selected, status: "ready", routine: { ...detail, id: selected }, error: "" });
    }).catch((error) => { if (active) setDetailState({ id: selected, status: "error", routine: null, error: error.message || "Routine detail could not be loaded." }); });
    return () => { active = false; };
  }, [selected, retry]);
  const routine = detailState.id === selected && detailState.status === "ready" ? detailState.routine : null;
  const plan = useMemo(() => buildNextSessionPlan({ routine, payload, settings, recovery, dataState }), [routine, payload, settings, recovery, dataState]);
  const context = JSON.stringify([selected, payload?.generated_at, settings, recovery, dataState]);
  return <>
    <Insight tone="orange" icon="dumbbell" title="Choose the routine you’ll actually train" copy="Targets use this routine’s stable exercise IDs, logged effort, your goal, and the recovery check-in you applied." />
    <section className="training-plan-header">
      {listState === "loading" ? <p role="status">Loading Hevy routines…</p> : null}
      {listState === "error" ? <><EmptyState title="Hevy routines unavailable">{listError}</EmptyState><button type="button" className="text-button" onClick={() => setRetry((value) => value + 1)}>Retry routines</button></> : null}
      {listState === "ready" && !routines.length ? <EmptyState title="No Hevy routines found">Create a routine in Hevy, then reload the list to prepare a plan from it.</EmptyState> : null}
      {routines.length ? <div className="routine-selector"><label><span>Hevy routine</span><select aria-label="Hevy routine" value={selected} onChange={(event) => setSelected(event.target.value)}>{routines.map((item) => <option value={item.id} key={item.id}>{item.title || "Untitled routine"}</option>)}</select></label></div> : null}
      {selected && (detailState.id !== selected || detailState.status === "loading") ? <p role="status">Loading selected routine…</p> : null}
      {detailState.id === selected && detailState.status === "error" ? <><p className="form-error" role="alert">{detailState.error}</p><button type="button" className="text-button" onClick={() => setRetry((value) => value + 1)}>Retry selected routine</button></> : null}
      {routine ? <><div className="section-title-row"><h2>{plan.title}</h2><span className="training-status-pill">Recovery: {plan.recoveryLabel}</span></div><p className="coverage">{plan.summary}</p></> : null}
    </section>
    {routine && !plan.rows.length ? <EmptyState title="This routine has no exercises">Choose a routine with working-set targets.</EmptyState> : null}
    {routine ? <PlanRows plan={plan} context={context} /> : null}
  </>;
}

function normalizedExercises(view, selected) {
  return (view?.training?.exercises || []).filter((item) => (item.muscleGroup || "Other") === selected).map((item) => {
    const sessions = (item.sessions || []).slice().sort((a, b) => String(sessionDate(a)).localeCompare(String(sessionDate(b))));
    const latest = sessions.at(-1);
    const values = sessions.map((session) => finiteNumber(session.best_estimated_1rm_kg)).filter((value) => value != null && value > 0);
    const delta = values.length > 1 && values[0] > 0 ? 100 * (values.at(-1) - values[0]) / values[0] : null;
    return { ...item, sessions, values, topSet: topSet(latest), e1rm: amount(latest?.best_estimated_1rm_kg, " kg"), metric: `${sessions.length} sessions · estimated 1RM`, result: delta == null ? "Building" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`, detail: "range change", delta };
  });
}
function liveSummary(view, selected, exercises) {
  const aggregates = (view?.training?.muscles || []).filter((item) => selected.includes(item.name));
  const sessions = exercises.flatMap((item) => item.sessions || []);
  const history = new Map();
  for (const exercise of exercises) for (const session of exercise.sessions) {
    const volume = finiteNumber(session.volume_kg);
    if (volume == null) continue;
    const date = sessionDate(session), key = session.workout_id || date;
    if (!key || !date) continue;
    const point = history.get(key) || { date, volume: 0 };
    point.volume += volume; history.set(key, point);
  }
  const points = [...history.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const changes = exercises.map((item) => item.delta).filter((value) => value != null);
  const strength = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : null;
  const knownVolumes = sessions.map((item) => finiteNumber(item.volume_kg)).filter((value) => value != null);
  const hardSets = aggregates.map((item) => finiteNumber(item.hard_sets)).filter((value) => value != null);
  const dates = sessions.map(sessionDate).filter(Boolean).sort();
  const coverageDetail = dates.length ? `${dateText(dates[0], true)}–${dateText(dates.at(-1), true)}` : "no sessions in range";
  const coverage = sessions.map(rpeCoverage);
  const knownRpe = coverage.filter((item) => item.average != null && item.count > 0);
  const count = knownRpe.reduce((sum, item) => sum + item.count, 0);
  return {
    volume: knownVolumes.length ? amount(knownVolumes.reduce((sum, value) => sum + value, 0), " kg") : "—",
    hardSets: hardSets.length ? hardSets.reduce((sum, value) => sum + value, 0) : "—",
    strength: strength == null ? "—" : `${strength >= 0 ? "+" : ""}${strength.toFixed(1)}%`,
    frequency: new Set(sessions.map((item) => item.workout_id).filter(Boolean)).size,
    last: dateText(dates.at(-1), true), chart: points.map((item) => item.volume), chartDates: points.map((item) => item.date), coverageDetail,
    rpe: count ? (knownRpe.reduce((sum, item) => sum + item.average * item.count, 0) / count).toFixed(1) : "—",
  };
}
function ProgressChart({ summary, muscle }) {
  if (!summary.chart.length) return <EmptyState title="No volume history for these muscles">No trend is drawn until real working-set records are available.</EmptyState>;
  const values = summary.chart;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => [values.length === 1 ? 180 : 40 + index / (values.length - 1) * 280, 108 - value / max * 86]);
  const ticks = [1, .75, .5, .25, 0].map((ratio, index) => ({ y: 22 + index * 21.5, label: amount(Math.round(max * ratio)) }));
  const chartSummary = `${muscle} working volume across ${summary.frequency} recorded workouts, ${summary.coverageDetail}. Volume alone does not measure improvement.`;
  return <div className="muscle-progress-chart"><div className="chart-heading"><strong>{muscle} volume (kg)</strong><span>{summary.frequency} workouts<small>{summary.coverageDetail}</small></span></div><svg viewBox="0 0 330 126" role="img" aria-label={chartSummary}><desc>{chartSummary}</desc>{ticks.map(({ y, label }) => <React.Fragment key={y}><text x="0" y={y + 3} className="chart-axis-label">{label}</text><line x1="36" x2="320" y1={y} y2={y} className="grid-line" /></React.Fragment>)}<defs><linearGradient id="progress-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#146bfa" stopOpacity=".18" /><stop offset="100%" stopColor="#146bfa" stopOpacity="0" /></linearGradient></defs>{points.length > 1 ? <><path d={`M ${points.map((point) => point.join(" ")).join(" L ")} L ${points.at(-1)[0]} 116 L ${points[0][0]} 116 Z`} fill="url(#progress-fill)" /><polyline points={points.map((point) => point.join(",")).join(" ")} fill="none" stroke="#146BFA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></> : null}{points.map(([x, y], index) => <circle key={index} cx={x} cy={y} r="2.6" fill="#146BFA" />)}</svg><div className="chart-labels">{sampledDateLabels(summary.chartDates).map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div></div>;
}
function ExerciseRows({ exercises, onExercise, limit = 3 }) {
  if (!exercises.length) return <EmptyState title="No exercises for this muscle yet">A logged working set with a muscle mapping is needed to begin the trend.</EmptyState>;
  return <div className="muscle-exercise-list">{exercises.slice(0, limit).map((exercise, index) => <button type="button" key={exercise.exercise_template_id || `${exercise.name}-${index}`} className="muscle-exercise-row" onClick={() => onExercise?.(exercise)}><span className="exercise-primary"><strong>{exercise.name}</strong><small>{exercise.metric}</small></span><span className="exercise-load"><strong>{exercise.topSet}</strong><small>e1RM {exercise.e1rm}</small></span>{exercise.values?.length > 1 ? <Sparkline values={exercise.values} /> : <span className="coverage">More history needed</span>}<span className="exercise-change"><strong>{exercise.result}</strong><small>{exercise.detail}</small></span><Icon name="chevron" size={17} className="chevron" /></button>)}</div>;
}
function TimelineRows({ workouts = [], onWorkout, limit = 3 }) {
  if (!workouts.length) return <EmptyState title="No logged workouts">Completed workouts will appear here after they are available from Hevy.</EmptyState>;
  return <div className="workout-timeline-list">{workouts.slice(0, limit).map((workout, index) => <button type="button" className="timeline-workout" key={workout.id || workout.workout_id || index} onClick={() => onWorkout?.(workout)}><span className="timeline-rail"><i /></span><span className="timeline-date"><strong>{dateText(sessionDate(workout))}</strong><small>{amount(workout.exercise_count)} exercises</small></span><span className="timeline-detail"><strong>{workout.title || "Workout"}</strong><small>{amount(workout.working_sets ?? workout.completed_sets)} working sets · {amount(workout.volume_kg, " kg")}</small></span><Icon name="chevron" size={17} className="chevron" /></button>)}</div>;
}
function LongTermProgress({ payload, view, range, setRange, openExercise, openWorkout, openExerciseList, openTimeline }) {
  const [selected, setSelected] = useState(["Chest"]);
  const exerciseGroups = useMemo(() => Object.fromEntries(MUSCLES.map((muscle) => [muscle, normalizedExercises(view, muscle)])), [view]);
  const exercises = useMemo(() => selected.flatMap((muscle) => exerciseGroups[muscle] || []), [exerciseGroups, selected]);
  const summary = useMemo(() => liveSummary(view, selected, exercises), [view, selected, exercises]);
  const coverage = useMemo(() => buildProgressCoverage(payload, range), [payload, range]);
  const selectedLabel = selected.join(" + ");
  const workouts = view?.training?.recentWorkouts || [];
  const selectMuscle = (muscle) => setSelected((current) => current.includes(muscle) ? current.length === 1 ? current : current.filter((item) => item !== muscle) : MUSCLES.filter((item) => current.includes(item) || item === muscle));
  return <>
    <Insight tone="orange" icon="dumbbell" title="Progress follows the history you’ve recorded" copy={coverage.narrative} />
    <section className="muscle-progress-section">
      <div className="section-title-row progress-heading"><h2>Progress by muscle <Icon name="info" size={16} /></h2><div className="compact-range" role="group" aria-label="Progress range">{PROGRESS_RANGES.map((item) => <button type="button" aria-pressed={range === item.value} className={range === item.value ? "active" : ""} key={item.value} onClick={() => setRange?.(item.value)}>{item.label}</button>)}</div></div>
      <p className="training-coverage">{coverage.first ? `${dateText(coverage.first)}–${dateText(coverage.last)} · ` : ""}{coverage.rpePercent == null ? "RPE coverage unknown" : `${Math.round(coverage.rpePercent)}% RPE coverage`}. Muscle totals use primary-muscle attribution; secondary overlap is not counted.</p>
      <div className="muscle-pills" role="group" aria-label="Muscle groups">{MUSCLES.filter((muscle) => muscle !== "Other" || exerciseGroups.Other.length).map((muscle) => <button type="button" aria-pressed={selected.includes(muscle)} className={selected.includes(muscle) ? "active" : ""} key={muscle} onClick={() => selectMuscle(muscle)}>{muscle}</button>)}</div>
      <div className="selected-muscle-title"><h2>{selectedLabel}</h2><span>{summary.strength} avg e1RM change</span></div>
      <dl className="muscle-summary-grid" aria-label={`${selectedLabel} training summary`}>
        <SummaryStat label="Working volume" value={summary.volume} detail={summary.coverageDetail} />
        <SummaryStat label="Hard sets" value={summary.hardSets} detail="logged RPE ≥7 only" />
        <SummaryStat label="Average RPE" value={summary.rpe} detail="recorded sets only" />
        <SummaryStat label="Frequency" value={summary.frequency} detail="recorded workouts" />
        <SummaryStat label="Last trained" value={summary.last} detail="latest observed" />
      </dl>
      <ProgressChart summary={summary} muscle={selectedLabel} />
      <p className="coverage">Estimated 1RM is a descriptive estimate, not a max-test prescription. Muscle change is the mean of comparable exercise trends; neither it nor more volume proves improvement on its own.</p>
    </section>
    <section className="muscle-exercises-section"><div className="section-title-row"><h2>{selectedLabel} exercises</h2><button type="button" className="text-button" onClick={() => openExerciseList?.(exerciseGroups, selected)}>See all <Icon name="chevron" size={16} /></button></div><ExerciseRows exercises={exercises} onExercise={openExercise} /></section>
    <section className="workout-timeline-section"><div className="section-title-row"><h2>Recent workout timeline</h2><button type="button" className="text-button" onClick={() => openTimeline?.(workouts)}>See all <Icon name="chevron" size={16} /></button></div><TimelineRows workouts={workouts} onWorkout={openWorkout} limit={1} /></section>
  </>;
}

export function TrainingView({ payload, view, settings = EMPTY_SETTINGS, recovery, dataState = payload ? "live" : "unavailable", range = "30D", setRange, openExercise, openWorkout, openExerciseList, openTimeline }) {
  const [tab, setTab] = useState("latest");
  const changeTab = (next) => { setTab(next); if (next === "progress" && !PROGRESS_RANGES.some((item) => item.value === range)) setRange?.("30D"); };
  const onTabKey = (event, index) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    changeTab(TABS[nextIndex].id); event.currentTarget.parentElement.children[nextIndex]?.focus();
  };
  return <>
    <div className="training-subtabs" role="tablist" aria-label="Training views">{TABS.map((item, index) => <button type="button" role="tab" id={`training-tab-${item.id}`} aria-controls={`training-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? "active" : ""} key={item.id} onKeyDown={(event) => onTabKey(event, index)} onClick={() => changeTab(item.id)}>{item.label}</button>)}</div>
    {TABS.map((item) => <div key={item.id} role="tabpanel" id={`training-panel-${item.id}`} aria-labelledby={`training-tab-${item.id}`} hidden={tab !== item.id} tabIndex="0">
      {tab === item.id ? <>
        {dataState === "loading" ? <p className="training-coverage" role="status">Loading live training history…</p> : null}
        {dataState === "unavailable" ? <p className="training-coverage" role="status">Live training history is unavailable. Automatic prescriptions are paused.</p> : null}
        {item.id === "latest" ? <LatestSession payload={payload} onWorkout={openWorkout} /> : null}
        {item.id === "next" ? <NextSessionPlan payload={payload} settings={settings} recovery={recovery} dataState={dataState} /> : null}
        {item.id === "progress" ? <LongTermProgress payload={payload} view={view} range={range} setRange={setRange} openExercise={openExercise} openWorkout={openWorkout} openExerciseList={openExerciseList} openTimeline={openTimeline} /> : null}
      </> : null}
    </div>)}
  </>;
}

export function ExerciseListSheet({ exerciseGroups, initialMuscles, activeMuscles, onMuscleChange, onExercise, onClose }) {
  const muscles = activeMuscles?.length ? activeMuscles : initialMuscles?.length ? initialMuscles : ["Chest"];
  const exercises = muscles.flatMap((muscle) => exerciseGroups?.[muscle] || []);
  const toggleMuscle = (muscle) => onMuscleChange?.(muscles.includes(muscle) ? muscles.length === 1 ? muscles : muscles.filter((item) => item !== muscle) : MUSCLES.filter((item) => muscles.includes(item) || item === muscle));
  return <BottomSheet title="Exercise progress" onClose={onClose}><p className="sheet-lead">Compare recorded top sets and estimated 1RM trends. Missing history is not filled with sample data.</p><div className="muscle-pills sheet-filter-pills" role="group" aria-label="Filter exercises by muscle group">{MUSCLES.filter((muscle) => muscle !== "Other" || exerciseGroups?.Other?.length).map((item) => <button type="button" aria-pressed={muscles.includes(item)} className={muscles.includes(item) ? "active" : ""} key={item} onClick={() => toggleMuscle(item)}>{item}</button>)}</div><div className="exercise-list-summary"><span><strong>{exercises.length}</strong> tracked</span></div><ExerciseRows exercises={exercises} onExercise={onExercise} limit={exercises.length} /></BottomSheet>;
}
export function WorkoutTimelineSheet({ workouts = [], onWorkout, onClose }) {
  return <BottomSheet title="Workout timeline" onClose={onClose}><p className="sheet-lead">Recent logged working sets. Session volume depends on the exercise mix and is not an improvement score.</p><TimelineRows workouts={workouts} onWorkout={onWorkout} limit={workouts.length} /></BottomSheet>;
}
