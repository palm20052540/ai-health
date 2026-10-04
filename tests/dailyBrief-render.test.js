import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "rolldown";

const temporary = await mkdtemp(join(tmpdir(), "tong-daily-brief-render-"));
await build({
  input: new URL("../src/DailyBrief.jsx", import.meta.url).pathname,
  external: ["react", "react/jsx-runtime"],
  output: { file: join(temporary, "brief.mjs"), format: "esm", paths: { react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime") } },
});
const { DailyBrief } = await import(pathToFileURL(join(temporary, "brief.mjs")));
after(() => rm(temporary, { recursive: true, force: true }));
const render = (props = {}) => renderToStaticMarkup(React.createElement(DailyBrief, props));

test("DailyBrief actual JSX leads with a narrative then six accessible evidence-backed themes", () => {
  const html = render();
  assert.ok(html.indexOf("How is your health looking today?") < html.indexOf("daily-brief-themes"));
  assert.equal((html.match(/class="daily-brief-card"/g) || []).length, 6);
  assert.equal((html.match(/class="brief-uncertainty"/g) || []).length, 6);
  assert.equal((html.match(/brief-rating-insufficient/g) || []).length, 6);
  for (const label of ["Sleep", "Recovery", "Training readiness", "Training trend", "Activity", "Attention"]) assert.ok(html.includes(label));
  assert.ok(html.includes("Brief unavailable"));
  assert.ok(html.includes("The saved assistant summary is unavailable"));
  assert.ok(!html.includes("AI generated"));
});

test("sample preview cannot present personal health conclusions", () => {
  const html = render({ dataState: "live", payload: { sample: true, generated_at: new Date().toISOString() } });
  assert.ok(html.includes("Sample data is a layout preview"));
  assert.equal((html.match(/brief-rating-insufficient/g) || []).length, 6);
  assert.ok(!html.includes("AI generated"));
  assert.ok(!html.includes("favorable"));
});
