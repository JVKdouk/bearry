import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, LIST_PALETTE, nextColor } from "../src/lib/lists";

// Icon rules live in list-icon.test.ts — they grew a second kind (Lucide as
// well as emoji) and their own validation.

test("colours cycle so consecutive lists differ", () => {
  assert.equal(nextColor(0), LIST_PALETTE[0]);
  assert.notEqual(nextColor(0), nextColor(1));
  assert.equal(nextColor(LIST_PALETTE.length), LIST_PALETTE[0], "wraps around");
  assert.equal(nextColor(LIST_PALETTE.length + 3), LIST_PALETTE[3]);
});

test("every palette entry is a valid hex colour", () => {
  // They're written into inline styles and compared against a picker's
  // hex output, so a malformed one fails silently as "no colour".
  for (const c of LIST_PALETTE) {
    assert.match(c, /^#[0-9a-f]{6}$/i, `${c} is not a 6-digit hex colour`);
  }
});

test("names are trimmed, and blank means nothing was given", () => {
  assert.equal(cleanName("  Work "), "Work");
  assert.equal(cleanName(""), null);
  assert.equal(cleanName("   "), null);
});

test("an absurd name is capped rather than refused", () => {
  // Refusing loses what they typed; truncating keeps the useful part.
  const long = "x".repeat(500);
  assert.equal(cleanName(long)?.length, 120);
});
