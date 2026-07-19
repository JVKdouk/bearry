import { test } from "node:test";
import assert from "node:assert/strict";
import { matchTemplate, PERSONA_TEMPLATES, STEADY } from "../src/lib/personas";

test("there are three templates with distinct ids", () => {
  assert.equal(PERSONA_TEMPLATES.length, 3);
  assert.equal(new Set(PERSONA_TEMPLATES.map((t) => t.id)).size, 3);
});

test("every template sets every key STEADY does", () => {
  // A template that leaves a key unset would silently inherit whatever the user
  // had before, so picking it twice from different starting points would give
  // two different schedules.
  for (const t of PERSONA_TEMPLATES) {
    assert.deepEqual(
      Object.keys(t.values).sort(),
      Object.keys(STEADY).sort(),
      `${t.id} sets a different set of keys`,
    );
  }
});

test("each template matches itself and nothing else", () => {
  for (const t of PERSONA_TEMPLATES) {
    const matched = matchTemplate(t.values);
    assert.equal(matched?.id, t.id);
  }
});

test("no settings at all reads as Steady, not Custom", () => {
  // Someone who has never opened this page is living the default; telling them
  // their rhythm is "Custom" would be true of the storage and false of them.
  assert.equal(matchTemplate({})?.id, "steady");
});

test("a partially set persona still matches when the rest are defaults", () => {
  assert.equal(matchTemplate({ sessionLength: "50" })?.id, "steady");
});

test("one changed value drops to no template", () => {
  const tweaked = { ...STEADY, sessionLength: "35" };
  assert.equal(matchTemplate(tweaked), null);
});

test("unrelated persona keys don't break matching", () => {
  // Adding a persona field later must not make every template read as Custom.
  const withExtra = { ...STEADY, somethingNew: "whatever" };
  assert.equal(matchTemplate(withExtra)?.id, "steady");
});

test("templates are genuinely different shapes, not one dial", () => {
  const bursts = PERSONA_TEMPLATES.find((t) => t.id === "bursts")!;
  const deep = PERSONA_TEMPLATES.find((t) => t.id === "deep")!;

  // Short bursts must mean more, smaller sessions than deep dives — if this
  // inverts, the names are lying about what the planner will do.
  assert.ok(Number(bursts.values.sessionLength) < Number(deep.values.sessionLength));
  assert.ok(
    Number(bursts.values.maxSessionsPerDay) > Number(deep.values.maxSessionsPerDay),
  );
  assert.notEqual(bursts.values.startDifficulty, deep.values.startDifficulty);
});

test("every template's values are within the server's clamps", () => {
  // The server clamps anything out of range, so an out-of-range template would
  // save a value that reads back differently and never match itself again.
  const ranges: Record<string, [number, number]> = {
    sessionLength: [10, 240],
    breakLength: [0, 120],
    longBreakEvery: [1, 12],
    longBreakLength: [0, 180],
    dailyMaxMinutes: [30, 960],
    maxSessionsPerDay: [1, 20],
  };
  const enums: Record<string, string[]> = {
    startDifficulty: ["easy", "moderate", "hard"],
    stopDifficulty: ["easy", "moderate", "hard"],
    weekendMode: ["none", "light", "full"],
    flexibility: ["rigid", "balanced", "fluid"],
  };

  for (const t of PERSONA_TEMPLATES) {
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const n = Number(t.values[key]);
      assert.ok(Number.isInteger(n), `${t.id}.${key} is not an integer`);
      assert.ok(n >= min && n <= max, `${t.id}.${key} = ${n} is outside ${min}–${max}`);
    }
    for (const [key, allowed] of Object.entries(enums)) {
      assert.ok(allowed.includes(t.values[key]), `${t.id}.${key} = ${t.values[key]}`);
    }
  }
});
