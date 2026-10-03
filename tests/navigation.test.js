import test from "node:test";
import assert from "node:assert/strict";
import { resolveTab, VISIBLE_TABS } from "../src/navigation.js";

test("navigation exposes only the three supported tabs", () => {
  assert.deepEqual(VISIBLE_TABS.map(({ label }) => label), ["Health", "Recovery", "Training"]);
});

test("valid links take precedence over the saved tab", () => {
  for (const { label } of VISIBLE_TABS) assert.equal(resolveTab(label, "Health"), label);
});

test("valid saved tabs are restored when no tab is requested", () => {
  for (const { label } of VISIBLE_TABS) assert.equal(resolveTab(null, label), label);
});

test("old Coach links and saved state safely open Recovery", () => {
  assert.equal(resolveTab("Coach", "Health"), "Recovery");
  assert.equal(resolveTab(null, "Coach"), "Recovery");
});

test("missing and unknown tabs never render an empty page", () => {
  for (const value of [undefined, null, "", "Unknown", "coach"]) {
    assert.equal(resolveTab(value), "Recovery");
    assert.equal(resolveTab(null, value), "Recovery");
  }
});
