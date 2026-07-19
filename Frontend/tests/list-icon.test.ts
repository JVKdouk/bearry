import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSingleEmoji,
  LUCIDE_CHOICES,
  lucideComponentName,
  lucideValue,
  normalizeIcon,
  parseIcon,
} from "../src/lib/listIcon";

// --- exactly one emoji ------------------------------------------------------

test("a single emoji is accepted", () => {
  for (const e of ["🏠", "🎯", "🔥", "⭐", "🐾"]) {
    assert.equal(isSingleEmoji(e), true, `${e} was rejected`);
  }
});

test("compound emoji count as one", () => {
  // "👨‍👩‍👧" is one emoji, five code points, eight UTF-16 units. Counting either
  // of the latter rejects the thing it is meant to accept.
  assert.equal(isSingleEmoji("👨‍👩‍👧"), true);
  assert.equal(isSingleEmoji("🏳️‍🌈"), true);
  assert.equal(isSingleEmoji("👍🏽"), true, "skin tone modifier");
});

test("two emoji are refused", () => {
  // The rule is exactly one — two render at half size in a 16px slot.
  assert.equal(isSingleEmoji("🏠🎯"), false);
  assert.equal(isSingleEmoji("🔥🔥🔥"), false);
});

test("letters and digits are refused even though they're single graphemes", () => {
  // A list whose icon is the letter A is not what anyone meant.
  assert.equal(isSingleEmoji("a"), false);
  assert.equal(isSingleEmoji("Z"), false);
  assert.equal(isSingleEmoji("7"), false);
  assert.equal(isSingleEmoji("#"), false);
});

test("empty and whitespace are refused", () => {
  assert.equal(isSingleEmoji(""), false);
  assert.equal(isSingleEmoji("   "), false);
});

test("an emoji with surrounding whitespace is still one emoji", () => {
  assert.equal(isSingleEmoji("  🏠 "), true);
});

test("a word and an emoji together is refused", () => {
  assert.equal(isSingleEmoji("home 🏠"), false);
});

// --- the two kinds share one column -----------------------------------------

test("a lucide value parses as lucide", () => {
  assert.deepEqual(parseIcon("lucide:house"), { kind: "lucide", name: "house" });
  assert.deepEqual(parseIcon(lucideValue("shopping-cart")), {
    kind: "lucide",
    name: "shopping-cart",
  });
});

test("an emoji parses as emoji", () => {
  assert.deepEqual(parseIcon("🏠"), { kind: "emoji", char: "🏠" });
});

test("the prefix is what disambiguates", () => {
  // "house" alone is not a lucide name — it's an unprefixed string, and
  // guessing would make every stored word a potential icon lookup.
  assert.equal(parseIcon("house"), null);
});

test("nothing, and nonsense, parse to null", () => {
  assert.equal(parseIcon(null), null);
  assert.equal(parseIcon(undefined), null);
  assert.equal(parseIcon(""), null);
  assert.equal(parseIcon("   "), null);
  assert.equal(parseIcon("lucide:"), null, "a prefix with no name is not an icon");
  assert.equal(parseIcon("🏠🎯"), null, "two emoji are not an icon");
});

test("normalizeIcon collapses every 'unset' to null", () => {
  // One representation, so a clear button reliably clears.
  for (const v of [null, undefined, "", "   ", "house", "🏠🎯", "abc"]) {
    assert.equal(normalizeIcon(v), null, `${JSON.stringify(v)} should normalise to null`);
  }
});

test("normalizeIcon trims and keeps what's valid", () => {
  assert.equal(normalizeIcon("  🏠 "), "🏠");
  assert.equal(normalizeIcon("lucide:house"), "lucide:house");
  assert.equal(normalizeIcon("  lucide:house  "), "lucide:house");
});

test("normalizing is idempotent", () => {
  // It runs on save and on load; a second pass must not change anything.
  for (const v of ["🏠", "lucide:house", "👨‍👩‍👧"]) {
    assert.equal(normalizeIcon(normalizeIcon(v)), normalizeIcon(v));
  }
});

// --- lucide plumbing --------------------------------------------------------

test("kebab names map to Lucide's PascalCase exports", () => {
  assert.equal(lucideComponentName("house"), "House");
  assert.equal(lucideComponentName("shopping-cart"), "ShoppingCart");
  assert.equal(lucideComponentName("gamepad-2"), "Gamepad2");
  assert.equal(lucideComponentName("book-open"), "BookOpen");
});

test("every curated choice resolves to a real Lucide export", async () => {
  // The picker showing an icon that doesn't exist would render a blank square,
  // which looks like a broken image rather than a missing icon.
  const lucide = await import("lucide-react");
  for (const name of LUCIDE_CHOICES) {
    const component = lucideComponentName(name);
    assert.ok(
      component in lucide,
      `lucide-react has no export "${component}" for choice "${name}"`,
    );
  }
});

test("every curated choice round-trips through storage", () => {
  for (const name of LUCIDE_CHOICES) {
    assert.deepEqual(parseIcon(lucideValue(name)), { kind: "lucide", name });
  }
});
