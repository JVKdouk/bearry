/**
 * Overlap packing for calendar blocks.
 *
 * Two events at the same time used to render on top of each other — the later
 * one won and the earlier was simply invisible, which is a data-loss-shaped bug
 * even though no data is lost. The layout is pure geometry, so it's testable.
 */

import test from "node:test";
import assert from "node:assert/strict";

const HOUR_PX = 56;
const MIN_BLOCK_PX = 22;

type Item = { id: string; top: number; bottom: number };

/** Mirrors layoutDay() in the calendar page. */
function layout(items: Item[]): Map<string, { col: number; cols: number }> {
  const out = new Map<string, { col: number; cols: number }>();
  const sorted = [...items].sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let cluster: Item[] = [];
  let clusterBottom = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const colEnds: number[] = [];
    const assigned = new Map<string, number>();
    for (const it of cluster) {
      let col = colEnds.findIndex((end) => end <= it.top);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(it.bottom);
      } else {
        colEnds[col] = it.bottom;
      }
      assigned.set(it.id, col);
    }
    for (const [id, col] of assigned) out.set(id, { col, cols: colEnds.length });
    cluster = [];
    clusterBottom = -Infinity;
  };

  for (const it of sorted) {
    if (it.top >= clusterBottom) flush();
    cluster.push(it);
    clusterBottom = Math.max(clusterBottom, it.bottom);
  }
  flush();
  return out;
}

/** Build an item from wall-clock hours, the way posFor() does. */
function at(id: string, startH: number, endH: number): Item {
  const top = startH * HOUR_PX;
  const bottom = top + Math.max((endH - startH) * HOUR_PX, MIN_BLOCK_PX);
  return { id, top, bottom };
}

/** No two blocks may occupy the same column while overlapping vertically. */
function assertNoVisualOverlap(items: Item[]) {
  const l = layout(items);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const verticallyOverlap = a.top < b.bottom && b.top < a.bottom;
      if (!verticallyOverlap) continue;
      const la = l.get(a.id)!;
      const lb = l.get(b.id)!;
      assert.notEqual(la.col, lb.col, `${a.id} and ${b.id} overlap and share column ${la.col}`);
    }
  }
}

test("a lone block takes the full width", () => {
  const l = layout([at("solo", 9, 10)]);
  assert.deepEqual(l.get("solo"), { col: 0, cols: 1 });
});

test("two identical events sit side by side, not stacked", () => {
  // The exact case from the report: "Nebo Ignite" and "Weekly Engineering"
  // both at 10:00.
  const items = [at("nebo", 10, 11), at("weekly", 10, 11)];
  const l = layout(items);
  assert.equal(l.get("nebo")!.cols, 2);
  assert.equal(l.get("weekly")!.cols, 2);
  assert.notEqual(l.get("nebo")!.col, l.get("weekly")!.col);
  assertNoVisualOverlap(items);
});

test("partially overlapping events split the width", () => {
  const items = [at("a", 9, 11), at("b", 10, 12)];
  const l = layout(items);
  assert.equal(l.get("a")!.cols, 2);
  assertNoVisualOverlap(items);
});

test("three-way overlap yields three columns", () => {
  const items = [at("a", 9, 12), at("b", 9.5, 11), at("c", 10, 10.5)];
  const l = layout(items);
  assert.equal(Math.max(...[...l.values()].map((v) => v.cols)), 3);
  assertNoVisualOverlap(items);
});

test("non-overlapping blocks each keep the full width", () => {
  const l = layout([at("morning", 9, 10), at("afternoon", 14, 15)]);
  assert.equal(l.get("morning")!.cols, 1);
  assert.equal(l.get("afternoon")!.cols, 1);
});

test("a column is reused once it's free", () => {
  // a: 9–10, b: 9–10 (2 cols). c: 10–11 overlaps neither, so it's its own cluster.
  const items = [at("a", 9, 10), at("b", 9, 10), at("c", 10, 11)];
  const l = layout(items);
  assert.equal(l.get("c")!.cols, 1, "a later non-overlapping block shouldn't be squeezed");
});

test("the screenshot's day packs without any collision", () => {
  const items = [
    at("PR Reviews", 9, 10),
    at("Nebo Ignite", 10, 11),
    at("Weekly Engineering", 10, 11),
    at("Lunch Time", 12, 13),
    at("Weekly BK", 14, 15),
    at("Internal", 16, 17),
  ];
  assertNoVisualOverlap(items);
  const l = layout(items);
  assert.equal(l.get("Lunch Time")!.cols, 1, "an unconflicted block keeps full width");
  assert.equal(l.get("Nebo Ignite")!.cols, 2);
});

test("very short adjacent events still get separate columns when drawn overlapping", () => {
  // 15-minute events render at MIN_BLOCK_PX, so back-to-back ones visually
  // collide even though their times don't overlap.
  const items = [at("x", 9, 9.08), at("y", 9.08, 9.16)];
  assertNoVisualOverlap(items);
});

test("layout is stable regardless of input order", () => {
  const items = [at("a", 9, 11), at("b", 10, 12), at("c", 9.5, 10.5)];
  const forward = layout(items);
  const reversed = layout([...items].reverse());
  for (const it of items) {
    assert.deepEqual(forward.get(it.id), reversed.get(it.id), `${it.id} moved on reorder`);
  }
});

// --- block content density --------------------------------------------------

/** Mirrors titleLines in the calendar page. */
function titleLines(heightPx: number, tiny: boolean): number {
  const lineHeight = tiny ? 12.5 : 15;
  const padding = 6;
  return Math.max(1, Math.floor((heightPx - padding) / lineHeight));
}

test("a taller block shows more of its title", () => {
  // The behaviour being replaced: two size buckets, so a 40-minute block and a
  // 20-minute one both collapsed to one truncated line.
  assert.ok(titleLines(80, false) > titleLines(40, false));
  assert.ok(titleLines(160, false) > titleLines(80, false));
});

test("even the shortest block shows one line rather than none", () => {
  // Zero lines would render a block with no identity at all.
  for (const h of [0, 1, 6, 10, 22]) {
    assert.ok(titleLines(h, false) >= 1, `height ${h} produced no line`);
    assert.ok(titleLines(h, true) >= 1, `tiny height ${h} produced no line`);
  }
});

test("line count never exceeds what the height can actually fit", () => {
  // Claiming more lines than fit would slice the last row through the middle.
  for (const h of [22, 30, 45, 56, 90, 120, 200]) {
    const lines = titleLines(h, false);
    assert.ok(lines * 15 <= h, `${lines} lines don't fit in ${h}px`);
  }
});

test("narrow columns fit more lines, since the type is smaller there", () => {
  assert.ok(titleLines(60, true) >= titleLines(60, false));
});

test("line count grows monotonically with height", () => {
  let previous = 0;
  for (let h = 20; h <= 300; h += 5) {
    const lines = titleLines(h, false);
    assert.ok(lines >= previous, `height ${h} showed fewer lines than ${h - 5}`);
    previous = lines;
  }
});
