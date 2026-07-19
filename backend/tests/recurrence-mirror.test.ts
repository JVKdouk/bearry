/**
 * Guards the one duplicated file in the codebase.
 *
 * The RRULE engine exists twice — once here, once in the frontend — because the
 * app is offline-first and the client must expand occurrences with no server to
 * ask. Duplication is a deliberate trade, but silent drift is not: a subtly
 * different expander on each side produces a calendar that disagrees with the
 * scheduler about which days a task falls on, and that is invisible until a
 * user notices weeks later.
 *
 * So the copies must be byte-identical, mechanically. Edit the backend file and
 * run `npm run sync:rrule`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BACKEND = join(import.meta.dirname, "../src/lib/recurrence/rrule.ts");
const FRONTEND = join(import.meta.dirname, "../../Frontend/src/lib/recurrence/rrule.ts");

test("the frontend RRULE engine is a byte-identical mirror of this one", () => {
  // Skip rather than fail when the frontend isn't checked out beside us — the
  // backend must stay independently testable (CI may build it alone).
  if (!existsSync(FRONTEND)) return;

  const backend = readFileSync(BACKEND, "utf8");
  const frontend = readFileSync(FRONTEND, "utf8");

  if (backend === frontend) return;

  // A bare "not equal" would send someone diffing 290 lines by hand, so point
  // at the first line that differs.
  const a = backend.split("\n");
  const b = frontend.split("\n");
  let line = 0;
  while (line < a.length && line < b.length && a[line] === b[line]) line += 1;

  assert.fail(
    `RRULE engines have drifted, first at line ${line + 1}:\n` +
      `  backend:  ${a[line] ?? "(end of file)"}\n` +
      `  frontend: ${b[line] ?? "(end of file)"}\n` +
      `Edit backend/src/lib/recurrence/rrule.ts, then run: npm run sync:rrule`,
  );
});
