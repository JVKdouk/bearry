import { test } from "node:test";
import assert from "node:assert/strict";
import { hasOpenOverlay, isTypingTarget, shortcutFor, type KeyTarget } from "../src/lib/shortcuts";

/** A target that answers getAttribute like a real element would. */
function el(tagName: string, attrs: Record<string, string> = {}, editable = false): KeyTarget {
  return {
    tagName,
    isContentEditable: editable,
    getAttribute: (n) => attrs[n] ?? null,
  };
}

test("plain elements are not typing targets", () => {
  assert.equal(isTypingTarget(el("DIV")), false);
  assert.equal(isTypingTarget(el("BUTTON")), false);
  assert.equal(isTypingTarget(el("BODY")), false);
});

test("inputs, textareas and selects are typing targets", () => {
  assert.equal(isTypingTarget(el("INPUT")), true);
  assert.equal(isTypingTarget(el("TEXTAREA")), true);
  assert.equal(isTypingTarget(el("SELECT")), true);
});

test("tag matching is case insensitive", () => {
  assert.equal(isTypingTarget(el("input")), true);
  assert.equal(isTypingTarget(el("textarea")), true);
});

test("contenteditable is a typing target whatever the tag", () => {
  assert.equal(isTypingTarget(el("DIV", {}, true)), true);
});

test("antd's focusable roles count as typing targets", () => {
  // A Select is a div; without this "n" would be unusable inside every dropdown.
  assert.equal(isTypingTarget(el("DIV", { role: "combobox" })), true);
  assert.equal(isTypingTarget(el("DIV", { role: "textbox" })), true);
  assert.equal(isTypingTarget(el("DIV", { role: "searchbox" })), true);
  assert.equal(isTypingTarget(el("DIV", { role: "button" })), false);
});

test("a missing target is not a typing target", () => {
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(undefined), false);
});

test("a target with no getAttribute doesn't throw", () => {
  assert.equal(isTypingTarget({ tagName: "DIV" }), false);
});

test("n opens the create drawer", () => {
  assert.equal(shortcutFor({ key: "n", target: el("BODY") }), "new-task");
});

test("N with caps lock still opens it", () => {
  // Caps lock reports "N" with shiftKey false — a real way people type.
  assert.equal(shortcutFor({ key: "N", shiftKey: false, target: el("BODY") }), "new-task");
});

test("Shift-N does nothing", () => {
  assert.equal(shortcutFor({ key: "N", shiftKey: true, target: el("BODY") }), null);
});

test("n while typing does nothing", () => {
  assert.equal(shortcutFor({ key: "n", target: el("INPUT") }), null);
  assert.equal(shortcutFor({ key: "n", target: el("TEXTAREA") }), null);
  assert.equal(shortcutFor({ key: "n", target: el("DIV", {}, true) }), null);
});

test("Escape closes even from inside a text field", () => {
  // The one intent that must work regardless of where focus sits.
  assert.equal(shortcutFor({ key: "Escape", target: el("TEXTAREA") }), "close");
  assert.equal(shortcutFor({ key: "Escape", target: el("BODY") }), "close");
});

test("browser modifier combinations are left alone", () => {
  assert.equal(shortcutFor({ key: "n", metaKey: true, target: el("BODY") }), null);
  assert.equal(shortcutFor({ key: "n", ctrlKey: true, target: el("BODY") }), null);
  assert.equal(shortcutFor({ key: "n", altKey: true, target: el("BODY") }), null);
  // Even Escape: Ctrl-Escape is the OS's on some platforms.
  assert.equal(shortcutFor({ key: "Escape", ctrlKey: true, target: el("BODY") }), null);
});

test("Escape with an overlay open is left to the overlay", () => {
  // Verified in a browser first: antd closes its popover but doesn't stop the
  // event, so without this a single Escape inside the reminder popover also
  // closed the drawer behind it and threw away an unsaved draft.
  assert.equal(shortcutFor({ key: "Escape", target: el("BODY") }, { overlayOpen: true }), null);
  assert.equal(shortcutFor({ key: "Escape", target: el("BODY") }, { overlayOpen: false }), "close");
});

test("an open overlay doesn't disable the other shortcuts", () => {
  // Only Escape is contested — 'n' is already suppressed by the typing check.
  assert.equal(shortcutFor({ key: "n", target: el("BODY") }, { overlayOpen: true }), "new-task");
});

test("hasOpenOverlay ignores antd's hidden leftovers", () => {
  // antd keeps closed overlays in the DOM, so matching on presence alone would
  // permanently disable Escape after the first popover of the session.
  const doc = (matches: string[]) => ({
    querySelector: (sel: string) =>
      matches.some((m) => sel.split(",").some((s) => s.trim() === m)) ? {} : null,
  });

  assert.equal(hasOpenOverlay(doc([".ant-popover:not(.ant-popover-hidden)"])), true);
  assert.equal(hasOpenOverlay(doc([".ant-select-dropdown:not(.ant-select-dropdown-hidden)"])), true);
  assert.equal(hasOpenOverlay(doc([])), false);
});

test("a lingering tooltip does not count as an overlay", () => {
  // Found in a browser: including tooltips meant the one hovering over the
  // button you just clicked blocked Escape for the rest of the session.
  const doc = { querySelector: (sel: string) => (sel.includes("tooltip") ? {} : null) };
  assert.equal(hasOpenOverlay(doc), false);
});

test("hasOpenOverlay survives having no document", () => {
  assert.equal(hasOpenOverlay(null), false);
  assert.equal(hasOpenOverlay(undefined), false);
});

test("unrelated keys mean nothing", () => {
  for (const key of ["a", "Enter", "Tab", " ", "ArrowDown", "1"]) {
    assert.equal(shortcutFor({ key, target: el("BODY") }), null, key);
  }
});
