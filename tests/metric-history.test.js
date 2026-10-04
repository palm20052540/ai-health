import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "rolldown";
import { HEALTH_HISTORY, buildMetricHistory, historyDate, historyMetric, historyValue } from "../src/metricHistory.js";

const temporary = await mkdtemp(join(tmpdir(), "tong-history-render-"));
await build({ input: new URL("../src/MetricHistorySheet.jsx", import.meta.url).pathname, external: ["react", "react/jsx-runtime"], output: { file: join(temporary, "history.mjs"), format: "esm", paths: { react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime") } } });
const { MetricHistorySheet } = await import(pathToFileURL(join(temporary, "history.mjs")));
after(() => rm(temporary, { recursive: true, force: true }));
const fixture = () => ({ generated_at: "2026-09-20T05:00:00Z", recap: { evidence: {
  activity_daily: [{ date: "2026-09-18", steps: 0, active_zone_minutes: null }, { date: "2026-09-19", steps: 1234, active_zone_minutes: 21 }],
  recovery_daily: [{ date: "2026-09-18T07:30:00", type: "sleep", value: 359.9 }, { date: "2026-09-19T08:00:00", type: "sleep", value: null }, { date: "2026-09-18T13:00:00", type: "sleep", value: 30 }, { date: "2026-09-19T07:00:00", type: "daily-resting-heart-rate", value: 61.5 }, { date: "2026-09-19", type: "daily-heart-rate-variability", value: 99 }],
}, summary: { activity: { partial_day: { activity_date: "2026-09-20", steps: 12, active_zone_minutes: 0, is_complete_day: false } } } }, body_measurements: [{ measurement_date: "2026-08-30", weight_kg: 80.2 }, { measurement_date: "2026-09-18", weight_kg: 80.1 }, { measurement_date: "2026-01-01", weight_kg: 79.8 }] });
const render = (props) => { const old = globalThis.document; globalThis.document = { activeElement: null }; try { return renderToStaticMarkup(React.createElement(MetricHistorySheet, { metric: "Steps", range: "7D", dataState: "live", payload: fixture(), onClose() {}, onRangeChange() {}, ...props })); } finally { if (old === undefined) delete globalThis.document; else globalThis.document = old; } };

test("all five screenshot rows resolve distinct real history routes", async () => {
  for (const metric of Object.keys(HEALTH_HISTORY)) {
    assert.equal(historyMetric(metric), metric);
    const html = render({ metric });
    assert.ok(html.includes(`${metric} history`));
    assert.ok(html.includes(`aria-label="Close ${metric} history"`));
    assert.ok(html.includes("Back to Health metrics"));
    assert.ok(html.includes("Bangkok time"));
  }
  assert.equal(historyMetric("Resting HR"), "Resting heart rate");
  assert.equal(historyMetric("HRV"), "HRV");
  const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.ok(source.includes('openMetric={openHealthMetric}'));
  assert.ok(source.includes('type: "metric-history", metric: name, tab'));
  assert.ok(!source.includes('metric.label === "Resting heart rate" ? "HRV"'));
});

test("raw sleep records sort newest first without same-day deduplication or invented zero", () => {
  const input = fixture(), original = JSON.stringify(input);
  const history = buildMetricHistory(input, "Sleep", "7D");
  assert.equal(history.rows.length, 3);
  assert.equal(history.rows[0].displayValue, "Unavailable");
  assert.equal(history.rows[1].displayValue, "0h 30m");
  assert.equal(history.rows[2].displayValue, "6h 0m");
  assert.equal(history.available, 2); assert.equal(history.missing, 1);
  assert.equal(JSON.stringify(input), original);
  assert.equal(buildMetricHistory(input, "Resting heart rate").rows[0].displayValue, "61.5 bpm");
});

test("numeric missingness, genuine zero, units and Bangkok date handling remain exact", () => {
  for (const missing of [null, undefined, "", " ", "bad", false, {}, NaN, -1]) assert.equal(historyValue(missing, "Steps"), "Unavailable");
  assert.equal(historyValue(0, "Steps"), "0 steps");
  assert.equal(historyValue("0", "Active zone minutes"), "0 min");
  assert.equal(historyValue(80.15, "Weight"), "80.2 kg");
  assert.equal(historyDate("2026-09-19"), "Sep 19, 2026");
  assert.ok(historyDate("2026-09-18T18:00:00Z").includes("Sep 19"));
  assert.equal(historyDate(null), "Date unavailable");
});

test("activity preserves partial day outside completed-day averages", () => {
  const history = buildMetricHistory(fixture(), "Steps", "7D");
  assert.equal(history.rows[0].displayValue, "12 steps");
  assert.equal(history.rows[0].note, "Partial day · excluded from average");
  assert.equal(history.rows.at(-1).displayValue, "0 steps");
  const html = render({ metric: "Active zone minutes" });
  assert.ok(html.includes("0 min")); assert.ok(html.includes("Unavailable"));
  assert.ok(html.includes("does not guarantee full device coverage"));
});

test("weight filters the bounded cache by period and retains undated records honestly", () => {
  const payload = fixture();
  assert.equal(buildMetricHistory(payload, "Weight", "7D").rows.length, 1);
  assert.equal(buildMetricHistory(payload, "Weight", "30D").rows.length, 2);
  assert.equal(buildMetricHistory(payload, "Weight", "1Y").rows.length, 3);
  payload.body_measurements.push({ measurement_date: "invalid", weight_kg: null });
  const history = buildMetricHistory(payload, "Weight", "7D");
  assert.equal(history.excluded, 2);
  assert.equal(history.rows.at(-1).note, "Date unavailable · period cannot be verified");
  assert.ok(render({ metric: "Weight" }).includes("at most the latest 7 measurements"));
});

test("history never substitutes samples for missing, loading or unavailable data", () => {
  for (const state of ["loading", "missing", "unavailable", "sample"]) {
    const html = render({ dataState: state });
    assert.ok(!html.includes("1,234 steps"));
    assert.equal(buildMetricHistory(null, "Steps", "7D", state).status, state);
  }
  for (const marker of [{sample:true}, {demo:true}, {is_sample:true}, {mode:"sample"}, {data_state:"demo"}]) assert.equal(buildMetricHistory({...fixture(), ...marker}, "Steps").rows.length, 0);
  assert.ok(render({ payload: { generated_at: fixture().generated_at, recap: {} } }).includes("Missing days are not filled with zero"));
  const stale = render({ dataState: "stale" });
  assert.ok(stale.includes("Cached records")); assert.ok(stale.includes("1,234 steps"));
});

test("period and Back/Close callbacks remain controlled across repeated openings", () => {
  let range = "7D", closes = 0;
  const onClose = () => closes++;
  for (let i = 0; i < 2; i++) {
    const tree = MetricHistorySheet({ metric: "Weight", payload: fixture(), dataState: "live", range, onRangeChange: value => {range = value;}, onClose });
    assert.equal(tree.props.onClose, onClose);
    const content = tree.props.children;
    const children = React.Children.toArray(content.props.children);
    children.find(child => child.props.onChange)?.props.onChange("30D");
    children.find(child => child.type === "button" && child.props.className === "secondary-button full").props.onClick();
    assert.equal(range, "30D");
  }
  assert.equal(closes, 2);
  const html = render({metric:"Weight", range});
  assert.ok(html.includes("2 returned records"));
  assert.ok(html.includes('aria-pressed="true" class="active">30D'));
});
