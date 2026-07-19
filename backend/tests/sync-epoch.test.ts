/**
 * The schema epoch: when a client's cursor is too old to mean anything.
 *
 * A delta says what changed. "The entity you have no longer exists" is not
 * something any row can say, so a client holding `todo`/`calendarEvent`/`note`
 * stores has to be told to start over — otherwise it keeps them forever,
 * showing content the server will never update again.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { SCHEMA_EPOCH, predatesSchemaEpoch } from "@/src/lib/sync/epoch";

test("a null cursor is already a bootstrap and needs no forcing", () => {
  assert.equal(predatesSchemaEpoch(null), false);
});

test("a cursor from before the epoch forces a reset", () => {
  const before = new Date(SCHEMA_EPOCH.getTime() - 1);
  assert.equal(predatesSchemaEpoch(before), true);
});

test("a cursor from after the epoch is trusted", () => {
  const after = new Date(SCHEMA_EPOCH.getTime() + 1);
  assert.equal(predatesSchemaEpoch(after), false);
});

test("a cursor exactly at the epoch is trusted", () => {
  // The epoch is the moment the new layout became true, so a cursor at it has
  // seen the new layout. Off-by-one here would reset every client forever.
  assert.equal(predatesSchemaEpoch(new Date(SCHEMA_EPOCH.getTime())), false);
});

test("an ancient cursor resets", () => {
  assert.equal(predatesSchemaEpoch(new Date("2020-01-01T00:00:00Z")), true);
});

test("the epoch is a fixed constant, not a boot time", () => {
  // Two server instances that disagreed about this would flap clients between
  // bootstrap and delta on every request.
  assert.ok(SCHEMA_EPOCH instanceof Date);
  assert.ok(Number.isFinite(SCHEMA_EPOCH.getTime()));
  assert.ok(SCHEMA_EPOCH.getTime() < Date.now(), "epoch must already have passed");
});

test("a custom epoch is respected, so a later break can move it", () => {
  const later = new Date("2027-01-01T00:00:00Z");
  assert.equal(predatesSchemaEpoch(new Date("2026-08-01T00:00:00Z"), later), true);
  assert.equal(predatesSchemaEpoch(new Date("2027-02-01T00:00:00Z"), later), false);
});
