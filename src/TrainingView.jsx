import React, { useMemo, useState } from "react";
import { BottomSheet, Insight, Sparkline } from "./components";
import { Icon } from "./icons";

const MUSCLES = ["Chest", "Back", "Legs", "Shoulders", "Arms"];

const SAMPLE_EXERCISES = {
  Chest: [
    { name: "Bench Press", metric: "38 sets · Barbell", result: "+4.8%", detail: "e1RM", topSet: "82.5 kg × 7–9", e1rm: "102 kg", pr: true, values: [4.1, 4.6, 4.5, 5.2, 5.8, 6.1, 6.8] },
    { name: "Incline Press", metric: "16 sets · Barbell", result: "+3.1%", detail: "e1RM", topSet: "60 kg × 8–10", e1rm: "75 kg", values: [3.8, 4.2, 4.0, 4.7, 4.5, 5.1, 5.7] },
    { name: "Chest Fly", metric: "12 sets · Cable", result: "+1.9%", detail: "e1RM", topSet: "32 kg × 10–12", e1rm: "42 kg", values: [3.9, 4.1, 4.5, 4.0, 4.7, 4.6, 5.2] },
    { name: "Machine Press", metric: "10 sets · Machine", result: "+2.4%", detail: "e1RM", topSet: "72.5 kg × 9", e1rm: "94 kg", values: [3.5, 3.8, 4.0, 4.4, 4.3, 4.8, 5.2] },
    { name: "Dip Machine", metric: "9 sets · Machine", result: "+4 reps", detail: "at 55 kg", topSet: "55 kg × 14", e1rm: "81 kg", values: [3.2, 3.5, 3.9, 4.1, 4.6, 5.0, 5.4] },
  ],
  Back: [
    { name: "Lat Pulldown", metric: "20 sets · Cable", result: "+2 reps", detail: "at 60 kg", topSet: "60 kg × 10", e1rm: "80 kg", values: [3.1, 4.0, 4.5, 5.1, 5.0, 6.0, 6.7] },
    { name: "Chest-supported Row", metric: "16 sets · Machine", result: "+3.4%", detail: "e1RM", topSet: "70 kg × 9", e1rm: "91 kg", values: [3.4, 3.7, 4.1, 4.0, 4.8, 5.2, 5.8] },
    { name: "Cable Row", metric: "12 sets · Cable", result: "Holding", detail: "RPE 8", topSet: "62 kg × 10", e1rm: "83 kg", values: [4.1, 4.0, 4.3, 4.2, 4.4, 4.3, 4.5] },
    { name: "Straight-arm Pulldown", metric: "9 sets · Cable", result: "+2 reps", detail: "at 32 kg", topSet: "32 kg × 12", e1rm: "45 kg", values: [3.2, 3.5, 3.8, 4.1, 4.0, 4.7, 5.1] },
    { name: "Single-arm Row", metric: "10 sets · Dumbbell", result: "+2 kg", detail: "top set", topSet: "34 kg × 10", e1rm: "45 kg", values: [3.6, 3.8, 4.0, 4.4, 4.6, 5.0, 5.4] },
  ],
  Legs: [
    { name: "Squat", metric: "18 sets · Barbell", result: "+2.5%", detail: "e1RM", topSet: "110 kg × 6", e1rm: "132 kg", values: [4.0, 4.2, 4.6, 4.4, 5.1, 5.4, 5.8] },
    { name: "Romanian Deadlift", metric: "14 sets · Barbell", result: "+5 kg", detail: "top set", topSet: "100 kg × 8", e1rm: "127 kg", values: [3.5, 3.8, 4.2, 4.7, 4.6, 5.4, 6.0] },
    { name: "Leg Press", metric: "15 sets · Machine", result: "+4 reps", detail: "at 180 kg", topSet: "180 kg × 12", e1rm: "252 kg", values: [3.0, 3.4, 3.9, 4.2, 4.7, 5.3, 5.9] },
    { name: "Bulgarian Split Squat", metric: "10 sets · Dumbbell", result: "+2 kg", detail: "per hand", topSet: "26 kg × 9", e1rm: "34 kg", values: [3.3, 3.6, 3.9, 4.2, 4.4, 4.9, 5.3] },
    { name: "Leg Curl", metric: "12 sets · Machine", result: "+3 reps", detail: "at 45 kg", topSet: "45 kg × 13", e1rm: "65 kg", values: [3.4, 3.7, 4.1, 4.0, 4.5, 4.8, 5.2] },
  ],
  Shoulders: [
    { name: "Overhead Press", metric: "16 sets · Barbell", result: "+3.8%", detail: "e1RM", topSet: "50 kg × 7", e1rm: "62 kg", values: [3.7, 4.0, 4.2, 4.6, 4.5, 5.1, 5.8] },
    { name: "Lateral Raise", metric: "20 sets · Dumbbell", result: "+2 reps", detail: "at 12 kg", topSet: "12 kg × 15", e1rm: "18 kg", values: [3.2, 3.7, 4.0, 4.5, 4.3, 5.0, 5.6] },
    { name: "Reverse Fly", metric: "12 sets · Cable", result: "Holding", detail: "RPE 8", topSet: "18 kg × 14", e1rm: "26 kg", values: [4.0, 4.2, 4.1, 4.3, 4.5, 4.4, 4.6] },
    { name: "Machine Shoulder Press", metric: "10 sets · Machine", result: "+2.7%", detail: "e1RM", topSet: "45 kg × 10", e1rm: "60 kg", values: [3.4, 3.7, 4.0, 4.1, 4.5, 4.9, 5.3] },
    { name: "Face Pull", metric: "12 sets · Cable", result: "+3 reps", detail: "at 25 kg", topSet: "25 kg × 15", e1rm: "38 kg", values: [3.5, 3.8, 3.7, 4.2, 4.5, 4.8, 5.2] },
  ],
  Arms: [
    { name: "EZ-bar Curl", metric: "14 sets · Barbell", result: "+3 reps", detail: "at 30 kg", topSet: "30 kg × 11", e1rm: "41 kg", values: [3.2, 3.5, 4.0, 4.1, 4.7, 5.0, 5.6] },
    { name: "Cable Pushdown", metric: "16 sets · Cable", result: "+4.1%", detail: "e1RM", topSet: "35 kg × 12", e1rm: "49 kg", values: [3.6, 4.0, 4.3, 4.2, 4.9, 5.3, 5.9] },
    { name: "Hammer Curl", metric: "12 sets · Dumbbell", result: "+2 kg", detail: "top set", topSet: "18 kg × 10", e1rm: "24 kg", values: [3.4, 3.6, 3.9, 4.3, 4.7, 5.0, 5.5] },
    { name: "Overhead Triceps Extension", metric: "10 sets · Cable", result: "+2 reps", detail: "at 27.5 kg", topSet: "27.5 kg × 12", e1rm: "38 kg", values: [3.2, 3.5, 3.8, 4.0, 4.4, 4.7, 5.1] },
    { name: "Preacher Curl", metric: "9 sets · Machine", result: "+2.2%", detail: "e1RM", topSet: "32.5 kg × 9", e1rm: "42 kg", values: [3.4, 3.6, 3.9, 4.2, 4.3, 4.8, 5.2] },
  ],
};

const SAMPLE_SUMMARIES = {
  Chest: { volume: "12,420 kg", volumeDelta: "+4.8%", hardSets: 38, setsDelta: "+6%", strength: "+6.2%", frequency: 4, last: "Sep 26", ago: "2 days ago", chart: [3, 3.2, 4.8, 4.5, 5.5, 4.9, 6.8, 7.6, 7.0, 8.2, 8.9, 7.7, 10.1, 11.2, 10.3, 11.0, 10.4, 12.3, 13.5, 12.2, 12.5, 13.8, 13.4, 14.8, 15.7] },
  Back: { volume: "10,860 kg", volumeDelta: "+2.3%", hardSets: 32, setsDelta: "+3%", strength: "+4.1%", frequency: 3, last: "Sep 25", ago: "3 days ago", chart: [3, 3.5, 3.8, 4.1, 4.0, 4.8, 5.1, 5.6, 5.4, 6.2, 6.0, 6.8, 7.2, 7.0, 7.8, 8.1, 8.7, 8.5, 9.0, 9.4] },
  Legs: { volume: "18,240 kg", volumeDelta: "+6.4%", hardSets: 42, setsDelta: "+8%", strength: "+5.0%", frequency: 3, last: "Sep 24", ago: "4 days ago", chart: [3, 3.4, 3.1, 4.0, 4.6, 4.3, 5.0, 5.4, 5.1, 6.2, 6.8, 6.4, 7.3, 7.7, 7.4, 8.2, 8.9, 9.5] },
  Shoulders: { volume: "7,980 kg", volumeDelta: "+3.6%", hardSets: 28, setsDelta: "+4%", strength: "+3.8%", frequency: 3, last: "Sep 26", ago: "2 days ago", chart: [3.4, 3.6, 3.9, 4.1, 4.0, 4.5, 4.8, 5.0, 5.4, 5.2, 5.8, 6.2, 6.4, 6.8, 7.1] },
  Arms: { volume: "6,420 kg", volumeDelta: "+2.9%", hardSets: 26, setsDelta: "+2%", strength: "+4.0%", frequency: 3, last: "Sep 26", ago: "2 days ago", chart: [3, 3.2, 3.5, 3.8, 4.1, 4.0, 4.6, 4.9, 5.1, 5.6, 5.4, 6.0, 6.4, 6.8] },
};

const SAMPLE_TIMELINE = [
  { id: "sample-1", title: "Upper Body", date: "Sep 26, 2026", ago: "2 days ago", exercise_count: 6, completed_sets: 18, volume_kg: 12420, average_rpe: 8.2, highlights: ["Bench Press 82.5 kg × 8 · PR", "Incline Press 60 kg × 9", "Chest Fly 32 kg × 12"] },
  { id: "sample-2", title: "Push", date: "Sep 23, 2026", ago: "5 days ago", exercise_count: 5, completed_sets: 16, volume_kg: 10230, average_rpe: 8.1, highlights: ["Bench Press 80 kg × 8", "Overhead Press 50 kg × 7"] },
  { id: "sample-3", title: "Upper Body", date: "Sep 20, 2026", ago: "8 days ago", exercise_count: 6, completed_sets: 17, volume_kg: 9860, average_rpe: 7.8, highlights: ["Incline Press 57.5 kg × 9 · PR", "Lat Pulldown 60 kg × 10"] },
];

const SAMPLE_SESSION_DATES = [
  "2026-08-23T10:00:00+07:00",
  "2026-08-30T10:00:00+07:00",
  "2026-09-06T10:00:00+07:00",
  "2026-09-13T10:00:00+07:00",
  "2026-09-20T10:00:00+07:00",
  "2026-09-26T10:00:00+07:00",
];

function sampleSessions(exercise) {
  const trend = exercise.values.slice(-SAMPLE_SESSION_DATES.length);
  const finalE1rm = Number.parseFloat(exercise.e1rm) || 40;
  const finalLoad = Number.parseFloat(exercise.topSet) || Math.round((finalE1rm * 0.78) / 2.5) * 2.5;
  const targetReps = Number(exercise.topSet.match(/×\s*(\d+)/)?.[1]) || 8;
  const holding = exercise.result === "Holding";
  const lastTrend = trend.at(-1);

  return trend.map((point, index) => {
    const sessionsAgo = trend.length - 1 - index;
    const estimated = holding && index >= trend.length - 3
      ? finalE1rm - [0.6, 0.3, 0][index - (trend.length - 3)]
      : finalE1rm + (point - lastTrend) * 1.5;
    const loadStep = Math.ceil(sessionsAgo / 2) * 2.5;
    const weight = Math.max(2.5, finalLoad - loadStep);
    const reps = Math.max(5, targetReps - (index % 3 === 0 ? 1 : 0));

    return {
      workout_id: `sample-${exercise.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index + 1}`,
      start_time_bangkok: SAMPLE_SESSION_DATES[index],
      best_estimated_1rm_kg: Number(estimated.toFixed(1)),
      best_set: { weight_kg: Number(weight.toFixed(1)), reps },
      average_rpe: Number((7.6 + index * 0.12 + (holding && index > 2 ? 0.2 : 0)).toFixed(1)),
      volume_kg: Math.round(weight * reps * 3),
    };
  });
}

function withSampleHistory(exercise) {
  return { ...exercise, sessions: sampleSessions(exercise) };
}

function exerciseMuscle(name = "") {
  const value = name.toLowerCase();
  if (/bench|chest|fly|pec/.test(value)) return "Chest";
  if (/row|pull|lat|deadlift|chin|back/.test(value)) return "Back";
  if (/squat|leg|lunge|calf|hamstring|quad|romanian/.test(value)) return "Legs";
  if (/shoulder|overhead|lateral|reverse fly|rear delt/.test(value)) return "Shoulders";
  if (/curl|tricep|pushdown|extension/.test(value)) return "Arms";
  return "Chest";
}

function dateText(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", { timeZone: "Asia/Bangkok", month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function shortDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", { timeZone: "Asia/Bangkok", month: "short", day: "numeric" }).format(new Date(value));
}

function sampledDateLabels(dates, max = 5) {
  if (!dates.length) return [];
  if (dates.length <= max) return dates.map(shortDate);
  return Array.from({ length: max }, (_, index) => dates[Math.round((index / (max - 1)) * (dates.length - 1))]).map(shortDate);
}

function normalizedExercises(view, selected) {
  if (!view?.training.exercises?.length) return SAMPLE_EXERCISES[selected].map(withSampleHistory);
  return view.training.exercises.filter((item) => (item.muscleGroup || exerciseMuscle(item.name)) === selected).map((item) => {
    const latest = item.sessions?.at(-1);
    const topSet = latest?.best_set;
    return { ...item, topSet: topSet?.weight_kg == null ? "No loaded set" : `${topSet.weight_kg} kg × ${topSet.reps ?? "—"}`, e1rm: latest?.best_estimated_1rm_kg == null ? "—" : `${Number(latest.best_estimated_1rm_kg).toFixed(1)} kg`, pr: item.result?.startsWith("+") };
  });
}

function liveSummary(view, selectedMuscles, exercises) {
  if (!view) return SAMPLE_SUMMARIES[selectedMuscles[0]];
  const sessions = exercises.flatMap((item) => item.sessions || []);
  const selectedSet = new Set(selectedMuscles);
  const aggregates = (view.training.muscles || []).filter((item) => selectedSet.has(item.name));
  const unique = new Set(sessions.map((item) => item.workout_id || item.start_time_bangkok || item.date_bangkok).filter(Boolean));
  const values = exercises.flatMap((item) => item.values || []).filter(Number.isFinite);
  const changeValues = exercises.map((item) => Number.parseFloat(item.result)).filter(Number.isFinite);
  const aggregateStrengths = aggregates.map((item) => item.strength_change_percent).filter((value) => value != null && Number.isFinite(Number(value))).map(Number);
  const strength = aggregateStrengths.length
    ? aggregateStrengths.reduce((a, b) => a + b, 0) / aggregateStrengths.length
    : changeValues.length ? changeValues.reduce((a, b) => a + b, 0) / changeValues.length : null;
  const dates = sessions.map((item) => item.start_time_bangkok || item.date_bangkok || item.start_time || item.date).filter(Boolean).sort();
  const sessionVolume = sessions.reduce((sum, item) => sum + Number(item.volume_kg || 0), 0);
  const aggregateVolume = aggregates.reduce((sum, item) => sum + Number(item.volume_kg || 0), 0);
  const volume = aggregateVolume || sessionVolume;
  const history = new Map();
  for (const aggregate of aggregates) {
    for (const point of aggregate.volume_history || []) {
      const key = point.workout_id || point.date;
      const current = history.get(key) || { date: point.date, volume_kg: 0 };
      current.volume_kg += Number(point.volume_kg || 0);
      history.set(key, current);
    }
  }
  const orderedHistory = [...history.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const historyDates = orderedHistory.map((item) => item.date).filter(Boolean);
  const volumeChart = orderedHistory.map((item) => item.volume_kg);
  const hardSets = aggregates.reduce((sum, item) => sum + Number(item.hard_sets || 0), 0);
  const weightedRpe = aggregates.reduce((result, item) => {
    const weight = Number(item.hard_sets || 0);
    const rpe = Number(item.average_rpe);
    return Number.isFinite(rpe) ? { total: result.total + rpe * weight, weight: result.weight + weight } : result;
  }, { total: 0, weight: 0 });
  const aggregateDates = aggregates.map((item) => item.last_trained).filter(Boolean).sort();
  const latestDate = aggregateDates.at(-1) || dates.at(-1);
  const coverageDates = historyDates.length ? historyDates : dates;
  const coverageStart = coverageDates[0];
  const coverageEnd = coverageDates.at(-1);
  const coverageDetail = coverageStart
    ? coverageStart === coverageEnd ? shortDate(coverageStart) : `${shortDate(coverageStart)}–${shortDate(coverageEnd)}`
    : "no sessions in range";
  return {
    volume: volume ? `${Math.round(volume).toLocaleString()} kg` : "—",
    volumeDelta: coverageDetail,
    hardSets: hardSets || "—",
    setsDelta: `${weightedRpe.weight ? (weightedRpe.total / weightedRpe.weight).toFixed(1) : view.training.evidence?.[2]?.value || "—"} avg RPE`,
    strength: strength == null ? "Building" : `${strength >= 0 ? "+" : ""}${strength.toFixed(1)}%`,
    frequency: history.size || unique.size,
    last: latestDate ? dateText(latestDate).replace(", 2026", "") : "—",
    ago: latestDate ? "latest session" : "no session",
    chart: volumeChart.length ? volumeChart.length === 1 ? [volumeChart[0], volumeChart[0]] : volumeChart : values.length > 1 ? values : [0, 0],
    chartDates: historyDates.length ? historyDates : dates,
    coverageDetail,
  };
}

function ProgressChart({ summary, range, muscle }) {
  const values = summary.chart?.length > 1 ? summary.chart : [0, 0];
  const max = Math.max(...values, 1);
  const points = values.map((number, index) => [40 + (index / (values.length - 1)) * 280, 108 - (number / max) * 86]);
  const labels = sampledDateLabels(summary.chartDates || []);
  const ticks = [1, .75, .5, .25, 0].map((ratio, index) => ({ y: 22 + index * 21.5, label: ratio ? `${Math.round(max * ratio / 1000)}K` : "0" }));
  const chartSummary = `${muscle} volume across ${summary.frequency} recorded sessions from ${summary.coverageDetail}.`;
  return <div className="muscle-progress-chart"><div className="chart-heading"><strong>{summary.volume === "—" ? "Strength trend" : `${muscle} volume (kg)`}</strong><span>{summary.frequency} sessions<small>{summary.coverageDetail}</small></span></div><svg viewBox="0 0 330 126" role="img" aria-label={chartSummary}><desc>{chartSummary}</desc>{ticks.map(({ y, label }) => <React.Fragment key={`${y}-${label}`}><text x="0" y={y + 3} className="chart-axis-label">{label}</text><line x1="36" x2="320" y1={y} y2={y} className="grid-line" /></React.Fragment>)}<defs><linearGradient id="progress-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#146bfa" stopOpacity=".18" /><stop offset="100%" stopColor="#146bfa" stopOpacity="0" /></linearGradient></defs><path d={`M ${points.map((point) => point.join(" ")).join(" L ")} L ${points.at(-1)[0]} 116 L ${points[0][0]} 116 Z`} fill="url(#progress-fill)" /><polyline points={points.map((point) => point.join(",")).join(" ")} fill="none" stroke="#146BFA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />{points.map(([x, y], index) => <circle key={index} cx={x} cy={y} r="2.6" fill="#146BFA" />)}</svg><div className="chart-labels">{labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div></div>;
}

function SummaryStat({ label, value, detail }) {
  return <div className="muscle-stat"><dt>{label}</dt><dd><strong>{value}</strong><span>{detail}</span></dd></div>;
}

function ExerciseRows({ exercises, onExercise, limit = 3 }) {
  if (!exercises.length) return <div className="empty-state compact"><strong>No exercises for this muscle yet</strong><span>Complete a logged working set to begin the trend.</span></div>;
  return <div className="muscle-exercise-list">{exercises.slice(0, limit).map((exercise) => <button key={exercise.name} className="muscle-exercise-row" onClick={() => onExercise(exercise)}><span className="exercise-primary"><strong>{exercise.name}</strong><small>{exercise.metric}</small></span><span className="exercise-load"><strong>{exercise.topSet}</strong><small>e1RM {exercise.e1rm}</small></span><Sparkline values={exercise.values?.length > 1 ? exercise.values : [0, 0]} /><span className="exercise-change"><strong>{exercise.result}</strong><small>{exercise.pr ? "PR" : exercise.detail}</small></span><Icon name="chevron" size={17} className="chevron" /></button>)}</div>;
}

function TimelineRows({ workouts, onWorkout, limit = 3 }) {
  return <div className="workout-timeline-list">{workouts.slice(0, limit).map((workout, index) => <button className="timeline-workout" key={workout.id || workout.workout_id || index} onClick={() => onWorkout(workout)}><span className="timeline-rail"><i /></span><span className="timeline-date"><strong>{workout.date || dateText(workout.start_time_bangkok)}</strong><small>{workout.ago || `${workout.exercise_count || 0} exercises`}</small></span><span className="timeline-detail"><strong>{workout.title || "Workout"}</strong><small>{workout.exercise_count || 0} exercises · {workout.completed_sets || 0} sets · {Number(workout.volume_kg || 0).toLocaleString()} kg</small>{(workout.highlights || []).slice(0, 3).map((highlight) => <em key={highlight}>{highlight}</em>)}</span><Icon name="chevron" size={17} className="chevron" /></button>)}</div>;
}

export function TrainingView({ range, setRange, openRecommendation, openExercise, openWorkout, openExerciseList, openTimeline, view }) {
  const [selected, setSelected] = useState(["Chest"]);
  const exerciseGroups = useMemo(() => Object.fromEntries(MUSCLES.map((muscle) => [muscle, normalizedExercises(view, muscle)])), [view]);
  const exercises = useMemo(() => selected.flatMap((muscle) => exerciseGroups[muscle] || []), [exerciseGroups, selected]);
  const summary = useMemo(() => liveSummary(view, selected, exercises), [view, selected, exercises]);
  const selectedLabel = selected.join(" + ");
  const workouts = view?.training.recentWorkouts?.length ? view.training.recentWorkouts : SAMPLE_TIMELINE;
  const insight = view?.insights.Training || { title: "You’re getting stronger, especially in your chest.", copy: "Bench Press volume is up 4.8% over the last 30 days." };
  const selectMuscle = (muscle) => setSelected((current) => current.includes(muscle)
    ? current.length === 1 ? current : current.filter((item) => item !== muscle)
    : MUSCLES.filter((item) => current.includes(item) || item === muscle));
  const onMuscleKeyDown = (event, index) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? MUSCLES.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + MUSCLES.length) % MUSCLES.length;
    event.currentTarget.parentElement.children[nextIndex]?.focus();
  };
  return <>
    <Insight tone="orange" icon="dumbbell" title={insight.title} copy={insight.copy} />
    <section className="muscle-progress-section">
      <div className="section-title-row progress-heading"><h2>Progress by muscle <Icon name="info" size={16} /></h2><div className="compact-range" role="group" aria-label="Progress range">{["7D", "30D", "6M", "1Y"].map((item) => <button aria-pressed={range === item} className={range === item ? "active" : ""} key={item} onClick={() => setRange(item)}>{item}</button>)}</div></div>
      <div className="muscle-pills" role="group" aria-label="Muscle groups">{MUSCLES.map((muscle, index) => <button aria-pressed={selected.includes(muscle)} className={selected.includes(muscle) ? "active" : ""} key={muscle} onKeyDown={(event) => onMuscleKeyDown(event, index)} onClick={() => selectMuscle(muscle)}>{muscle}</button>)}</div>
      <div className="selected-muscle-title"><h2>{selectedLabel}</h2><span>{summary.strength} strength</span></div>
      <dl className="muscle-summary-grid" aria-label={`${selectedLabel} training summary`}>
        <SummaryStat label="Volume" value={summary.volume} detail={summary.volumeDelta} />
        <SummaryStat label="Hard sets" value={summary.hardSets} detail={summary.setsDelta} />
        <SummaryStat label="Strength (e1RM)" value={summary.strength} detail={summary.coverageDetail} />
        <SummaryStat label="Frequency" value={summary.frequency} detail="sessions" />
        <SummaryStat label="Last trained" value={summary.last} detail={summary.ago} />
      </dl>
      <ProgressChart summary={summary} range={range} muscle={selectedLabel} />
    </section>
    <section className="muscle-exercises-section"><div className="section-title-row"><h2>{selectedLabel} exercises</h2><button className="text-button" onClick={() => openExerciseList(exerciseGroups, selected)}>See all <Icon name="chevron" size={16} /></button></div><ExerciseRows exercises={exercises} onExercise={openExercise} /></section>
    <section className="workout-timeline-section"><div className="section-title-row"><h2>Workout timeline</h2><button className="text-button" onClick={() => openTimeline(workouts)}>See all <Icon name="chevron" size={16} /></button></div><TimelineRows workouts={workouts} onWorkout={openWorkout} limit={1} /></section>
  </>;
}

export function ExerciseListSheet({ exerciseGroups, initialMuscles, activeMuscles, onMuscleChange, onExercise, onClose }) {
  const muscles = activeMuscles?.length ? activeMuscles : initialMuscles?.length ? initialMuscles : ["Chest"];
  const exercises = muscles.flatMap((muscle) => exerciseGroups?.[muscle] || []);
  const improving = exercises.filter((exercise) => exercise.result?.startsWith("+")).length;
  const toggleMuscle = (muscle) => onMuscleChange(muscles.includes(muscle)
    ? muscles.length === 1 ? muscles : muscles.filter((item) => item !== muscle)
    : MUSCLES.filter((item) => muscles.includes(item) || item === muscle));
  return <BottomSheet title="Exercise progress" onClose={onClose}>
    <p className="sheet-lead">Compare strength trends, top sets, and recent momentum by muscle group.</p>
    <div className="muscle-pills sheet-filter-pills" role="group" aria-label="Filter exercises by muscle group">{MUSCLES.map((item) => <button aria-pressed={muscles.includes(item)} className={muscles.includes(item) ? "active" : ""} key={item} onClick={() => toggleMuscle(item)}>{item}</button>)}</div>
    <div className="exercise-list-summary" aria-live="polite"><span><strong>{exercises.length}</strong> tracked</span><span><strong>{improving}</strong> improving</span></div>
    <ExerciseRows exercises={exercises} onExercise={onExercise} limit={exercises.length} />
  </BottomSheet>;
}

export function WorkoutTimelineSheet({ workouts, recommendation, onWorkout, onReview, onClose }) {
  const next = recommendation || { exercise: "Bench Press", load: 82.5, reps: "7–9", targetRpe: 8 };
  return <BottomSheet title="Workout timeline" onClose={onClose}><p className="sheet-lead">Recent workouts, with top sets and PRs highlighted.</p><TimelineRows workouts={workouts} onWorkout={onWorkout} limit={workouts.length} /><div className="timeline-next-session"><span><small>Next session</small><strong>{next.exercise} · {next.load} kg × {next.reps}</strong></span><button onClick={onReview}>Review</button></div></BottomSheet>;
}
