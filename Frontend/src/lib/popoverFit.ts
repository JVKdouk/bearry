/**
 * Keeping popups on screen.
 *
 * Antd already tries to do this, and on this app it cannot: it decides whether
 * a popup overflows by measuring the page, but an open Drawer sets `overflow:
 * hidden` on <body>, which turns the page into a scroll container whose
 * scrollWidth *grows to include the overflowing popup*. The popup therefore
 * makes the page wide enough to contain the popup, antd concludes everything
 * fits, and the schedule panel hangs half off a phone screen with its Done
 * button unreachable.
 *
 * Rather than fight that measurement, this ignores it. The arithmetic is
 * unconditional: whatever antd chose, clamp it into the viewport. Nothing about
 * it depends on scroll containers, drawers, or how the popup got there, which
 * is what makes "this can never clip" a claim worth making.
 */

/** Breathing room between a popup and the screen edge. */
export const EDGE_MARGIN = 8;

/**
 * The left position that keeps a popup of `width` fully on screen.
 *
 * When the popup is wider than the viewport it can't fit at all; pinning it to
 * the left margin at least keeps its start visible and clips the far edge,
 * which is strictly better than clipping both.
 */
export function clampLeft(
  left: number,
  width: number,
  viewportWidth: number,
  margin: number = EDGE_MARGIN,
): number {
  const maxLeft = viewportWidth - width - margin;
  if (maxLeft < margin) return margin;
  return Math.min(Math.max(left, margin), maxLeft);
}

/** The widest a popup may be before it needs clipping rather than shifting. */
export function maxPopupWidth(viewportWidth: number, margin: number = EDGE_MARGIN): number {
  return Math.max(0, viewportWidth - margin * 2);
}

/**
 * Popups that portal to the end of <body> and carry their own inline position.
 *
 * All four are positioned by the same antd machinery, so all four inherit the
 * same blind spot — fixing only the one that was reported would leave the rest
 * waiting to be found by a user on a narrower phone.
 */
export const POPUP_SELECTOR = [
  ".ant-popover",
  ".ant-dropdown",
  ".ant-select-dropdown",
  ".ant-picker-dropdown",
].join(",");

/**
 * Clamp every open popup into the viewport.
 *
 * Writes `left` only when it actually differs, because these run from a
 * MutationObserver and writing a style inside one is a good way to build a loop
 * that never settles.
 */
export function fitPopups(doc: Document | null | undefined, viewportWidth?: number): void {
  if (!doc?.body) return;
  const vw = viewportWidth ?? doc.documentElement.clientWidth;

  for (const el of Array.from(doc.querySelectorAll<HTMLElement>(POPUP_SELECTOR))) {
    // Hidden popups have stale positions and no meaningful size; touching them
    // would fight antd's own reposition on the next open.
    if (el.offsetParent === null && el.style.display === "none") continue;

    const width = el.offsetWidth;
    if (width === 0) continue;

    el.style.maxWidth = `${maxPopupWidth(vw)}px`;

    const current = el.getBoundingClientRect().left;
    const desired = clampLeft(current, Math.min(width, maxPopupWidth(vw)), vw);
    if (Math.abs(desired - current) < 1) continue;

    // Assign an absolute left rather than nudging the existing one. A
    // right-anchored popover (`placement="bottomRight"`) is positioned with
    // `right`, leaving `left: auto` — reading that back and adding a delta
    // produced NaN, which the browser discards, so those popovers silently
    // stayed clipped while left-anchored ones were fixed. Anchoring from the
    // left explicitly works for both, and `right: auto` releases the old edge
    // so the two don't fight.
    //
    // scrollX because these are `position: absolute` in document coordinates.
    el.style.right = "auto";
    el.style.left = `${desired + (doc.defaultView?.scrollX ?? 0)}px`;
  }
}
