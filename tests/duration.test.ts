import test from "node:test";
import assert from "node:assert/strict";
import { parseDuration, displayDuration } from "../lib/duration.ts";
test("Slovak decimal hours and minutes have the same canonical duration, missing stays null", () => {
  assert.equal(parseDuration("1,5", "hour"), 90);
  assert.equal(parseDuration("90", "min"), 90);
  assert.equal(parseDuration("1.5", "hour"), 90);
  assert.equal(parseDuration("", "min"), null);
  assert.equal(parseDuration("  ", "hour"), null);
  assert.equal(displayDuration(90, "hour"), "1,5");
  assert.equal(displayDuration(90, "min"), "90");
  assert.equal(
    parseDuration("0,5", "min"),
    0.5,
    "the existing REAL minutes model supports fractional minutes",
  );
  assert.throws(() => parseDuration("25", "hour"));
  assert.throws(() => parseDuration("-1", "min"));
  assert.throws(() => parseDuration("1,2,3", "hour"));
});
