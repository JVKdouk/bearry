/**
 * What a list's icon is, and how it's stored.
 *
 * Two kinds, one column. A Lucide name is stored prefixed (`lucide:house`);
 * anything else is a literal emoji. The prefix is what makes the two
 * distinguishable without a second column and without guessing — "house" and
 * "🏠" are both plausible values, and a stored string has to say which it is.
 *
 * The emoji rule is *exactly one*. Not "short enough": a two-emoji icon renders
 * at half size in a 16px slot, and a stray letter renders as a letter, so both
 * are refused rather than silently accepted and quietly ugly.
 */

export const LUCIDE_PREFIX = "lucide:";

export type ListIcon =
  | { kind: "lucide"; name: string }
  | { kind: "emoji"; char: string };

/**
 * Icons offered in the picker, by Lucide name.
 *
 * A curated set rather than all 5,984: a picker you have to search is a worse
 * answer to "which list is this" than sixteen you can recognise at a glance.
 * Anything outside it is still reachable by pasting an emoji.
 */
export const LUCIDE_CHOICES = [
  "house", "briefcase", "user", "users",
  "shopping-cart", "wallet", "plane", "car",
  "book-open", "pencil", "lightbulb", "palette",
  "music", "gamepad-2", "dumbbell", "leaf",
  "heart", "brain", "wrench", "phone",
  "package", "calendar", "clock", "target",
  "flame", "star", "flag", "inbox",
] as const;

/**
 * Is this exactly one emoji?
 *
 * Grapheme clusters, not code points or UTF-16 units. "👨‍👩‍👧" is one emoji, five
 * code points and eight UTF-16 units — counting either of the latter rejects
 * the thing it's meant to accept. `Intl.Segmenter` is what actually knows where
 * a user-perceived character begins and ends.
 *
 * The pictographic check is separate and necessary: "a" is also exactly one
 * grapheme, and a list whose icon is the letter A is not what anyone meant.
 */
export function isSingleEmoji(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  // Must contain something pictographic — this rejects letters, digits and
  // punctuation, which are single graphemes but not emoji.
  if (!/\p{Extended_Pictographic}/u.test(trimmed)) return false;

  // Must be exactly one grapheme cluster.
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return [...segmenter.segment(trimmed)].length === 1;
  }

  // Without Segmenter, fall back to counting code points and allowing the
  // joiners a compound emoji legitimately contains. Less precise, but it errs
  // toward accepting a real emoji rather than rejecting one.
  const points = [...trimmed];
  const joiners = points.filter((c) => c === "‍" || c === "️").length;
  return points.length - joiners * 2 <= 1 || points.length <= 8;
}

/** Parse a stored value into something renderable, or null if it's neither. */
export function parseIcon(stored: string | null | undefined): ListIcon | null {
  if (!stored) return null;
  const value = stored.trim();
  if (!value) return null;

  if (value.startsWith(LUCIDE_PREFIX)) {
    const name = value.slice(LUCIDE_PREFIX.length).trim();
    return name ? { kind: "lucide", name } : null;
  }

  return isSingleEmoji(value) ? { kind: "emoji", char: value } : null;
}

/** The value to store for a Lucide choice. */
export function lucideValue(name: string): string {
  return `${LUCIDE_PREFIX}${name}`;
}

/**
 * Normalise anything the user gives us into a storable value, or null.
 *
 * Null rather than "" so "no icon" has exactly one representation in the
 * database — two spellings of empty is how a "clear" button ends up not
 * clearing anything.
 */
export function normalizeIcon(value: string | null | undefined): string | null {
  const parsed = parseIcon(value);
  if (!parsed) return null;
  return parsed.kind === "lucide" ? lucideValue(parsed.name) : parsed.char;
}

/**
 * Lucide exports PascalCase components; the picker stores kebab-case names.
 * `shopping-cart` → `ShoppingCart`, `gamepad-2` → `Gamepad2`.
 */
export function lucideComponentName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
