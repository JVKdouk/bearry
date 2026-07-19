/**
 * Error message selection.
 *
 * The failure this prevents is silent and easy to reintroduce: a bare `catch`
 * that replaces the server's explanation with a generic one. "You've used this
 * hour's AI suggestions" tells someone what to do; "Couldn't suggest steps"
 * leaves them retrying into the same wall.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, OfflineError, errText } from "../src/lib/api";

test("the server's explanation wins over the fallback", () => {
  const err = new ApiError(429, "You've used this hour's AI suggestions.");
  assert.equal(errText(err, "Couldn't suggest steps"), "You've used this hour's AI suggestions.");
});

test("being offline is reported as being offline, not as the operation failing", () => {
  // A different problem with a different remedy — telling someone their task
  // couldn't be saved when it's queued and will sync is actively misleading.
  const msg = errText(new OfflineError("fetch failed"), "Couldn't save");
  assert.match(msg, /offline/i);
  assert.notEqual(msg, "Couldn't save");
});

test("an unknown failure falls back rather than guessing", () => {
  assert.equal(errText(new Error("ECONNRESET"), "Couldn't save"), "Couldn't save");
  assert.equal(errText(null, "Couldn't save"), "Couldn't save");
  assert.equal(errText(undefined, "Couldn't save"), "Couldn't save");
  assert.equal(errText("a string", "Couldn't save"), "Couldn't save");
});

test("an ApiError with no message falls back instead of showing nothing", () => {
  // An empty toast is worse than a generic one — it reads as the app hanging.
  assert.equal(errText(new ApiError(500, ""), "Couldn't save"), "Couldn't save");
});

test("the offline check precedes the ApiError check", () => {
  // OfflineError must never be mistaken for a server ruling; the two imply
  // opposite responses (retry later vs. don't retry).
  assert.match(errText(new OfflineError("down"), "x"), /offline/i);
});
