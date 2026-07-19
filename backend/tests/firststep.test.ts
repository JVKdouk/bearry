/**
 * First-step decomposition.
 *
 * This has to work with no AI at all: the provider is a shared, rate-limited
 * resource, and when it 429s the button still has to do something useful rather
 * than blame the user's content. The rule that matters most: whatever the user
 * actually wrote outranks anything we can guess.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { heuristicFirstSteps } from "@/src/lib/ai/firstStep";

const stepsFor = (title: string, notes?: string | null, estimatedDuration = 30) =>
  heuristicFirstSteps({ title, notes, estimatedDuration }).steps;

test("a bulleted checklist in the notes becomes the steps verbatim", () => {
  const steps = stepsFor("ETM Ociosidade", "- Pull the idle-time report\n- Compare against last month\n- Send the summary to Ana");
  assert.deepEqual(steps, [
    "Pull the idle-time report",
    "Compare against last month",
    "Send the summary to Ana",
  ]);
});

test("a numbered list works the same way", () => {
  const steps = stepsFor("Anything", "1. Open the dashboard\n2. Export the CSV\n3. Upload it");
  assert.deepEqual(steps, ["Open the dashboard", "Export the CSV", "Upload it"]);
});

test("markdown checkboxes are unwrapped", () => {
  const steps = stepsFor("Anything", "[ ] Call the office\n[x] Find the number\n[ ] Book the slot");
  assert.deepEqual(steps, ["Call the office", "Find the number", "Book the slot"]);
});

test("plain short lines are treated as a checklist", () => {
  const steps = stepsFor("ETM Ociosidade", "Check the machine logs\nNote the idle windows\nWrite up the finding");
  assert.deepEqual(steps, ["Check the machine logs", "Note the idle windows", "Write up the finding"]);
});

test("prose notes are split into sentences", () => {
  const steps = stepsFor(
    "ETM Ociosidade",
    "Review the idle time data from last week. Identify the three worst offenders. Draft a short recommendation.",
  );
  assert.equal(steps.length, 3);
  assert.match(steps[0], /Review the idle time data/);
});

test("notes beat the title template — the user's words win", () => {
  // "Pay" would normally trigger the payment template; explicit notes override.
  const steps = stepsFor("Pay the accountant", "- Find last year's invoice\n- Confirm the new rate\n- Transfer the amount");
  assert.equal(steps[0], "Find last year's invoice");
});

test("no notes still falls back to the title template", () => {
  const steps = stepsFor("Pay the accountant");
  assert.match(steps.join(" "), /amount|payment/i);
});

test("a one-line note doesn't get force-split into nonsense", () => {
  const steps = stepsFor("ETM Ociosidade", "check it");
  // Too little to work with — fall back rather than emit "check it" as a plan.
  assert.ok(steps.length >= 2);
  assert.notEqual(steps[0], "check it");
});

test("steps are capped in count and length", () => {
  const long = Array.from({ length: 12 }, (_, i) => `- step number ${i} ${"x".repeat(300)}`).join("\n");
  const steps = stepsFor("Anything", long);
  assert.ok(steps.length <= 4, `got ${steps.length} steps`);
  for (const s of steps) assert.ok(s.length <= 140, `step too long: ${s.length}`);
});

test("empty lines and headings don't become steps", () => {
  const steps = stepsFor("Anything", "## Plan\n\n- First real step\n\n- Second real step\n");
  assert.deepEqual(steps, ["First real step", "Second real step"]);
});

test("every task always yields at least one step", () => {
  for (const t of ["", "ETM Ociosidade", "x", "Dobrar Blusas", "asdfgh"]) {
    assert.ok(heuristicFirstSteps({ title: t, estimatedDuration: 30 }).steps.length > 0, `empty for "${t}"`);
  }
});
