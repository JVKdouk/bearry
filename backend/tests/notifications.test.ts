/**
 * Reminder delivery rules.
 *
 * A missed reminder is a disappointment. A duplicate, or a burst at 9am for
 * things that happened overnight, is why someone disables notifications for
 * good. Every rule here is biased toward staying quiet when unsure.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_LATENESS_MINUTES,
  isStillRelevant,
  nextRecurringFireAt,
  reminderBody,
} from "@/src/lib/notifications/reminders";

const NOW = new Date("2026-07-20T09:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const minutesAhead = (m: number) => new Date(NOW.getTime() + m * 60_000);

test("a reminder due right now is delivered", () => {
  assert.ok(isStillRelevant(NOW, NOW));
});

test("a slightly late reminder is still delivered", () => {
  // The sweep runs on a timer; being a minute or two behind is normal.
  assert.ok(isStillRelevant(minutesAgo(2), NOW));
  assert.ok(isStillRelevant(minutesAgo(MAX_LATENESS_MINUTES), NOW));
});

test("a reminder from before the app was down is NOT delivered", () => {
  // The failure this prevents: a server back after an outage firing a burst of
  // notifications for things that already happened.
  assert.ok(!isStillRelevant(minutesAgo(MAX_LATENESS_MINUTES + 1), NOW));
  assert.ok(!isStillRelevant(minutesAgo(60 * 12), NOW));
});

test("a reminder not yet due is not delivered early", () => {
  assert.ok(!isStillRelevant(minutesAhead(1), NOW));
  assert.ok(!isStillRelevant(minutesAhead(60), NOW));
});

test("the lateness window is generous enough to survive a restart", () => {
  // Tuned below this and an ordinary deploy would silently drop reminders.
  assert.ok(MAX_LATENESS_MINUTES >= 15, `${MAX_LATENESS_MINUTES}m is too tight`);
});

// --- wording ---------------------------------------------------------------

test("a reminder at the time says it's starting now", () => {
  assert.match(reminderBody("Standup", 0), /starting now/);
});

test("lead times read the way people say them", () => {
  assert.match(reminderBody("Standup", 30), /in 30 minutes/);
  assert.match(reminderBody("Standup", 60), /in 1 hour\b/);
  assert.match(reminderBody("Standup", 120), /in 2 hours/);
  assert.match(reminderBody("Standup", 60 * 24), /in 1 day\b/);
  assert.match(reminderBody("Standup", 60 * 24 * 7), /in a week/);
});

test("the task's name always leads the message", () => {
  // A notification whose first words are "in 1 hour" tells you nothing while
  // it's still on the lock screen.
  for (const offset of [0, 30, 60, 1440, 10080]) {
    assert.ok(reminderBody("Pay rent", offset).startsWith("Pay rent"), `offset ${offset}`);
  }
});

test("a negative offset is treated as 'now', not as the future", () => {
  assert.match(reminderBody("Odd", -30), /starting now/);
});

test("wording never leaks a raw minute count for long offsets", () => {
  // "in 10080 minutes" is technically true and completely useless.
  const body = reminderBody("Renew passport", 60 * 24 * 7);
  assert.ok(!body.includes("10080"));
});

// ── Recurring reminders re-arm (nextRecurringFireAt) ─────────────────────────

const WEEKLY = "FREQ=WEEKLY";
// A past Monday anchor so occurrences are Mondays 13:00Z; NOW is Mon 2026-07-20.
const ANCHOR = new Date("2026-07-06T13:00:00.000Z");

test("firing an occurrence re-arms to the following one, not the same one", () => {
  // offset 0: fired the 2026-07-13 occurrence; next is 2026-07-20.
  const fired = new Date("2026-07-13T13:00:00.000Z");
  const next = nextRecurringFireAt(ANCHOR, WEEKLY, fired, 0, new Date("2026-07-13T13:00:00.000Z"));
  assert.equal(next?.toISOString(), "2026-07-20T13:00:00.000Z");
});

test("a lead-time reminder re-arms past the occurrence it warned about", () => {
  // offset 60: the fireAt is one hour before the occurrence. Firing the reminder
  // for the 2026-07-20 occurrence (fireAt 12:00) must jump to 2026-07-27, not
  // back to 2026-07-20 and fire again immediately.
  const fired = new Date("2026-07-20T12:00:00.000Z");
  const now = new Date("2026-07-20T12:00:00.000Z");
  const next = nextRecurringFireAt(ANCHOR, WEEKLY, fired, 60, now);
  // 2026-07-27 13:00 minus one hour lead.
  assert.equal(next?.toISOString(), "2026-07-27T12:00:00.000Z");
});

test("downtime past several occurrences skips to the next FUTURE one", () => {
  // Stale fireAt from three weeks ago; now is 2026-07-20. It must not walk every
  // missed week — it jumps straight to the next occurrence at/after now.
  const staleFired = new Date("2026-06-29T13:00:00.000Z");
  const now = new Date("2026-07-20T09:00:00.000Z");
  const next = nextRecurringFireAt(ANCHOR, WEEKLY, staleFired, 0, now);
  assert.ok(next && next.getTime() >= now.getTime(), "must land on/after now");
  assert.equal(next!.toISOString(), "2026-07-20T13:00:00.000Z");
});

test("a finished series re-arms to nothing", () => {
  const fired = new Date("2026-07-13T13:00:00.000Z");
  const next = nextRecurringFireAt(ANCHOR, "FREQ=WEEKLY;COUNT=2", fired, 0, fired);
  // Anchor 07-06 + one more (07-13) exhausts COUNT=2; nothing after 07-13.
  assert.equal(next, null);
});
