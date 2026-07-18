import test from "node:test";
import assert from "node:assert/strict";
import { nextBackoffDelay, isPongMessage, BASE_DELAY_MS, MAX_DELAY_MS } from "../dist/index.js";

test("nextBackoffDelay doubles each attempt starting at BASE_DELAY_MS", () => {
  assert.equal(nextBackoffDelay(1), BASE_DELAY_MS);
  assert.equal(nextBackoffDelay(2), BASE_DELAY_MS * 2);
  assert.equal(nextBackoffDelay(3), BASE_DELAY_MS * 4);
});

test("nextBackoffDelay caps at MAX_DELAY_MS", () => {
  assert.equal(nextBackoffDelay(10), MAX_DELAY_MS);
  assert.equal(nextBackoffDelay(30), MAX_DELAY_MS);
});

test("isPongMessage matches only {type: 'pong'}", () => {
  assert.equal(isPongMessage({ type: "pong" }), true);
  assert.equal(isPongMessage({ type: "ping" }), false);
  assert.equal(isPongMessage(null), false);
  assert.equal(isPongMessage("pong"), false);
  assert.equal(isPongMessage({}), false);
});
