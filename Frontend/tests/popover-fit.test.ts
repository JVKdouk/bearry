import { test } from "node:test";
import assert from "node:assert/strict";
import { clampLeft, EDGE_MARGIN, maxPopupWidth } from "../src/lib/popoverFit";

test("a popup already on screen is left alone", () => {
  assert.equal(clampLeft(20, 300, 390), 20);
  assert.equal(clampLeft(100, 200, 1280), 100);
});

test("a popup overflowing the right edge is pulled back", () => {
  // The reported bug: 324px wide at left 116 on a 390 viewport.
  const left = clampLeft(116, 324, 390);
  assert.equal(left, 390 - 324 - EDGE_MARGIN);
  assert.ok(left + 324 <= 390 - EDGE_MARGIN);
});

test("a popup overflowing the left edge is pushed back", () => {
  assert.equal(clampLeft(-40, 200, 390), EDGE_MARGIN);
});

test("a popup wider than the viewport pins to the left margin", () => {
  // It cannot fit; showing its start beats clipping both ends.
  assert.equal(clampLeft(50, 500, 390), EDGE_MARGIN);
  assert.equal(clampLeft(-10, 500, 390), EDGE_MARGIN);
});

test("a popup exactly filling the usable width sits at the margin", () => {
  const w = 390 - EDGE_MARGIN * 2;
  assert.equal(clampLeft(200, w, 390), EDGE_MARGIN);
});

test("the result never leaves the viewport, for any input", () => {
  // The whole point is that this holds unconditionally, so assert it that way
  // rather than trusting the three cases above to be exhaustive.
  for (const vw of [320, 360, 390, 414, 768, 1280]) {
    for (const width of [50, 200, 300, 324, 500, 2000]) {
      for (const left of [-200, -1, 0, 5, 116, 300, 1000, 5000]) {
        const got = clampLeft(left, width, vw);
        assert.ok(got >= EDGE_MARGIN, `left ${got} < margin (vw=${vw} w=${width})`);
        if (width <= maxPopupWidth(vw)) {
          assert.ok(
            got + width <= vw - EDGE_MARGIN + 0.001,
            `right edge ${got + width} > ${vw - EDGE_MARGIN} (vw=${vw} w=${width} left=${left})`,
          );
        }
      }
    }
  }
});

test("maxPopupWidth leaves a margin on both sides", () => {
  assert.equal(maxPopupWidth(390), 390 - EDGE_MARGIN * 2);
  assert.equal(maxPopupWidth(1280), 1280 - EDGE_MARGIN * 2);
});

test("maxPopupWidth never goes negative on absurd viewports", () => {
  assert.equal(maxPopupWidth(10), 0);
  assert.equal(maxPopupWidth(0), 0);
});

test("a custom margin is respected", () => {
  assert.equal(clampLeft(300, 100, 390, 20), 390 - 100 - 20);
  assert.equal(clampLeft(0, 100, 390, 20), 20);
});
