import { test } from "node:test";
import assert from "node:assert/strict";
import { createDefaultsFor } from "../src/lib/createContext";

test("a real list preselects itself", () => {
  // The screen said "Personal"; the thing you just made should be in Personal.
  assert.deepEqual(createDefaultsFor("/lists", "abc123"), { projectId: "abc123" });
});

test("the pseudo-lists preselect nothing", () => {
  // "All tasks" and "No list" mean explicitly no project; creating into
  // "Completed" is meaningless.
  for (const key of ["all", "none", "completed"]) {
    assert.equal(createDefaultsFor("/lists", key), undefined, key);
  }
});

test("no list in the URL means no assumption", () => {
  assert.equal(createDefaultsFor("/lists", null), undefined);
  assert.equal(createDefaultsFor("/lists", undefined), undefined);
  assert.equal(createDefaultsFor("/lists", ""), undefined);
});

test("other routes carry no list, even with a stray param", () => {
  // /lists/settings is about the lists themselves, not the work in one.
  assert.equal(createDefaultsFor("/lists/settings", "abc123"), undefined);
  assert.equal(createDefaultsFor("/today", "abc123"), undefined);
  assert.equal(createDefaultsFor("/calendar", "abc123"), undefined);
  assert.equal(createDefaultsFor("/events", "abc123"), undefined);
  assert.equal(createDefaultsFor("/inbox", "abc123"), undefined);
});

test("an id that merely resembles a pseudo-list is still a list", () => {
  // Exact matches only — a project genuinely called "allotments" must not be
  // mistaken for the "all" pseudo-list.
  assert.deepEqual(createDefaultsFor("/lists", "allotments"), { projectId: "allotments" });
  assert.deepEqual(createDefaultsFor("/lists", "none-of-your-business"), {
    projectId: "none-of-your-business",
  });
});

test("returns undefined rather than an empty object", () => {
  // So a caller can pass it straight through; {} would read as "I decided
  // these were the defaults" and clear a project the drawer had inferred.
  assert.equal(createDefaultsFor("/today", null), undefined);
});
