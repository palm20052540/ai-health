import React, { useEffect, useMemo, useRef, useState } from "react";
import { BottomNav, BottomSheet, EvidenceRow, Header, MetricRow, RangeControl, Sparkline, TrendChart } from "./components";
import { Icon } from "./icons";
import { metricDetails } from "./data";
import { DailyBrief } from "./DailyBrief";
import { AssistantSyncStatus, RecoveryMorningBrief, SavedTrainingBrief } from "./SavedAssistantBrief";
import { RecoveryCheckIn } from "./RecoveryCheckIn";
import { buildRecoveryDecision, persistRecovery, recoveryState, sourceFreshness } from "./recoveryModel";
import { buildLiveView } from "./healthView";
import { dashboardDataState, daysForRange, fetchDashboard, fetchOwnerSession, formatGeneratedAt, syncDashboard, syncMessage } from "./portalData";
import { ExerciseDetailSheet, MuscleDetailSheet, PostWorkoutSheet, RoutineRecommendationSheet } from "./DetailSheets";
import { PhotoSheet } from "./PhotoSheet";
import { SettingEditor, SettingsMenu } from "./SettingsSheets";
import { loadSettings, persistSettings, resetSettings } from "./settings";
import { ExerciseListSheet, TrainingView, WorkoutTimelineSheet } from "./TrainingView";
import { resolveTab } from "./navigation";
import { MetricHistorySheet } from "./MetricHistorySheet";
import { TrainingHistorySheet } from "./TrainingHistorySheet";
import { historyMetric } from "./metricHistory.js";
import { createDashboardCache } from "./dashboardCache.js";
import { ownerStorage } from "./ownerStorage.js";
import { clearSavedBriefCache, setBriefCacheOwner } from "./briefCache.js";

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

function Recovery({ range, setRange, openMetric, view, recovery, onApply, applying, error, settings, openGoals, briefRefreshKey, dataState, storage }) {
  return <>
    <RecoveryCheckIn storage={storage} recovery={recovery} onApply={onApply} applying={applying} error={error} settings={settings} openGoals={openGoals} />
    <RecoveryMorningBrief refreshKey={briefRefreshKey} enabled={dataState === "live"} disabledStatus={dataState === "sample" ? "sample" : ["missing", "unavailable"].includes(dataState) ? "unavailable" : "loading"} />
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
  const [, setCacheRevision] = useState(0);
  const [session, setSession] = useState({ status: "checking", ownerId: null });
  const cacheRef = useRef(null);
  if (!cacheRef.current) {
    let storage; try { storage = window.sessionStorage; } catch { /* Memory-only fallback. */ }
    cacheRef.current = createDashboardCache({ fetcher: fetchDashboard, storage, onChange: () => setCacheRevision((value) => value + 1), onAuthFailure: () => lockPrivate() });
  }
  const snapshots = cacheRef.current;
  const sourceKeys = useRef(new Map());
  const verifyRef = useRef(null);
  const verifiedOwnerRef = useRef(null);
  const preferencesRef = useRef(null);
  const focusRestoreRef = useRef(null);
  const activeDaysRef = useRef(30);
  const sessionRef = useRef(session); sessionRef.current = session;
  const sessionGeneration = useRef(0);
  const [now, setNow] = useState(Date.now);
  const [appliedRecovery, setAppliedRecovery] = useState(null);
  const [applyingRecovery, setApplyingRecovery] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const applyingRef = useRef(false);
  const syncRef = useRef(false);
  const latestSettings = useRef(settings);
  latestSettings.current = settings;
  const activeDays = daysForRange(ranges[tab]);
  activeDaysRef.current = activeDays;
  const loadState = snapshots.read(activeDays);
  const payload = loadState.payload;
  const dataState = dashboardDataState(payload, loadState);
  const personalPayload = ['sample', 'missing', 'unavailable'].includes(dataState) ? null : payload;
  const recoveryEvidence = snapshots.read(28);
  const evaluatedRecovery = recoveryState(appliedRecovery, recoveryEvidence.payload, settings, now);
  const recovery = ["live", "cached"].includes(recoveryEvidence.status) && !syncing ? evaluatedRecovery : { ...evaluatedRecovery, stale: true, decision: "unknown" };
  const view = useMemo(() => personalPayload ? buildLiveView(personalPayload, settings) : null, [personalPayload, settings]);
  const metric = useMemo(() => typeof sheet === "string" ? metricDetails[sheet] : null, [sheet]);

  const invalidateBriefs = () => { clearSavedBriefCache(); setBriefRefreshKey((value) => value + 1); };
  const lockPrivate = () => {
    sessionGeneration.current++; verifiedOwnerRef.current = null; snapshots.lock(); setBriefCacheOwner(null); sourceKeys.current.clear();
    setSession({ status: "unavailable", ownerId: null }); setAppliedRecovery(null); setSheet(null); invalidateBriefs();
  };
  const load = async (days, options = {}) => {
    const result = await snapshots.load(days, options);
    const key = JSON.stringify([result?.recap?.freshness, result?.recap?.summary, result?.recap?.evidence]);
    if (sourceKeys.current.has(days) && sourceKeys.current.get(days) !== key) { setAppliedRecovery(null); invalidateBriefs(); }
    sourceKeys.current.set(days, key);
    return result;
  };
  const verifySession = () => {
    if (verifyRef.current) return verifyRef.current;
    const generation = sessionGeneration.current;
    focusRestoreRef.current = document.activeElement;
    setSession((current) => ({ ...current, status: "checking" }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const promise = fetchOwnerSession(controller.signal).then((result) => {
      if (generation !== sessionGeneration.current) return;
      if (typeof result.ownerId !== "string" || !result.ownerId.trim()) throw new Error("Owner identity unavailable");
      if (verifiedOwnerRef.current && verifiedOwnerRef.current !== result.ownerId) { sessionGeneration.current++; setAppliedRecovery(null); setSheet(null); sourceKeys.current.clear(); invalidateBriefs(); }
      if (verifiedOwnerRef.current !== result.ownerId) {
        let storage; try { storage = window.localStorage; } catch { /* Private memory-only preferences. */ }
        preferencesRef.current = ownerStorage(result.ownerId, storage || null); setSettings(loadSettings(preferencesRef.current));
      }
      verifiedOwnerRef.current = result.ownerId;
      snapshots.activate(result.ownerId); setBriefCacheOwner(result.ownerId);
      setSession({ status: "ready", ownerId: result.ownerId });
      requestAnimationFrame(() => { if (focusRestoreRef.current?.isConnected) focusRestoreRef.current.focus?.(); });
      // Cached records can render immediately; their authority is renewed separately.
      load(activeDaysRef.current, { force: true }).catch(() => {});
      if (activeDaysRef.current !== 28) load(28, { force: true }).catch(() => {});
    }).catch(() => { if (generation === sessionGeneration.current) lockPrivate(); })
      .finally(() => { clearTimeout(timeout); verifyRef.current = null; });
    verifyRef.current = promise; return promise;
  };

  const applyRecovery = async (input) => {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplyingRecovery(true); setRecoveryError('');
    try {
      const generation = sessionGeneration.current;
      const fresh = await load(28, { force: true });
      if (generation !== sessionGeneration.current || syncRef.current) return;
      const result = buildRecoveryDecision(fresh, latestSettings.current, input);
      setAppliedRecovery(result);
      if (!persistRecovery(result, preferencesRef.current)) setRecoveryError('Recommendation updated, but this browser could not save the check-in inputs.');
    } catch {
      // Never retain a green decision after a failed evidence refresh.
      setAppliedRecovery(null);
      setRecoveryError('Current data could not be refreshed. Your draft is still here; no recommendation was applied. Try again when the connection is available.');
    } finally { applyingRef.current = false; setApplyingRecovery(false); }
  };

  useEffect(() => { if (session.status === "ready") load(activeDays).catch(() => {}); }, [activeDays, session.status]);
  useEffect(() => {
    verifySession();
    const timer = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible" && sessionRef.current.status === "ready" && !syncRef.current) {
        for (const days of new Set([activeDaysRef.current, 28])) {
          const cached = snapshots.read(days);
          if (cached.status === "stale" && !cached.error && !cached.refreshing) load(days, { force: true }).catch(() => {});
        }
      }
    }, 10000);
    const focus = () => { if (document.visibilityState === "visible") verifySession(); };
    const hide = () => setSession((current) => ({ ...current, status: "checking" }));
    const authFailure = () => lockPrivate();
    globalThis.addEventListener("focus", focus); globalThis.addEventListener("pageshow", focus); globalThis.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", focus); globalThis.addEventListener("tong-fit:auth-failed", authFailure);
    return () => { clearInterval(timer); globalThis.removeEventListener("focus", focus); globalThis.removeEventListener("pageshow", focus); globalThis.removeEventListener("pagehide", hide); document.removeEventListener("visibilitychange", focus); globalThis.removeEventListener("tong-fit:auth-failed", authFailure); };
  }, []);
  useEffect(() => { try { localStorage.setItem("tong-fit:last-tab", tab); } catch { /* Browser storage can be unavailable; navigation still works. */ } }, [tab]);

  const selectTab = (next) => {
    setTab(resolveTab(next));
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  };
  const setRange = (range) => setRanges((current) => ({ ...current, [tab]: range }));
  const openHealthMetric = (label) => {
    if (label === "Recent training load") { setSheet({ type: "training-history", tab }); return; }
    const name = historyMetric(label);
    setSheet(name ? { type: "metric-history", metric: name, tab } : label);
  };
  const saveSettings = (section, draft) => {
    const next = { ...settings, [section]: draft };
    setSettings(next); setAppliedRecovery(null); invalidateBriefs();
    const persisted = persistSettings(next, preferencesRef.current);
    const labels = { goals: "Goals", training: "Training preferences", personal: "Personal context", analytics: "Analytics", physique: "Goal physique" };
    setSheet({ type: "settings", notice: persisted ? `${labels[section]} saved on this browser. Update Recovery to apply the new context.` : `${labels[section]} updated for this session only; browser storage is unavailable.` });
  };
  const resetAllSettings = () => {
    const next = resetSettings(preferencesRef.current);
    setSettings(next); setAppliedRecovery(null); invalidateBriefs();
    setSheet({ type: "settings", notice: "Settings restored to defaults." });
  };
  const sync = async () => {
    if (syncRef.current) return;
    syncRef.current = true; setSyncing(true);
    snapshots.invalidate(); sourceKeys.current.clear(); setAppliedRecovery(null); setSheet(null); invalidateBriefs();
    let assistantAnalysis = null;
    try {
      const result = await syncDashboard();
      assistantAnalysis = result?.assistant_analysis;
      snapshots.invalidate(); invalidateBriefs();
      await Promise.all([...new Set([activeDaysRef.current, 28])].map((days) => load(days, { force: true })));
      setSheet({ type: "synced", message: syncMessage(result), assistantAnalysis });
    } catch (error) {
      snapshots.markUnavailable("Sync did not confirm fresh data. Refresh the view to check existing source records.");
      setAppliedRecovery(null); invalidateBriefs();
      setSheet({ type: "sync-error", message: error instanceof Error ? error.message : "Sync could not be completed", assistantAnalysis });
    } finally { syncRef.current = false; setSyncing(false); }
  };
  const recommendation = view?.training.recommendation;
  const status = loadState.status === "cached" ? "Cached data" : dataState === "live" ? "Live data" : dataState === "stale" ? "Cached data" : dataState === "sample" ? "Sample data" : loadState.status === "loading" ? "Loading data" : "Data unavailable";

  if (session.status === "unavailable" || (!verifiedOwnerRef.current && session.status !== "ready")) return <div className="app-shell"><main><h1>ต๊อง Fit</h1><p role="status">{session.status === "checking" ? "Checking private access…" : "Private data is locked. Check your sign-in and try again."}</p>{session.status === "unavailable" ? <button type="button" className="primary-button" onClick={verifySession}>Try again</button> : null}</main></div>;

  return <>{session.status === "checking" ? <div className="app-shell"><main><p role="status">Checking private access…</p></main></div> : null}<div key={session.ownerId} className="app-shell" hidden={session.status !== "ready"} inert={session.status !== "ready"}>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <main id="main-content" tabIndex="-1" className={tab === "Training" ? "training-mode" : ""}>
      <Header syncing={syncing} onSync={sync} onSettings={() => setSheet({ type: "settings" })} status={status} lastSynced={view ? formatGeneratedAt(view.lastSynced) : null} />
      {loadState.storedAt ? <p className="cache-status" role="status">{loadState.status === "live" ? "Source checked" : "Private cached snapshot"} {Math.max(0, Math.floor((now - loadState.storedAt) / 1000))}s ago{loadState.refreshing ? " · refreshing…" : ""}. Measurements keep their own source dates.{loadState.status === "stale" ? " Read-only until refreshed." : ""}<button type="button" className="text-button" disabled={loadState.refreshing || syncing} onClick={() => load(activeDays, { force: true }).catch(() => {})}>Refresh view</button></p> : null}
      {loadState.error ? <div className="data-note" role="status"><strong>{payload ? "Showing older cached measurements." : "Source data unavailable."}</strong> {loadState.error}{!payload ? <button type="button" className="text-button" onClick={() => load(activeDays, { force: true }).catch(() => {})}>Refresh view</button> : null}</div> : null}
      {dataState === "sample" ? <div className="data-note" role="status">Sample snapshot received. Personal assessments and recommendations are withheld.</div> : null}
      <h1>{tab}</h1>
      {tab === "Health" ? <Health range={ranges.Health} setRange={setRange} openMetric={openHealthMetric} openPhotos={() => setSheet({ type: "photos" })} openPhysique={() => setSheet({ type: "setting", section: "physique" })} view={view} payload={payload} settings={settings} dataState={dataState} briefRefreshKey={briefRefreshKey} /> : null}
      {tab === "Recovery" ? <Recovery storage={preferencesRef.current} range={ranges.Recovery} setRange={setRange} openMetric={openHealthMetric} view={view} recovery={recovery} onApply={applyRecovery} applying={applyingRecovery} error={recoveryError} settings={settings} openGoals={() => setSheet({ type: "setting", section: "goals" })} briefRefreshKey={briefRefreshKey} dataState={dataState} /> : null}
      {tab === "Training" ? <><SavedTrainingBrief refreshKey={briefRefreshKey} enabled={dataState === "live"} disabledStatus={dataState === "sample" ? "sample" : ["missing", "unavailable"].includes(dataState) ? "unavailable" : "loading"} /><TrainingView openHistory={() => setSheet({ type: "training-history", tab: "Training" })} range={ranges.Training} setRange={setRange} openRecommendation={() => setSheet({ type: "recommendation" })} openExercise={(exercise) => setSheet({ type: "exercise", exercise })} openWorkout={(workout) => setSheet({ type: "workout", workout })} openExerciseList={(exerciseGroups, initialMuscles) => setSheet({ type: "exercise-list", exerciseGroups, initialMuscles, activeMuscles: initialMuscles })} openTimeline={(workouts) => setSheet({ type: "timeline", workouts })} view={view} payload={personalPayload} settings={settings} recovery={dataState === "stale" ? { ...recovery, stale: true, decision: "unknown" } : recovery} dataState={dataState} /></> : null}
      <SourceStatus payload={payload} />
    </main>
    <BottomNav active={tab} onChange={selectTab} />
    {sheet?.type === "metric-history" ? <MetricHistorySheet metric={sheet.metric} payload={personalPayload} range={ranges[sheet.tab || "Health"]} returnTab={sheet.tab || "Health"} dataState={dataState} onRangeChange={(range) => setRanges((current) => ({ ...current, [sheet.tab || "Health"]: range }))} onClose={() => setSheet(null)} /> : null}
    {sheet?.type === "training-history" ? <TrainingHistorySheet payload={personalPayload} range={ranges[sheet.tab]} dataState={dataState} returnTab={sheet.tab} onRangeChange={(range) => setRanges((current) => ({ ...current, [sheet.tab]: range }))} onClose={() => setSheet(null)} /> : null}
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
  </div></>;
}

export default App;
