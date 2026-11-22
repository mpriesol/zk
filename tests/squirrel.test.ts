import test from "node:test";
import assert from "node:assert/strict";
import { chooseSquirrelEvent } from "../components/squirrel-events.ts";
import type { AppState, Award, Challenge, Message } from "../lib/types.ts";
function state(): AppState {
  return {
    me: { id: "me", animations: true },
    course: { id: "course", squirrelLimit: 2 },
    messages: [],
    awards: [],
    challenges: [],
  } as unknown as AppState;
}
test("squirrel: welcome shown only once; reopening does not replay seen event", () => {
  const s = state();
  assert.deepEqual(chooseSquirrelEvent(s, [], 0)?.ids, ["welcome"]);
  assert.equal(chooseSquirrelEvent(s, ["welcome"], 0), null);
});
test("squirrel: rewards are announced only by the celebration, never again by the squirrel", () => {
  const s = state();
  s.awards = [
    { id: "one", memberId: "me" },
    { id: "two", memberId: "me" },
  ] as Award[];
  assert.equal(chooseSquirrelEvent(s, ["welcome"], 0), null);
});
test("squirrel: strict session cap, forms and reduced-motion suppress events", () => {
  const s = state();
  assert.equal(chooseSquirrelEvent(s, [], 2), null);
  assert.equal(chooseSquirrelEvent(s, [], 0, { blocked: true }), null);
  assert.equal(chooseSquirrelEvent(s, [], 0, { reduced: true }), null);
});
test("squirrel: hidden/draft tasks never become events or counts", () => {
  const s = state();
  s.challenges = [
    { id: "secret", hidden: true, status: "published", publishedAt: "now" },
    { id: "draft", hidden: false, status: "draft", publishedAt: "now" },
  ] as Challenge[];
  assert.equal(chooseSquirrelEvent(s, ["welcome"], 0), null);
  s.challenges.push({
    id: "visible",
    hidden: false,
    status: "published",
    publishedAt: "now",
  } as Challenge);
  assert.deepEqual(chooseSquirrelEvent(s, ["welcome"], 0)?.ids, ["c-visible"]);
});
test("squirrel: important unread message takes priority and ordinary/read messages ignored", () => {
  const s = state();
  s.messages = [
    { id: "read", status: "sent", important: true, readAt: "now" },
    { id: "normal", status: "sent", important: false, readAt: null },
    { id: "urgent", status: "sent", important: true, readAt: null },
  ] as Message[];
  assert.deepEqual(chooseSquirrelEvent(s, [], 0)?.ids, ["m-urgent"]);
  assert.equal(chooseSquirrelEvent(s, ["welcome", "m-urgent"], 1), null);
});
