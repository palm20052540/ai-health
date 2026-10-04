import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "rolldown";
import { BRIEF_THEMES } from "../src/dailyBrief.js";

// All reports are synthetic. Compile actual JSX without calling a live data source.
const temporary = await mkdtemp(join(tmpdir(), "tong-saved-brief-render-"));
await build({
  input: { saved: new URL("../src/SavedAssistantBrief.jsx", import.meta.url).pathname, daily: new URL("../src/DailyBrief.jsx", import.meta.url).pathname },
  external: ["react", "react/jsx-runtime"],
  output: { dir: temporary, format: "esm", entryFileNames: "[name].mjs", chunkFileNames: "[name]-[hash].mjs", paths: { react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime") } },
});
const { AssistantSyncStatus, RecoveryMorningBriefContent, SavedTrainingBriefContent, fetchSavedBrief, normalizeSavedBrief, expireSavedBrief } = await import(pathToFileURL(join(temporary, "saved.mjs")));
const { DailyBriefContent } = await import(pathToFileURL(join(temporary, "daily.mjs")));
after(() => rm(temporary, { recursive: true, force: true }));
const render = (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, props));
const dailyReport = {
  narrative: "Synthetic daily narrative from saved evidence.",
  themes: BRIEF_THEMES.map(({ id }) => ({ id, rating: "steady", summary: `Synthetic ${id} summary.`, evidence: [`Synthetic ${id} evidence.`], uncertainty: `Synthetic ${id} limitation.` })),
};
const trainingReport = { narrative: "Synthetic training narrative.", exercises: [{ exerciseId: "fixture-exercise", title: "Synthetic lift", summary: "Comparable sessions remain broadly steady.", evidence: ["Synthetic matched-session evidence."], uncertainty: "Technique and missing effort can limit this comparison." }] };
const saved = (kind = "daily", overrides = {}) => ({ status: "ready", kind, report: kind === "daily" ? dailyReport : trainingReport, generatedAt: "2026-10-03T00:30:00.000Z", sourceAt: "2026-10-03T00:20:00.000Z", sourceHash: "synthetic-source-hash", reason: "", ...overrides });

test("an open page withdraws yesterday's or future-dated report without calling a model", () => {
  assert.equal(expireSavedBrief(saved(), Date.parse("2026-10-03T01:00:00Z")).status, "ready");
  assert.equal(expireSavedBrief(saved(), Date.parse("2026-10-03T17:00:01Z")).report, null);
  assert.equal(expireSavedBrief(saved(), Date.parse("2026-10-02T00:00:00Z")).status, "stale");
});

test("saved daily report has six accessible themes plus Bangkok provenance", () => {
  const html = render(DailyBriefContent, { assistantBrief: normalizeSavedBrief(saved(), "daily") });
  assert.ok(html.includes(dailyReport.narrative));
  assert.ok(html.includes("Assistant summary"));
  assert.equal((html.match(/class="daily-brief-card"/g) || []).length, 6);
  assert.equal((html.match(/class="brief-uncertainty"/g) || []).length, 6);
  assert.ok(html.includes('dateTime="2026-10-03T00:30:00.000Z"'));
  assert.ok(html.includes('dateTime="2026-10-03T00:20:00.000Z"'));
  assert.ok(html.includes("7:30"));
  assert.ok(html.includes("Times in Bangkok · 28-day evidence window"));
  assert.ok(!html.includes("OpenAI configured"));
  assert.ok(!html.includes("schedule is active"));
});

test("non-ready daily states suppress even an accidentally supplied old narrative and keep all rules themes", () => {
  for (const status of ["loading", "stale", "missing", "unavailable"]) {
    const html = render(DailyBriefContent, { assistantBrief: saved("daily", { status }) });
    assert.ok(!html.includes(dailyReport.narrative), status);
    assert.equal((html.match(/class="daily-brief-card"/g) || []).length, 6, status);
    assert.equal((html.match(/brief-rating-insufficient/g) || []).length, 6, status);
    assert.ok(!html.includes('dateTime='), status);
  }
});

test("live Health fallback is based on the active payload rather than a stale saved report", () => {
  const at = new Date().toISOString();
  const payload = { generated_at: at, period: { days: 7 }, recap: { summary: { sleep: { asleep_minutes: { count: 7, latest: 430, average: 425 } } }, freshness: { google_health: { sleep: { recorded_at: at, synced_at: at } } } } };
  const html = render(DailyBriefContent, { payload, dataState: "live", assistantBrief: saved("daily", { status: "stale" }) });
  assert.ok(html.includes("Rules-based"));
  assert.ok(html.includes("430 min"));
  assert.ok(html.includes("425 min across 7 nights"));
  assert.ok(!html.includes(dailyReport.narrative));
});

test("sample preview cannot show a personal saved summary even when the response is ready", () => {
  const html = render(DailyBriefContent, { payload: { sample: true, generated_at: new Date().toISOString() }, dataState: "live", assistantBrief: saved() });
  assert.ok(html.includes("Sample preview"));
  assert.ok(!html.includes(dailyReport.narrative));
  assert.equal((html.match(/brief-rating-insufficient/g) || []).length, 6);
});

test("Recovery shows only recovery and readiness evidence and preserves the local check-in boundary", () => {
  const html = render(RecoveryMorningBriefContent, { brief: saved() });
  assert.equal((html.match(/class="daily-brief-card"/g) || []).length, 2);
  assert.ok(html.includes("Synthetic recovery summary"));
  assert.ok(html.includes("Synthetic training_readiness summary"));
  assert.ok(!html.includes("Synthetic sleep summary"));
  assert.ok(!html.includes(dailyReport.narrative));
  assert.ok(html.includes("does not include your local pain or fatigue inputs"));
  assert.ok(html.includes("does not replace the immediate Recovery check-in"));
  assert.ok(html.includes("Source snapshot"));
});

test("Training saved review exposes supporting evidence without adding a prescription control", () => {
  const html = render(SavedTrainingBriefContent, { brief: saved("training") });
  assert.ok(html.includes(trainingReport.narrative));
  assert.ok(html.includes("Synthetic lift"));
  assert.ok(html.includes("Synthetic matched-session evidence"));
  assert.ok(html.includes("Technique and missing effort"));
  assert.ok(html.includes("<details"));
  assert.ok(html.includes("conservative training guidance below remains separate"));
  assert.ok(!html.includes("<input"));
  assert.ok(!html.includes("<button"));
});

test("stale, missing and unavailable Recovery and Training reports never expose old evidence", () => {
  for (const status of ["loading", "stale", "missing", "unavailable"]) {
    const recovery = render(RecoveryMorningBriefContent, { brief: saved("daily", { status }) });
    const training = render(SavedTrainingBriefContent, { brief: saved("training", { status }) });
    assert.ok(!recovery.includes("Synthetic recovery summary"), status);
    assert.ok(!training.includes(trainingReport.narrative), status);
    assert.ok(!training.includes("Synthetic matched-session evidence"), status);
    assert.ok(!recovery.includes('dateTime='), status);
    assert.ok(!training.includes('dateTime='), status);
  }
});

test("saved response validation requires matching kind, provenance and complete output shape", () => {
  assert.throws(() => normalizeSavedBrief(saved(), "training"));
  assert.throws(() => normalizeSavedBrief(saved("daily", { generatedAt: null }), "daily"));
  assert.throws(() => normalizeSavedBrief(saved("daily", { sourceAt: "invalid" }), "daily"));
  assert.throws(() => normalizeSavedBrief(saved("daily", { report: { ...dailyReport, themes: dailyReport.themes.slice(1) } }), "daily"));
  assert.throws(() => normalizeSavedBrief(saved("training", { report: { narrative: "Synthetic", exercises: [{ title: "Incomplete" }] } }), "training"));
  for (const status of ["missing", "stale", "unavailable"]) assert.equal(normalizeSavedBrief(saved("daily", { status }), "daily").report, null);
});

test("saved brief fetching is GET-only, forwards cancellation, avoids caching and sends no health payload", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await fetchSavedBrief("daily", controller.signal, (url, init) => {
    calls++;
    assert.equal(url, "/api/assistant-briefs?kind=daily");
    assert.equal(init.method, "GET");
    assert.equal(init.signal, controller.signal);
    assert.equal(init.cache, "no-store");
    assert.ok(!Object.hasOwn(init, "body"));
    return new Response(JSON.stringify(saved()));
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "ready");
  await assert.rejects(fetchSavedBrief("unknown", controller.signal, () => assert.fail("invalid kind must not fetch")));
  await assert.rejects(fetchSavedBrief("training", controller.signal, () => new Response("", { status: 503 })));
});

test("Sync distinguishes queued, disconnected, unavailable, blocked and unconfirmed analysis", () => {
  for (const [status, expected] of [["queued", "Assistant review queued"], ["not_connected", "Assistant review not connected"], ["unavailable", "Assistant review unavailable"], ["blocked", "Assistant review needs attention"]]) {
    const html = render(AssistantSyncStatus, { analysis: { status } });
    assert.ok(html.includes(expected));
    assert.ok(!html.includes("Review complete"));
  }
  assert.ok(render(AssistantSyncStatus).includes("Assistant review status unknown"));
  assert.ok(render(AssistantSyncStatus, { analysis: { status: "blocked", message: "Synthetic authorization is required." } }).includes("Synthetic authorization is required"));
});

test("integration keeps saved reviews refreshable after Sync and leaves existing training/check-in flows in place", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const daily = await readFile(new URL("../src/DailyBrief.jsx", import.meta.url), "utf8");
  const savedSource = await readFile(new URL("../src/SavedAssistantBrief.jsx", import.meta.url), "utf8");
  assert.ok(app.includes("setBriefRefreshKey((value) => value + 1)"));
  assert.ok(app.includes("result?.assistant_analysis"));
  assert.ok(app.indexOf("<RecoveryCheckIn") < app.indexOf("<RecoveryMorningBrief"));
  assert.ok(app.indexOf("<SavedTrainingBrief") < app.indexOf("<TrainingView"));
  assert.ok(!daily.includes("fetchDailyBrief"));
  assert.ok(!daily.includes("/api/health-brief"));
  assert.ok(!savedSource.includes("/api/health-brief"));
  assert.ok(savedSource.includes("briefCacheExpired"));
  assert.ok(app.includes("clearSavedBriefCache"));
  assert.ok(savedSource.includes("controller.abort()"));
});
