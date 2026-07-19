/**
 * List appearance: the palette, the icons, and what a list falls back to.
 *
 * Pure so the rules are testable and shared. A list is identified at a glance
 * far more often than it is read — in the sidebar, on a card footer, in a
 * project picker — so what it looks like when the user has chosen nothing
 * matters as much as what they can choose.
 */

export const LIST_PALETTE = [
  "#a855f7", "#4096ff", "#36cfc9", "#f759ab",
  "#ffa940", "#73d13d", "#597ef7", "#ff7875",
] as const;

/**
 * Icons offered in the picker.
 *
 * Emoji rather than a named icon set: no mapping table, they render on every
 * platform the app runs on, and the user isn't limited to what someone drew.
 * Grouped roughly by the kind of list people actually keep.
 */
export const LIST_ICONS = [
  "📥", "✅", "⭐", "🔥", "🎯", "📌", "🗓️", "⏰",
  "💼", "🏠", "👤", "👨‍👩‍👧", "🛒", "💰", "✈️", "🚗",
  "📚", "✏️", "💡", "🎨", "🎵", "🎮", "🏃", "🧘",
  "🍳", "🌱", "🐾", "❤️", "🧠", "🔧", "📞", "📦",
] as const;

/** The next colour for a new list, cycling so consecutive lists differ. */
export function nextColor(existingCount: number): string {
  return LIST_PALETTE[existingCount % LIST_PALETTE.length];
}

/**
 * Is this a single, sensible icon?
 *
 * Length is measured in code points rather than UTF-16 units, because most
 * emoji are surrogate pairs and `"🎯".length` is 2 — a naive check rejects
 * every emoji it is supposed to accept. Compound emoji (a family, a flag) run
 * longer still, so the cap is generous; the point is to reject a pasted
 * paragraph, not to police which emoji someone likes.
 */
export function isValidIcon(icon: string): boolean {
  const trimmed = icon.trim();
  if (trimmed.length === 0) return false;
  return [...trimmed].length <= 8;
}

/** Store null rather than an empty string, so "unset" has one representation. */
export function normalizeIcon(icon: string | null | undefined): string | null {
  if (!icon) return null;
  const trimmed = icon.trim();
  if (!trimmed || !isValidIcon(trimmed)) return null;
  return trimmed;
}

/**
 * What a list shows when it has no icon.
 *
 * Null, deliberately, rather than a default emoji: the coloured dot is the
 * fallback, and handing every list the same icon would make them harder to
 * tell apart than no icon at all.
 */
export function iconFor(project: { icon?: string | null }): string | null {
  return normalizeIcon(project.icon);
}

/** A trimmed, non-empty list name, or null if the user gave us nothing. */
export function cleanName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : null;
}
