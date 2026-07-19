/**
 * Capture triage.
 *
 * This runs on every thought a user dumps in, and its output is now *shown*
 * before it's applied — so the cost of being wrong is a bad suggestion rather
 * than a silently mis-filed task. What still matters is that it's honest:
 * confidence should track how sure it actually is, and it must never claim a
 * date it didn't find.
 *
 * There was a verify script but no test file, so none of this ran in CI.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { classify, type ClassifierInput } from "@/src/lib/capture/classifier";

const NOW = new Date("2026-07-19T10:00:00");

function run(text: string, over: Partial<ClassifierInput> = {}) {
  return classify({ text, source: "manual", now: NOW, ...over });
}

// --- type detection --------------------------------------------------------

test("an imperative becomes a task", () => {
  for (const t of ["call the dentist", "send Ana the report", "pay rent"]) {
    assert.equal(run(t).proposedType, "task", t);
  }
});

test("a meeting with a date becomes an event", () => {
  const c = run("meeting with Ana on Friday at 3pm");
  assert.equal(c.proposedType, "event");
  assert.ok(c.extractedFields.date);
});

test("a shared bare URL becomes a bookmark note", () => {
  const c = run("https://example.com/some/article", { source: "share" });
  assert.equal(c.proposedType, "note");
  assert.equal(c.extractedFields.url, "https://example.com/some/article");
});

test("a bookmark's title is the readable host and path, not the raw URL", () => {
  const c = run("https://www.example.com/deep/page/", { source: "share" });
  assert.equal(c.extractedFields.title, "example.com/deep/page");
});

test("a long musing becomes a note, not a task", () => {
  const c = run(
    "been thinking about how the onboarding flow feels rushed and maybe we should slow it down",
  );
  assert.equal(c.proposedType, "note");
});

test("promotional email is proposed as trash but never with high confidence", () => {
  const c = run("50% OFF everything — unsubscribe here", { source: "email" });
  assert.equal(c.proposedType, "trash");
  assert.ok(c.confidence < 0.7, "trash must stay a candidate, not a verdict");
});

test("a promotional-sounding thought TYPED BY THE USER is not trashed", () => {
  // Someone writing "unsubscribe from the gym newsletter" means to do it.
  // Auto-trashing what a user deliberately typed is the worst failure here.
  const c = run("unsubscribe from the gym newsletter", { source: "manual" });
  assert.notEqual(c.proposedType, "trash");
});

// --- extraction ------------------------------------------------------------

test("a relative date resolves forward, never into the past", () => {
  const c = run("call the dentist tomorrow");
  assert.ok(c.extractedFields.date);
  const d = new Date(c.extractedFields.date);
  assert.ok(d > NOW, `${d.toISOString()} should be after ${NOW.toISOString()}`);
  assert.equal(d.getDate(), 20);
});

test("no date is invented when the text has none", () => {
  // The failure this prevents: a task filed with a deadline the user never
  // gave, which then shows as overdue and erodes trust in the whole inbox.
  const c = run("buy milk");
  assert.equal(c.extractedFields.date, undefined);
});

test("an explicit duration is picked up", () => {
  assert.equal(run("gym for 45 minutes tomorrow").extractedFields.durationMinutes, 45);
  assert.equal(run("2 hour deep work block on Monday").extractedFields.durationMinutes, 120);
});

test("no duration is invented when none is stated", () => {
  assert.equal(run("call the dentist").extractedFields.durationMinutes, undefined);
});

test("a title is always produced, whatever the input", () => {
  for (const t of ["x", "buy milk", "https://a.co", "?????"]) {
    const c = run(t);
    assert.ok(c.extractedFields.title.length > 0, `empty title for: ${t}`);
  }
});

// --- project suggestion ----------------------------------------------------

test("a keyword match suggests the matching project", () => {
  const c = run("pay the electricity invoice", {
    projects: [
      { id: "p-fin", keywords: ["finance", "invoice", "bill"] },
      { id: "p-home", keywords: ["garden", "repair"] },
    ],
  });
  assert.equal(c.suggestedProjectId, "p-fin");
});

test("no project is suggested when nothing matches", () => {
  const c = run("call the dentist", {
    projects: [{ id: "p-fin", keywords: ["invoice", "bill"] }],
  });
  assert.equal(c.suggestedProjectId, null);
});

test("an explicit user rule wins over keyword scoring", () => {
  const c = run("receipt from stripe.com", {
    senderDomain: "stripe.com",
    projects: [{ id: "p-other", keywords: ["receipt"] }],
    rules: [{ match: "stripe.com", projectId: "p-fin" }],
  });
  assert.equal(c.suggestedProjectId, "p-fin");
});

// --- honesty ---------------------------------------------------------------

test("confidence stays within a sane range and is never certain", () => {
  for (const t of ["call the dentist tomorrow", "hmm", "meeting Friday 3pm", "50% off"]) {
    const c = run(t);
    assert.ok(c.confidence > 0 && c.confidence <= 0.95, `${t}: ${c.confidence}`);
  }
});

test("a clear imperative with a date beats a vague fragment", () => {
  // Confidence has to be comparative to mean anything — the UI shows it.
  const clear = run("send Ana the report on Friday").confidence;
  const vague = run("that thing about the stuff").confidence;
  assert.ok(clear > vague, `clear ${clear} should beat vague ${vague}`);
});

test("classification is deterministic for the same input", () => {
  const a = run("call the dentist tomorrow");
  const b = run("call the dentist tomorrow");
  assert.deepEqual(a, b);
});

test("the version is stamped, so a reclassification can be identified later", () => {
  assert.ok(run("anything").classifierVersion.length > 0);
});

// --- robustness ------------------------------------------------------------

test("degenerate input never throws", () => {
  for (const t of ["", "   ", "\n\n", "🙂", "a".repeat(5000), "((((", "1/1/1"]) {
    assert.doesNotThrow(() => run(t), `threw on: ${JSON.stringify(t.slice(0, 20))}`);
  }
});

test("a malformed URL doesn't break bookmark handling", () => {
  assert.doesNotThrow(() => run("http://", { source: "share" }));
  assert.doesNotThrow(() => run("https://[bad", { source: "share" }));
});
