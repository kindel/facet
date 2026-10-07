import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const guard = require("../lib/guard.js");

test("one address can save eight times in the window, and a ninth waits", () => {
  guard.resetForTests();
  const start = 1_700_000_000_000;
  for (let i = 0; i < guard.MAX_SAVES; i++) {
    assert.equal(guard.rateLimit("203.0.113.10", start + i, false).ok, true);
  }
  const blocked = guard.rateLimit("203.0.113.10", start + guard.MAX_SAVES, false);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter > 0);
  assert.ok(blocked.retryAfter <= guard.WINDOW_MS / 1000);
});

test("dry runs use a separate cap from saves", () => {
  guard.resetForTests();
  const start = 1_700_000_000_000;
  for (let i = 0; i < guard.MAX_SAVES; i++) guard.rateLimit("203.0.113.11", start, false);
  assert.equal(guard.rateLimit("203.0.113.11", start, false).ok, false);
  assert.equal(guard.rateLimit("203.0.113.11", start, true).ok, true);
});

test("a second address keeps its own bucket", () => {
  guard.resetForTests();
  const start = 1_700_000_000_000;
  for (let i = 0; i < guard.MAX_SAVES; i++) guard.rateLimit("203.0.113.12", start, false);
  assert.equal(guard.rateLimit("203.0.113.12", start, false).ok, false);
  assert.equal(guard.rateLimit("203.0.113.13", start, false).ok, true);
});

test("the window expiry lets the same address save again", () => {
  guard.resetForTests();
  const start = 1_700_000_000_000;
  for (let i = 0; i < guard.MAX_SAVES; i++) guard.rateLimit("203.0.113.14", start, false);
  assert.equal(guard.rateLimit("203.0.113.14", start + guard.WINDOW_MS - 1, false).ok, false);
  const again = guard.rateLimit("203.0.113.14", start + guard.WINDOW_MS, false);
  assert.equal(again.ok, true);
});

test("an address that does not return drops out of the map", () => {
  guard.resetForTests();
  guard.rateLimit("203.0.113.15", 0, false);
  assert.equal(guard.bucketCount(), 1);
  guard.rateLimit("203.0.113.16", guard.WINDOW_MS + 1, false);
  assert.equal(guard.bucketCount(), 1);
});
