import React, { useEffect, useMemo, useState } from "react";
import { BottomNav, BottomSheet, EvidenceRow, Header, Insight, MetricRow, RangeControl, Sparkline, TrendChart } from "./components";
import { Icon } from "./icons";
import { chartSeries, healthMetrics, metricDetails, recoveryDrivers } from "./data";
import { buildLiveView } from "./healthView";
import { daysForRange, fetchDashboard, formatGeneratedAt, syncDashboard, syncMessage } from "./portalData";
import { ExerciseDetailSheet, MuscleDetailSheet, PostWorkoutSheet, RoutineRecommendationSheet } from "./DetailSheets";
import { PhotoSheet } from "./PhotoSheet";
import { SettingEditor, SettingsMenu } from "./SettingsSheets";
import { loadSettings, persistSettings, resetSettings } from "./settings";
import { ExerciseListSheet, TrainingView, WorkoutTimelineSheet } from "./TrainingView";
import { resolveTab } from "./navigation";

const insightCopy = {
  Health: { title: "Your baseline is stable. Activity is trending up without extra cardiovascular strain.", copy: "Resting heart rate stayed typical while steps increased across the last four weeks." },
  Recovery: { title: "Recovery is steady, but sleep is doing most of the work.", copy: "HRV is holding near baseline while training load is elevated. Keep today's session at the planned intensity." },
  Training: { title: "Your pressing strength is moving. Pulling volume is lagging.", copy: "Bench Press estimated 1RM is up 4.8% over 8 weeks. Back volume is below your configured target for a third week." },
};

function Health({ range, setRange, openMetric, openPhotos, openPhysique, view }) {
  const insight = view?.insights.Health || insightCopy.Health;
  const evidence = view?.health.evidence || [
    { label: "Steps", value: "8,420", delta: "+11%" }, { label: "Resting HR", value: "54 bpm", delta: "typical", metric: "HRV" }, { label: "Weight", value: "71.8 kg", delta: "−0.4 kg" },
  ];
  const weights = view?.health.weightValues?.length > 1 ? view.health.weightValues : [4.5, 4.8, 4.1, 3.9, 4.2, 4.8, 4.3];
  return <>
    <Insight title={insight.title} copy={insight.copy} />
    <EvidenceRow items={evidence} onMetric={openMetric} />
    <RangeControl value={range} onChange={setRange} />
    <TrendChart data={view?.health.chart || chartSeries.Health} />
    <section className="list-section"><h2>Key metrics</h2>{(view?.health.metrics || healthMetrics).map((metric) => <MetricRow key={metric.label} {...metric} onClick={() => openMetric(metric.label === "Resting heart rate" ? "HRV" : metric.label)} />)}</section>
    <section className="body-section">
      <div className="section-title-row"><h2>Body composition</h2><button className="text-button" onClick={openPhysique}>Goal physique <Icon name="chevron" size={16} /></button></div>
      <div className="body-composition">
        <div><span className="subtle-label">Weight trend</span><Sparkline values={weights} /></div>
        <button className="photos-button" onClick={openPhotos}><Icon name="camera" size={25} /><span>Progress<br />photos</span><Icon name="chevron" size={17} /></button>
      </div>
    </section>
  </>;
}

function Recovery({ range, setRange, openMetric, view }) {
  const insight = view?.insights.Recovery || insightCopy.Recovery;
  const evidence = view?.recovery.evidence || [
    { label: "HRV", value: "62 ms", delta: "+3% vs baseline", metric: "HRV" }, { label: "Sleep", value: "7h 42m", delta: "+28m" }, { label: "Resting HR", value: "54 bpm", delta: "typical", metric: "HRV" },
  ];
  return <>
    <Insight title={insight.title} copy={insight.copy} />
    <EvidenceRow items={evidence} onMetric={openMetric} />
    <RangeControl value={range} onChange={setRange} />
    <TrendChart data={view?.recovery.chart || chartSeries.Recovery} />
    <section className="list-section"><h2>What’s driving recovery</h2>{(view?.recovery.drivers || recoveryDrivers).map((driver) => <MetricRow key={driver.title} icon={driver.icon} label={driver.title} meta={driver.detail} value="" delta="" tone={driver.icon === "dumbbell" ? "orange" : "blue"} onClick={() => openMetric(driver.title === "HRV baseline" ? "HRV" : driver.title)} />)}</section>
  </>;
}

function App() {
  const [tab, setTab] = useState(() => resolveTab(new URLSearchParams(window.location.search).get("tab"), localStorage.getItem("tong-fit:last-tab")));
  const [settings, setSettings] = useState(() => loadSettings());
  const [ranges, setRanges] = useState({ Health: "30D", Recovery: "7D", Training: "30D" });
  const [sheet, setSheet] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [cache, setCache] = useState({});
  const [loadState, setLoadState] = useState({ status: "loading", error: null });
  const activeDays = daysForRange(ranges[tab]);
  const payload = cache[activeDays];
  const view = useMemo(() => payload ? buildLiveView(payload, settings) : null, [payload, settings]);
  const metric = useMemo(() => typeof sheet === "string" ? metricDetails[sheet] : null, [sheet]);

  const load = async (days, { force = false } = {}) => {
    if (!force && cache[days]) return;
    setLoadState({ status: "loading", error: null });
    try {
      const result = await fetchDashboard(days);
      setCache((current) => ({ ...current, [days]: result }));
      setLoadState({ status: "live", error: null });
    } catch (error) {
      setLoadState({ status: "demo", error: error instanceof Error ? error.message : "Data connection unavailable" });
    }
  };

  useEffect(() => { load(activeDays); }, [activeDays]);
  useEffect(() => { localStorage.setItem("tong-fit:last-tab", tab); }, [tab]);

  const selectTab = (next) => {
    setTab(resolveTab(next));
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  };
  const setRange = (range) => setRanges((current) => ({ ...current, [tab]: range }));
  const saveSettings = (section, draft) => {
    const next = { ...settings, [section]: draft };
    setSettings(next);
    persistSettings(next);
    const labels = { goals: "Goals", training: "Training preferences", personal: "Personal context", analytics: "Analytics", physique: "Goal physique" };
    setSheet({ type: "settings", notice: `${labels[section]} saved on this browser.` });
  };
  const resetAllSettings = () => {
    const next = resetSettings();
    setSettings(next);
    setSheet({ type: "settings", notice: "Settings restored to defaults." });
  };
  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await syncDashboard();
      await load(activeDays, { force: true });
      setSheet({ type: "synced", message: syncMessage(result) });
    } catch (error) {
      setSheet({ type: "sync-error", message: error instanceof Error ? error.message : "Sync could not be completed" });
    } finally { setSyncing(false); }
  };
  const recommendation = view?.training.recommendation;
  const status = view ? "Live data" : loadState.status === "loading" ? "Loading data" : "Sample data";

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <main id="main-content" tabIndex="-1" className={tab === "Training" ? "training-mode" : ""}>
      <Header syncing={syncing} onSync={sync} onSettings={() => setSheet({ type: "settings" })} status={status} lastSynced={view ? formatGeneratedAt(view.lastSynced) : null} />
      {loadState.status === "demo" && tab !== "Training" ? <div className="data-note" role="status"><strong>Showing sample data.</strong> {loadState.error}</div> : null}
      <h1>{tab}</h1>
      {tab === "Health" ? <Health range={ranges.Health} setRange={setRange} openMetric={setSheet} openPhotos={() => setSheet({ type: "photos" })} openPhysique={() => setSheet({ type: "setting", section: "physique" })} view={view} /> : null}
      {tab === "Recovery" ? <Recovery range={ranges.Recovery} setRange={setRange} openMetric={setSheet} view={view} /> : null}
      {tab === "Training" ? <TrainingView range={ranges.Training} setRange={setRange} openRecommendation={() => setSheet({ type: "recommendation" })} openExercise={(exercise) => setSheet({ type: "exercise", exercise })} openWorkout={(workout) => setSheet({ type: "workout", workout })} openExerciseList={(exerciseGroups, initialMuscles) => setSheet({ type: "exercise-list", exerciseGroups, initialMuscles, activeMuscles: initialMuscles })} openTimeline={(workouts) => setSheet({ type: "timeline", workouts })} view={view} /> : null}
    </main>
    <BottomNav active={tab} onChange={selectTab} />
    {metric ? <BottomSheet title={metric.title} onClose={() => setSheet(null)}><p className="sheet-lead">{metric.body}</p><div className="method-block"><strong>How it’s calculated</strong><p>{metric.method}</p></div><p className="coverage">{view ? `Coverage: ${view.coverage.activity_complete_days || 0} activity days · ${view.coverage.sleep_nights || 0} sleep nights` : "Coverage: 27 of 30 days · Sample data"}</p></BottomSheet> : null}
    {sheet?.type === "settings" ? <SettingsMenu settings={settings} notice={sheet.notice} onEdit={(section) => setSheet({ type: "setting", section })} onReset={resetAllSettings} onClose={() => setSheet(null)} /> : null}
    {sheet?.type === "setting" ? <SettingEditor section={sheet.section} settings={settings} onSave={saveSettings} onClose={() => setSheet({ type: "settings" })} openPhotos={() => setSheet({ type: "photos" })} /> : null}
    {sheet?.type === "photos" ? <PhotoSheet onClose={() => setSheet(null)} /> : null}
    {sheet?.type === "exercise" ? <ExerciseDetailSheet exercise={sheet.exercise} onClose={() => setSheet(sheet.returnTo || null)} /> : null}
    {sheet?.type === "muscles" ? <MuscleDetailSheet muscles={sheet.muscles} settings={settings} onClose={() => setSheet(null)} /> : null}
    {sheet?.type === "workout" ? <PostWorkoutSheet workout={sheet.workout} settings={settings} onClose={() => setSheet(sheet.returnTo || null)} /> : null}
    {sheet?.type === "exercise-list" ? <ExerciseListSheet exerciseGroups={sheet.exerciseGroups} initialMuscles={sheet.initialMuscles} activeMuscles={sheet.activeMuscles} onMuscleChange={(activeMuscles) => setSheet({ ...sheet, activeMuscles })} onExercise={(exercise) => setSheet({ type: "exercise", exercise, returnTo: sheet })} onClose={() => setSheet(null)} /> : null}
    {sheet?.type === "timeline" ? <WorkoutTimelineSheet workouts={sheet.workouts} recommendation={recommendation} onWorkout={(workout) => setSheet({ type: "workout", workout, returnTo: sheet })} onReview={() => setSheet({ type: "recommendation", returnTo: sheet })} onClose={() => setSheet(null)} /> : null}
    {sheet?.type === "recommendation" ? <RoutineRecommendationSheet recommendation={recommendation || { exercise: "Bench Press", load: 82.5, reps: "7–9", targetRpe: settings.training.targetRpe, currentLoad: 80, explanation: "Sample recommendation based on recent working sets." }} onClose={() => setSheet(sheet.returnTo || null)} /> : null}
    {sheet?.type === "synced" ? <BottomSheet title="Data is current" onClose={() => setSheet(null)}><p className="sheet-lead">{sheet.message}</p><button className="primary-button full" onClick={() => setSheet(null)}>Done</button></BottomSheet> : null}
    {sheet?.type === "sync-error" ? <BottomSheet title="Sync needs attention" onClose={() => setSheet(null)}><p className="sheet-lead">{sheet.message}</p><button className="primary-button full" onClick={() => setSheet(null)}>Done</button></BottomSheet> : null}
  </div>;
}

export default App;
