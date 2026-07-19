/* Verify the Stage-1 capture classifier (run: yarn tsx scripts/verify-classifier.ts). */
import assert from "node:assert";
import { classify } from "../src/lib/capture/classifier";

const now = new Date("2026-07-11T09:00:00Z"); // Saturday
const projects = [
  { id: "p-fin", keywords: ["invoice", "stripe", "tax", "budget", "finances"] },
  { id: "p-home", keywords: ["groceries", "pharmacy", "home", "clean"] },
];
const rules = [{ match: "stripe.com", projectId: "p-fin" }];

// 1. Imperative verb + date → task, high confidence, date extracted
let c = classify({ text: "Send the report Friday", source: "manual", now });
assert.equal(c.proposedType, "task", "verb+date → task");
assert.ok(c.confidence >= 0.85, "high confidence");
assert.ok(c.extractedFields.date, "date extracted");

// 2. Event words + date → event
c = classify({ text: "Meeting with Sarah tomorrow 3pm for 1h", source: "manual", now });
assert.equal(c.proposedType, "event", "meeting+date → event");
assert.equal(c.extractedFields.durationMinutes, 60, "1h → 60 min");

// 3. Bare URL shared → note/bookmark with readable title
c = classify({ text: "https://arxiv.org/abs/2401.001", source: "share", now });
assert.equal(c.proposedType, "note", "bare url → note");
assert.ok(c.extractedFields.url, "url captured");

// 4. Short verbless dateless → note
c = classify({ text: "cabin ideas", source: "manual", now });
assert.equal(c.proposedType, "note", "short verbless → note");

// 5. Promo from email → trash candidate, honestly low confidence
c = classify({ text: "50% off — sale ends tonight! click here to unsubscribe", source: "email", now });
assert.equal(c.proposedType, "trash", "promo → trash candidate");
assert.ok(c.confidence < 0.7, "trash stays low-confidence for review");

// 6. Project suggestion via keyword
c = classify({ text: "Pay the invoice", source: "manual", projects, now });
assert.equal(c.suggestedProjectId, "p-fin", "keyword → project");

// 7. Explicit rule via sender domain wins
c = classify({ text: "Your receipt", source: "email", senderDomain: "billing.stripe.com", projects, rules, now });
assert.equal(c.suggestedProjectId, "p-fin", "domain rule → project");

// 8. Relative date resolves deterministically & forward
c = classify({ text: "call dentist next Tuesday", source: "manual", now });
const d = new Date(c.extractedFields.date!);
assert.ok(d > now, "next Tuesday resolves forward");

console.log("✓ classifier: all 8 checks passed");
console.log("  sample:", JSON.stringify(classify({ text: "Buy milk tomorrow", source: "manual", now }).extractedFields));
