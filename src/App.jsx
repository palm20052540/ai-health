import React, { useEffect, useMemo, useRef, useState } from "react";
import { BottomNav, BottomSheet, EvidenceRow, Header, MetricRow, RangeControl, Sparkline, TrendChart } from "./components";
import { Icon } from "./icons";
import { metricDetails } from "./data";
import { DailyBrief } from "./DailyBrief";
import { AssistantSyncStatus, RecoveryMorningBrief, SavedTrainingBrief } from "./SavedAssistantBrief";
import { RecoveryCheckIn } from "./RecoveryCheckIn";
import { buildRecoveryDecision, persistRecovery, recoveryState, sourceFreshness } from "./recoveryModel";
import { buildLiveView } from "./healthView";
import { dashboardDataState, daysForRange, fetchDashboard, formatGeneratedAt, syncDashboard, syncMessage } from "./portalData";
import { ExerciseDetailSheet, MuscleDetailSheet, PostWorkoutSheet, RoutineRecommendationSheet } from "./DetailSheets";
import { PhotoSheet } from "./PhotoSheet";
import { SettingEditor, SettingsMenu } from "./SettingsSheets";
import { loadSettings, persistSettings, resetSettings } from "./settings";
import { ExerciseListSheet, TrainingView, WorkoutTimelineSheet } from "./TrainingView";
import { resolveTab } from "./navigation";
import { MetricHistorySheet } from "./MetricHistorySheet";
import { historyMetric } from "./metricHistory.js";

function Health({ range, setRange, openMetric, openPhotos, openPhysique, view, payload, settings, dataState, briefRefreshKey }) {
  return <>
    <DailyBrief payload={payload} settings={settings} dataState={dataState} refreshKey={briefRefreshKey} />
    <section className="list-section"><h2>Health metrics</h2><p className="coverage">Detailed source measurements for the selected period.</p></section>
    <RangeControl value={range} onChange={setRange} />
    {view ? <><EvidenceRow items={view.health.evidence} onMetric={openMetric} /><TrendChart data={view.health.chart} />
      <section className="list-section">{view.health.metrics.map((metric) => <MetricRow key={metric.label} {...metric} onClick={() => openMetric(metric.label)} />)}</section></> : <p className="empty-state">{dataState === "loading" ? "Loading health measurements…" : "Health measurements are unavailable. No sample values are shown."}</p>}
    <section className="body-section"><div className="section-title-row"><h2>Body composition</h2><button type="button" className="text-button" onClick={openPhysique}>Goal physique <Icon name="chevron" size={16} /></button></div>
      <div className="body-composition"><div><span className="subtle-label">Weight trend</span>{view?.health.weightValues?.length > 1 ? <Sparkline values={view.health.weightValues} /> : <p className="coverage">At least two measurements needed.</p>}</div><button type="button" className="photos-button" onClick={openPhotos}><Icon name="camera" size={25} /><span>Progress<br />photos</span><Icon name="chevron" size={17} /></button></div>
    </section>
  </>;
}

function Recovery({ range, setRange, openMetric, view, recovery, onApply, applying, error, settings, openGoals, briefRefreshKey, dataState }) {
  return <>
    <RecoveryCheckIn recovery={recovery} onApply={onApply} applying={applying} error={error} settings={settings} openGoals={openGoals} />
    <RecoveryMorningBrief refreshKey={briefRefreshKey} enabled={dataState !== "sample"} />
    <section className="list-section"><h2>Recovery evidence</h2></section>
    <RangeControl value={range} onChange={setRange} />
    {view ? <><EvidenceRow items={view.recovery.evidence} onMetric={openMetric} /><TrendChart data={view.recovery.chart} />
      <section className="list-section"><h2>What’s driving recovery</h2>{view.recovery.drivers.map((driver) => <MetricRow key={driver.title} icon={driver.icon} label={driver.title} meta={driver.detail} value="" delta="" tone={driver.icon === "dumbbell" ? "orange" : "blue"} onClick={() => openMetric(driver.title === "HRV baseline" ? "HRV" : driver.title)} />)}</section></> : <p className="empty-state">Current recovery measurements are unavailable.</p>}
  </>;
}

function SourceStatus({ payload }) {
  const rows = sourceFreshness(payload);
  return <details className="source-status"><summary>Source freshness · measurements and sync</summary><ul>{rows.map((row) => <li key={row.id}><strong>{row.label} · {row.status}</strong><span>Measured {formatGeneratedAt(row.measuredAt)} · synced {formatGeneratedAt(row.synced_at)}</span></li>)}</ul><p>Older measurements stay marked stale even when another source syncs. History windows only include records already stored.</p></details>;
}

function App() {
  const [tab, setTab] = useState(() => resolveTab(new URLSearchParams(window.location.search).get("tab"), localStorage.getItem("tong-fit:last-tab")));
  const [settings, setSettings] = useState(() => loadSettings());
  const [ranges, setRanges] = useState({ Health: "30D", Recovery: "7D", Training: "30D" });
  const [sheet, setSheet] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [briefRefreshKey, setBriefRefreshKey] = useState(0);
  const [cache, setCache] = useState({});
  const [now, setNow] = useState(Date.now);
  const [loadStates, setLoadStates] = useState({});
  const requests = useRef(new Map());
  const [appliedRecovery, setAppliedRecovery] = useState(null);
  const [applyingRecovery, setApplyingRecovery] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const applyingRef = useRef(false);
  const syncRef = useRef(false);
  const latestSettings = useRef(settings);
  latestSettings.current = settings;
  const activeDays = daysForRange(ranges[tab]);
  const payload = cache[activeDays];
  const loadState = loadStates[activeDays] || { status: 'loading', error: null };
  const dataState = dashboardDataState(payload, loadState);
  const personalPayload = ['sample', 'missing'].includes(dataState) ? null : payload;
  const recovery = recoveryState(appliedRecovery, cache[28], settings, now);
  const view = useMemo(() => personalPayload ? buildLiveView(personalPayload, settings) : null, [personalPayload, settings]);
  const metric = useMemo(() => typeof sheet === "string" ? metricDetails[sheet] : null, [sheet]);

  const load = (days, { force = false } = {}) => {
    if (requests.current.has(days)) {
      const pending = requests.current.get(days);
      return force ? pending.catch(() => {}).then(() => load(days, { force: true })) : pending;
    }
    if (!force && cache[days]) return Promise.resolve(cache[days]);
    setLoadStates((current) => ({ ...current, [days]: { status: 'loading', error: null } }));
    const task = fetchDashboard(days).then((result) => {
      setCache((current) => ({ ...current, [days]: result }));
      setLoadStates((current) => ({ ...current, [days]: { status: 'live', error: null } }));
      return result;
    }).catch((error) => {
      setLoadStates((current) => ({ ...current, [days]: { status: 'unavailable', error: error instanceof Error ? error.message : 'Data connection unavailable' } }));
      throw error;
    }).finally(() => requests.current.delete(days));
    requests.current.set(days, task);
    return task;
  };

  const applyRecovery = async (input) => {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplyingRecovery(true); setRecoveryError('');
    try {
      const fresh = await load(28, { force: true });
      const result = buildRecoveryDecision(fresh, latestSettings.current, input);
      setAppliedRecovery(result);
      if (!persistRecovery(result)) setRecoveryError('Recommendation updated, but this browser could not save the check-in inputs.');
    } catch {
      // Never retain a green decision after a failed evidence refresh.
      setAppliedRecovery(null);
      setRecoveryError('Current data could not be refreshed. Your draft is still here; no recommendation was applied. Try again when the connection is available.');
    } finally { applyingRef.current = false; setApplyingRecovery(false); }
  };

  useEffect(() => { load(activeDays).catch(() => {}); }, [activeDays]);
  useEffect(() => { load(28).catch(() => {}); const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { try { localStorage.setItem("tong-fit:last-tab", tab); } catch { /* Browser storage can be unavailable; navigation still works. */ } }, [tab]);

  const selectTab = (next) => {
    setTab(resolveTab(next));
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  };
  const setRange = (range) => setRanges((current) => ({ ...current, [tab]: range }));
  const openHealthMetric = (label) => {
    const name = historyMetric(label);
    setSheet(name ? { type: "metric-history", metric: name } : label);
  };
  const saveSettings = (section, draft) => {
    const next = { ...settings, [section]: draft };
    setSettings(next);
    const persisted = persistSettings(next);
    const labels = { goals: "Goals", training: "Training preferences", personal: "Personal context", analytics: "Analytics", physique: "Goal physique" };
    setSheet({ type: "settings", notice: persisted ? `${labels[section]} saved on this browser. Update Recovery to apply the new context.` : `${labels[section]} updated for this session only; browser storage is unavailable.` });
  };
  const resetAllSettings = () => {
    const next = resetSettings();
    setSettings(next);
    setSheet({ type: "settings", notice: "Settings restored to defaults." });
  };
  const sync = async () => {
    if (syncRef.current) return;
    syncRef.current = true; setSyncing(true);
    let assistantAnalysis = null;
    try {
      const result = await syncDashboard();
      assistantAnalysis = result?.assistant_analysis;
      setBriefRefreshKey((current) => current + 1);
      await Promise.allSettled([...requests.current.values()]);
      setCache({});
      setAppliedRecovery(null);
      await Promise.all([load(activeDays, { force: true }), load(28, { force: true })]);
      setSheet({ type: "synced", message: syncMessage(result), assistantAnalysis });
    } catch (error) {
      setSheet({ type: "sync-error", message: error instanceof Error ? error.message : "Sync could not be completed", assistantAnalysis });
    } finally { syncRef.current = false; setSyncing(false); }
  };
  const recommendation = view?.training.recommendation;
  const status = dataState === "live" ? "Live data" : dataState === "stale" ? "Cached data" : dataState === "sample" ? "Sample data" : loadState.status === "loading" ? "Loading data" : "Data unavailable";

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <main id="main-content" tabIndex="-1" className={tab === "Training" ? "training-mode" : ""}>
      <Header syncing={syncing} onSync={sync} onSettings={() => setSheet({ type: "settings" })} status={status} lastSynced={view ? formatGeneratedAt(view.lastSynced) : null} />
      {loadState.error ? <div className="data-note" role="status"><strong>{payload ? "Showing older cached measurements." : "Source data unavailable."}</strong> {loadState.error}</div> : null}
      {dataState === "sample" ? <div className="data-note" role="status">Sample snapshot received. Personal assessments and recommendations are withheld.</div> : null}
      <h1>{tab}</h1>
      {tab === "Health" ? <Health range={ranges.Health} setRange={setRange} openMetric={openHealthMetric} openPhotos={() => setSheet({ type: "photos" })} openPhysique={() => setSheet({ type: "setting", section: "physique" })} view={view} payload={payload} settings={settings} dataState={dataState} briefRefreshKey={briefRefreshKey} /> : null}
      {tab === "Recovery" ? <Recovery range={ranges.Recovery} setRange={setRange} openMetric={setSheet} view={view} recovery={recovery} onApply={applyRecovery} applying={applyingRecovery} error={recoveryError} settings={settings} openGoals={() => setSheet({ type: "setting", section: "goals" })} briefRefreshKey={briefRefreshKey} dataState={dataState} /> : null}
      {tab === "Training" ? <><SavedTrainingBrief refreshKey={briefRefreshKey} enabled={dataState !== "sample"} /><TrainingView range={ranges.Training} setRange={setRange} openRecommendation={() => setSheet({ type: "recommendation" })} openExercise={(exercise) => setSheet({ type: "exercise", exercise })} openWorkout={(workout) => setSheet({ type: "workout", workout })} openExerciseList={(exerciseGroups, initialMuscles) => setSheet({ type: "exercise-list", exerciseGroups, initialMuscles, activeMuscles: initialMuscles })} openTimeline={(workouts) => setSheet({ type: "timeline", workouts })} view={view} payload={personalPayload} settings={settings} recovery={dataState === "stale" ? { ...recovery, stale: true, decision: "unknown" } : recovery} dataState={dataState} /></> : null}
      <SourceStatus payload={payload} />
    </main>
    <BottomNav active={tab} onChange={selectTab} />
    {sheet?.type === "metric-history" ? <MetricHistorySheet metric={sheet.metric} payload={personalPayload} range={ranges.Health} dataState={loadState.status === "loading" ? "loading" : dataState} onRangeChange={(range) => setRanges((current) => ({ ...current, Health: range }))} onClose={() => setSheet(null)} /> : null}
    {metric ? <BottomSheet title={metric.title} onClose={() => setSheet(null)}><p className="sheet-lead">{metric.body}</p><div className="method-block"><strong>How it’s calculated</strong><p>{metric.method}</p></div><p className="coverage">{view ? `Coverage: ${view.coverage.activity_complete_days || 0} activity days · ${view.coverage.sleep_nights || 0} sleep nights` : "Coverage unavailable"}</p></BottomSheet> : null}
    {sheet?.type === "settings" ? <SettingsMenu settings={settings} notice={sheet.notice} onEdit={(section) => setSheet({ type: "setting", section })} onReset={resetAllSettings} onClose={() => setSheet(null)} /> : null}
    {sheet?.type === "setting" ? <SettingEditor section={sheet.section} settings={settings} onSave={saveSettings} onClose={() => setSheet({ type: "settings" })} openPhotos={() => setSheet({ type: "photos" })} /> : null}
    {sheet?.type === "photos" ? <PhotoSheet onClose={() => setSheet(null)} /> : null}
    {sheet?.type === "exercise" ? <ExerciseDetailSheet exercise={sheet.exercise} onClose={() => setSheet(sheet.returnTo || null)} /> : null}
    {sheet?.type === "muscles" ? <MuscleDetailSheet muscles={sheet.muscles} settings={settings} onClose={() => setSheet(null)} /> : null}
    {sheet?.type === "workout" ? <PostWorkoutSheet workout={sheet.workout} settings={settings} onClose={() => setSheet(sheet.returnTo || null)} /> : null}
    {sheet?.type === "exercise-list" ? <ExerciseListSheet exerciseGroups={sheet.exerciseGroups} initialMuscles={sheet.initialMuscles} activeMuscles={sheet.activeMuscles} onMuscleChange={(activeMuscles) => setSheet({ ...sheet, activeMuscles })} onExercise={(exercise) => setSheet({ type: "exercise", exercise, returnTo: sheet })} onClose={() => setSheet(null)} /> : null}
    {sheet?.type === "timeline" ? <WorkoutTimelineSheet workouts={sheet.workouts} recommendation={recommendation} onWorkout={(workout) => setSheet({ type: "workout", workout, returnTo: sheet })} onReview={() => setSheet({ type: "recommendation", returnTo: sheet })} onClose={() => setSheet(null)} /> : null}
    {sheet?.type === "recommendation" ? <RoutineRecommendationSheet recommendation={recommendation || { exercise: "No recommendation", load: null, reps: "—", targetRpe: settings.training.targetRpe, currentLoad: null, explanation: "Current source data is unavailable." }} onClose={() => setSheet(sheet.returnTo || null)} /> : null}
    {sheet?.type === "synced" ? <BottomSheet title="Sync result" onClose={() => setSheet(null)}><p className="sheet-lead">{sheet.message}</p><AssistantSyncStatus analysis={sheet.assistantAnalysis} /><button type="button" className="primary-button full" onClick={() => setSheet(null)}>Done</button></BottomSheet> : null}
    {sheet?.type === "sync-error" ? <BottomSheet title="Sync needs attention" onClose={() => setSheet(null)}><p className="sheet-lead">{sheet.message}</p><AssistantSyncStatus analysis={sheet.assistantAnalysis} /><button type="button" className="primary-button full" onClick={() => setSheet(null)}>Done</button></BottomSheet> : null}
  </div>;
}

export default App;
