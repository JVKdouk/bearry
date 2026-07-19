import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanName,
  iconFor,
  isValidIcon,
  LIST_ICONS,
  LIST_PALETTE,
  nextColor,
  normalizeIcon,
} from "../src/lib/lists";

test("emoji are accepted despite being longer than one UTF-16 unit", () => {
  // "🎯".length === 2. A naive length check rejects almost every emoji it is
  // meant to accept, which is exactly the bug this guards.
  assert.equal(isValidIcon("🎯"), true);
  assert.equal(isValidIcon("📥"), true);
});

test("compound emoji are accepted", () => {
  // A family is several code points joined by zero-width joiners.
  assert.equal(isValidIcon("👨‍👩‍👧"), true);
  assert.equal(isValidIcon("🏳️‍🌈"), true);
});

test("every icon in the picker passes its own validator", () => {
  for (const icon of LIST_ICONS) {
    assert.equal(isValidIcon(icon), true, `${icon} was rejected`);
  }
});

test("empty and whitespace are not icons", () => {
  assert.equal(isValidIcon(""), false);
  assert.equal(isValidIcon("   "), false);
});

test("a pasted paragraph is rejected", () => {
  assert.equal(isValidIcon("this is a whole sentence, not an icon"), false);
});

test("normalizeIcon collapses every 'unset' to null", () => {
  // One representation, so "no icon" never has two spellings in the database.
  assert.equal(normalizeIcon(null), null);
  assert.equal(normalizeIcon(undefined), null);
  assert.equal(normalizeIcon(""), null);
  assert.equal(normalizeIcon("   "), null);
  assert.equal(normalizeIcon("way too long to be an icon at all"), null);
});

test("normalizeIcon trims but keeps the emoji", () => {
  assert.equal(normalizeIcon("  🎯 "), "🎯");
  assert.equal(normalizeIcon("🎯"), "🎯");
});

test("a list with no icon falls back to null, not a default emoji", () => {
  // Giving every list the same icon makes them harder to tell apart than
  // giving them none; the coloured dot is the fallback.
  assert.equal(iconFor({}), null);
  assert.equal(iconFor({ icon: null }), null);
  assert.equal(iconFor({ icon: "🎯" }), "🎯");
});

test("colours cycle so consecutive lists differ", () => {
  assert.equal(nextColor(0), LIST_PALETTE[0]);
  assert.notEqual(nextColor(0), nextColor(1));
  assert.equal(nextColor(LIST_PALETTE.length), LIST_PALETTE[0], "wraps around");
  assert.equal(nextColor(LIST_PALETTE.length + 3), LIST_PALETTE[3]);
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
