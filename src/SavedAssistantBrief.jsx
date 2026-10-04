import React, { useEffect, useMemo, useState } from "react";
import { ContextDetails } from "./components";
import { cachedBrief, briefCacheExpired } from "./briefCache.js";
import { BRIEF_THEMES, RATING_LABELS } from "./dailyBrief";

const STATES = ["ready", "missing", "stale", "unavailable"];
const EMPTY_BRIEF = { status: "loading", report: null, generatedAt: null, sourceAt: null, reason: "" };
const STATUS_COPY = {
  loading: "Checking current evidence…",
  ready: "",
  missing: "Coach summary not saved yet.",
  stale: "Coach summary needs updating.",
  unavailable: "Coach summary unavailable right now.",
  sample: "Sample only · no personal assessment.",
};
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const text = (value) => typeof value === "string" && value.trim().length > 0;
const evidence = (value) => Array.isArray(value) && value.every(text);

// The server validates evidence and freshness. The browser checks the response shape
// and never lets a non-ready response expose an older narrative.
export function normalizeSavedBrief(value, kind) {
  if (!value || value.kind !== kind || !STATES.includes(value.status)) throw new Error("Invalid saved summary response");
  const result = {
    status: value.status, kind, report: null,
    generatedAt: timestamp(value.generatedAt) ? value.generatedAt : null,
    sourceAt: timestamp(value.sourceAt) ? value.sourceAt : null,
    sourceHash: typeof value.sourceHash === "string" ? value.sourceHash : null,
    reason: typeof value.reason === "string" ? value.reason : "",
  };
  if (value.status !== "ready") return result;
  const report = value.report;
  if (!result.generatedAt || !result.sourceAt || !text(report?.narrative)) throw new Error("Invalid saved summary metadata");
  if (kind === "daily") {
    if (!Array.isArray(report.themes) || report.themes.length !== BRIEF_THEMES.length || !report.themes.every((theme, index) => theme?.id === BRIEF_THEMES[index].id && Object.hasOwn(RATING_LABELS, theme.rating) && text(theme.summary) && evidence(theme.evidence) && text(theme.uncertainty))) throw new Error("Invalid saved daily themes");
  } else if (kind === "training") {
    if (!Array.isArray(report.exercises) || !report.exercises.every((exercise) => text(exercise?.exerciseId) && text(exercise.title) && text(exercise.summary) && evidence(exercise.evidence) && text(exercise.uncertainty))) throw new Error("Invalid saved training review");
  } else throw new Error("Invalid saved summary kind");
  return { ...result, report };
}

export async function fetchSavedBrief(kind, signal, fetchImpl = fetch) {
  if (!["daily", "training"].includes(kind)) throw new Error("Invalid saved summary kind");
  const response = await fetchImpl(`/api/assistant-briefs?kind=${kind}`, { method: "GET", signal, cache: "no-store" });
  if (!response.ok) {
    if ([401, 403].includes(response.status) && typeof window !== "undefined") globalThis.dispatchEvent(new Event("tong-fit:auth-failed"));
    throw Object.assign(new Error("Saved summary unavailable"), { status: response.status });
  }
  return normalizeSavedBrief(await response.json(), kind);
}

export function expireSavedBrief(brief, now = Date.now()) {
  if (brief?.status !== "ready") return brief;
  const generated = Date.parse(brief.generatedAt);
  const bangkokDay = (time) => new Date(time + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (!Number.isFinite(generated) || generated > now + 60000 || now - generated > 86400000 || bangkokDay(generated) !== bangkokDay(now)) return { ...brief, status: "stale", report: null };
  return brief;
}

export function useSavedAssistantBrief(kind, refreshKey = 0, enabled = true, disabledStatus = "sample") {
  const [result, setResult] = useState(null);
  const [tick, setTick] = useState(0);
  const requestKey = useMemo(() => ({ kind, refreshKey, enabled }), [kind, refreshKey, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 12000);
    cachedBrief(kind, fetchSavedBrief).then((brief) => {
      if (active) setResult({ key: requestKey, brief });
    }).catch(() => {
      if (active) setResult({ key: requestKey, brief: { ...EMPTY_BRIEF, status: "unavailable" } });
    }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [requestKey, tick]);
  useEffect(() => { const timer = setInterval(() => setTick((value) => value + 1), 10000); return () => clearInterval(timer); }, []);
  void tick;
  if (!enabled) return { ...EMPTY_BRIEF, status: disabledStatus };
  // Hide a previous request's result immediately, even before the effect runs.
  return result?.key === requestKey ? briefCacheExpired(result.brief) ? { ...EMPTY_BRIEF, status: "loading" } : expireSavedBrief(result.brief) : EMPTY_BRIEF;
}

export function SavedBriefStatus({ brief, fallback = false }) {
  if (brief?.status === "ready") return null;
  return <p className="brief-status" role="status">{STATUS_COPY[brief?.status] || STATUS_COPY.unavailable}{fallback ? " Using current rules-based evidence below." : ""}</p>;
}

function formatSavedAt(value) {
  return new Intl.DateTimeFormat("en", { timeZone: "Asia/Bangkok", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function BriefTimestamps({ brief }) {
  if (brief?.status !== "ready" || !timestamp(brief.generatedAt) || !timestamp(brief.sourceAt)) return null;
  return <p className="brief-timestamps"><span>Summary saved <time dateTime={brief.generatedAt}>{formatSavedAt(brief.generatedAt)}</time></span><span>Source snapshot <time dateTime={brief.sourceAt}>{formatSavedAt(brief.sourceAt)}</time></span><span>Times in Bangkok · 28-day evidence window</span></p>;
}

export function BriefThemeCards({ themes }) {
  return <div className="daily-brief-themes">{themes.map((theme) => {
    const label = BRIEF_THEMES.find(({ id }) => id === theme.id)?.label;
    return <article className="daily-brief-card" key={theme.id}>
      <div className="section-title-row"><h3>{label}</h3><span className={`brief-rating brief-rating-${theme.rating}`}>{RATING_LABELS[theme.rating]}</span></div>
      <p>{theme.summary}</p>
      <ContextDetails title="Why this rating"><ul className="brief-evidence" aria-label={`${label} evidence`}>{theme.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul>
      <p className="brief-uncertainty"><strong>Limit:</strong> {theme.uncertainty}</p></ContextDetails>
    </article>;
  })}</div>;
}

const BADGE_COPY = { loading: "Checking", ready: "Assistant summary", missing: "Not saved yet", stale: "New summary needed", unavailable: "Unavailable", sample: "Sample preview" };

export function RecoveryMorningBriefContent({ brief = EMPTY_BRIEF }) {
  const themes = brief.status === "ready" ? brief.report?.themes?.filter(({ id }) => ["recovery", "training_readiness"].includes(id)) : null;
  return <section className="saved-assistant-brief recovery-morning-brief" aria-labelledby="morning-brief-title" aria-busy={brief.status === "loading"}>
    <div className="section-title-row"><div><span className="section-kicker">Saved daily brief</span><h2 id="morning-brief-title">Recovery outlook</h2></div><span className="brief-source">{BADGE_COPY[brief.status] || "Unavailable"}</span></div>
    <SavedBriefStatus brief={brief} />
    {themes ? <BriefThemeCards themes={themes} /> : null}
    <ContextDetails title="Sources and scope"><BriefTimestamps brief={brief} /><p className="brief-boundary">This summary does not include your local pain or fatigue inputs and does not replace the immediate Recovery check-in above.</p></ContextDetails>
  </section>;
}

export function RecoveryMorningBrief({ refreshKey, enabled = true, disabledStatus = "sample" }) {
  const brief = useSavedAssistantBrief("daily", refreshKey, enabled, disabledStatus);
  return <RecoveryMorningBriefContent brief={brief} />;
}

export function SavedTrainingBriefContent({ brief = EMPTY_BRIEF }) {
  const report = brief.status === "ready" ? brief.report : null;
  return <section className="saved-assistant-brief saved-training-brief" aria-labelledby="training-brief-title" aria-busy={brief.status === "loading"}>
    <div className="section-title-row"><div><span className="section-kicker">Session review</span><h2 id="training-brief-title">Coach’s take</h2></div><span className="brief-source">{BADGE_COPY[brief.status] || "Unavailable"}</span></div>
    <SavedBriefStatus brief={brief} />
    {report ? <><p className="saved-brief-narrative">{report.narrative}</p>
      {report.exercises.length ? <details className="saved-exercise-reviews"><summary>Exercise evidence · {report.exercises.length} {report.exercises.length === 1 ? "exercise" : "exercises"}</summary><div>{report.exercises.map((exercise) => <article className="daily-brief-card" key={exercise.exerciseId}><h3>{exercise.title}</h3><p>{exercise.summary}</p><ul className="brief-evidence" aria-label={`${exercise.title} evidence`}>{exercise.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul><p className="brief-uncertainty"><strong>Limit:</strong> {exercise.uncertainty}</p></article>)}</div></details> : <p className="coverage">No exercise-specific evidence was included in this saved review.</p>}
    </> : null}
    <ContextDetails title="Sources and scope"><BriefTimestamps brief={brief} /><p className="brief-boundary">Use this review as context alongside your current Recovery check-in. The conservative training guidance below remains separate.</p><p className="coverage">Assistant-written summary saved to this site. This page does not generate it.{brief?.cacheHit ? " Reused from this page’s private cache (checked less than half a minute ago)." : ""}</p></ContextDetails>
  </section>;
}

export function SavedTrainingBrief({ refreshKey, enabled = true, disabledStatus = "sample" }) {
  const brief = useSavedAssistantBrief("training", refreshKey, enabled, disabledStatus);
  return <SavedTrainingBriefContent brief={brief} />;
}

const SYNC_COPY = {
  queued: { title: "Assistant review queued", message: "The request is queued. A saved review will appear only after the assistant completes and saves it." },
  not_connected: { title: "Assistant review not connected", message: "Data sync does not generate an assistant review. The assistant connection still needs to be set up." },
  unavailable: { title: "Assistant review unavailable", message: "The review request could not be confirmed. No new review is available from this sync yet." },
  blocked: { title: "Assistant review needs attention", message: "The assistant could not start this review. No new review is available from this sync yet." },
};
export function AssistantSyncStatus({ analysis }) {
  const copy = SYNC_COPY[analysis?.status] || { title: "Assistant review status unknown", message: "The data sync did not confirm whether an assistant review was requested." };
  return <div className="assistant-sync-status" role="status"><strong>{copy.title}</strong><p>{text(analysis?.message) ? analysis.message : copy.message}</p></div>;
}
