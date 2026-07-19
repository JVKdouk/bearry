/**
 * The access predicates that gate shared lists.
 *
 * Sharing's entire security boundary is "may this user do this" — so the rules
 * are pinned here as pure functions, tested without a DB. A wrong answer isn't
 * a glitch; it's a member editing a list they were given read-only, or removing
 * the owner.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  canManage,
  canRead,
  canWrite,
  readableProjectIds,
  type Access,
} from "@/src/lib/sharing/access";

const access = (owned: string[], member: [string, "view" | "write"][]): Access => ({
  owned: new Set(owned),
  member: new Map(member),
});

test("an owner can read, write and manage their own list", () => {
  const a = access(["p1"], []);
  assert.equal(canRead(a, "p1"), true);
  assert.equal(canWrite(a, "p1"), true);
  assert.equal(canManage(a, "p1"), true);
});

test("a write member can read and write but not manage", () => {
  const a = access([], [["p1", "write"]]);
  assert.equal(canRead(a, "p1"), true);
  assert.equal(canWrite(a, "p1"), true);
  // Managing (sharing, roles, deletion) is the owner's alone — a write member
  // is a collaborator, not a co-owner.
  assert.equal(canManage(a, "p1"), false);
});

test("a view member can read but not write or manage", () => {
  const a = access([], [["p1", "view"]]);
  assert.equal(canRead(a, "p1"), true);
  assert.equal(canWrite(a, "p1"), false);
  assert.equal(canManage(a, "p1"), false);
});

test("a stranger can do nothing", () => {
  const a = access(["mine"], [["shared", "write"]]);
  assert.equal(canRead(a, "someone-elses"), false);
  assert.equal(canWrite(a, "someone-elses"), false);
  assert.equal(canManage(a, "someone-elses"), false);
});

test("a block in no list is always the actor's to write", () => {
  const a = access([], []);
  assert.equal(canWrite(a, null), true);
});

test("readable ids include both owned and shared", () => {
  const a = access(["p1", "p2"], [["p3", "write"], ["p4", "view"]]);
  assert.deepEqual([...readableProjectIds(a)].sort(), ["p1", "p2", "p3", "p4"]);
});

test("owning a project outranks a stale membership on it", () => {
  // If both somehow exist, ownership wins — an owner is never merely a viewer of
  // their own list.
  const a = access(["p1"], [["p1", "view"]]);
  assert.equal(canWrite(a, "p1"), true);
  assert.equal(canManage(a, "p1"), true);
});
