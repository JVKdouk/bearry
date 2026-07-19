/**
 * List appearance: the palette and the name rules.
 *
 * Icons live in listIcon.ts — they grew a second kind (Lucide as well as
 * emoji) and their own validation, which is more than a colour constant file
 * should carry.
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

/** The next colour for a new list, cycling so consecutive lists differ. */
export function nextColor(existingCount: number): string {
  return LIST_PALETTE[existingCount % LIST_PALETTE.length];
}

/** A trimmed, non-empty list name, or null if the user gave us nothing. */
export function cleanName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : null;
}
