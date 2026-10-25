import test from "node:test";
import assert from "node:assert/strict";
import { newRequestId } from "../components/request-id.ts";
test("request id uses platform randomUUID when available", () => {
  assert.equal(
    newRequestId({
      randomUUID: () => "platform-id",
      getRandomValues() {
        throw new Error("Fallback must not run");
      },
    }),
    "platform-id",
  );
});
test("request id uses getRandomValues on non-secure contexts without randomUUID", () => {
  let calls = 0;
  const id = newRequestId({
    getRandomValues(bytes) {
      calls++;
      bytes.set(Array.from({ length: 16 }, (_, i) => i));
      return bytes;
    },
  });
  assert.equal(calls, 1);
  assert.equal(id, "000102030405060708090a0b0c0d0e0f");
  assert.equal(id.length, 32);
});
