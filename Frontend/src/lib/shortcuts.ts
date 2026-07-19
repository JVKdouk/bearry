/**
 * Desktop keyboard shortcuts.
 *
 * The whole difficulty here is the one rule: a shortcut must never fire while
 * someone is typing. A bare "n" that opens a drawer is a delight in a task list
 * and a disaster in a notes field — and this app's drawer is *mostly* text
 * inputs, so getting this wrong doesn't mean an occasional misfire, it means
 * every other keystroke eats your work.
 *
 * Kept pure and separate from the listener so the decision can be tested
 * directly against realistic targets rather than inferred from behaviour.
 */

export type Shortcut = "new-task" | "close" | null;

/** Element shapes that mean "the user is composing text right now". */
export interface KeyTarget {
  tagName?: string;
  isContentEditable?: boolean;
  /** Ant Design's dropdowns and selects take focus without being inputs. */
  getAttribute?: (name: string) => string | null;
}

/**
 * Is this element somewhere text goes?
 *
 * `contenteditable` and `role=combobox`/`textbox` matter as much as the obvious
 * tags: an antd Select is a div that swallows keystrokes for its own search, so
 * treating it as neutral ground would make "n" unusable inside every dropdown.
 */
export function isTypingTarget(target: KeyTarget | null | undefined): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;

  const role = target.getAttribute?.("role");
  if (role === "combobox" || role === "textbox" || role === "searchbox") return true;

  return false;
}

export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: KeyTarget | null;
}

export interface ShortcutContext {
  /**
   * Whether a popover, dropdown, select menu or date picker is open.
   *
   * Escape has to mean "close the innermost thing", and antd closes its own
   * overlays without stopping the event — so without this, one Escape inside
   * the reminder popover dismissed the popover *and* the drawer behind it,
   * throwing away an unsaved draft. Verified in a browser, not assumed.
   */
  overlayOpen?: boolean;
}

/**
 * What this keystroke means, if anything.
 *
 * Escape is deliberately allowed to fire *from inside* a text field: "get me
 * out of here" is the one intent that has to work no matter where focus sits,
 * and no text field wants a bare Escape for itself. Everything else is
 * suppressed while typing.
 *
 * Modifier combinations are left alone entirely — Cmd-N is the browser's, and
 * quietly stealing it is the kind of thing that makes an app feel hostile.
 */
export function shortcutFor(e: KeyEventLike, ctx: ShortcutContext = {}): Shortcut {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;

  // One Escape, one layer. The overlay closes itself; we stay out of it.
  if (e.key === "Escape") return ctx.overlayOpen ? null : "close";

  if (isTypingTarget(e.target)) return null;

  // Lowercased so it still works with caps lock on; Shift-N is left alone
  // because it's a plausible start to typing somewhere we misjudged.
  if (!e.shiftKey && e.key.toLowerCase() === "n") return "new-task";

  return null;
}

/**
 * Selectors for antd overlays that own Escape while they're open.
 *
 * Matched against the *rendered* state rather than React state because these
 * portal themselves to the end of <body>, well outside any component that
 * could report on them. The `-hidden` classes matter: antd keeps a closed
 * overlay in the DOM, so presence alone would permanently disable Escape after
 * the first popover of the session.
 */
const OVERLAY_SELECTOR = [
  ".ant-popover:not(.ant-popover-hidden)",
  ".ant-dropdown:not(.ant-dropdown-hidden)",
  ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
  ".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)",
  // The colour picker needs no entry: its panel is wrapped in .ant-popover,
  // already matched above. Adding `.ant-color-picker` looked reasonable and was
  // actively harmful — it is the trigger, not the panel, so Escape would have
  // been dead for as long as a picker was on screen.
  // Tooltips are deliberately absent: they follow the pointer, don't take
  // focus, and never own Escape — counting them meant a tooltip lingering over
  // the button you just used blocked Escape entirely.
].join(",");

/** Is some overlay currently on screen and claiming Escape for itself? */
export function hasOpenOverlay(doc: Pick<Document, "querySelector"> | null | undefined): boolean {
  return !!doc?.querySelector(OVERLAY_SELECTOR);
}

/**
 * Close whatever overlays are open, the way clicking away would.
 *
 * antd's click-triggered popovers don't listen for Escape unless focus happens
 * to be inside them, so simply declining to act left Escape doing nothing at
 * all while a popover was up — which is worse than the bug it replaced, because
 * at least that did something. Rather than converting every popover in the app
 * to a controlled component, this replays the dismissal antd *does* listen for:
 * a pointer event outside the overlay.
 *
 * Dispatched on the document rather than on <body>: antd's trigger binds its
 * outside-click listener to the document, and a body-targeted event doesn't
 * reach it. Confirmed by trying both in a browser.
 */
export function dismissOverlays(doc: Document | null | undefined): void {
  if (!doc) return;
  for (const type of ["pointerdown", "mousedown", "mouseup", "click"] as const) {
    doc.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
}
