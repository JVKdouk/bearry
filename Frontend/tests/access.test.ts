import { test } from "node:test";
import assert from "node:assert/strict";
import { accessTo, canEdit, isSharedToMe, otherMemberCount } from "../src/lib/access";

const proj = (id: string, userId?: string) => ({ id, userId });
type M = { projectId: string; userId: string; role: "view" | "write"; deletedAt?: string | null };
const m = (projectId: string, userId: string, role: "view" | "write"): M => ({ projectId, userId, role });

test("your own list is owner", () => {
  assert.equal(accessTo(proj("p", "me"), "me", []), "owner");
});

test("a pre-sharing list with no owner is owner", () => {
  assert.equal(accessTo(proj("p", undefined), "me", []), "owner");
});

test("a list owned by someone else, with a write membership, is write", () => {
  assert.equal(accessTo(proj("p", "boss"), "me", [m("p", "me", "write")]), "write");
});

test("a view membership is view", () => {
  assert.equal(accessTo(proj("p", "boss"), "me", [m("p", "me", "view")]), "view");
});

test("someone else's list with no membership is null", () => {
  assert.equal(accessTo(proj("p", "boss"), "me", []), null);
});

test("ownership beats a stale membership on the same list", () => {
  assert.equal(accessTo(proj("p", "me"), "me", [m("p", "me", "view")]), "owner");
});

test("a deleted membership grants nothing", () => {
  const members = [{ ...m("p", "me", "write"), deletedAt: "2026-07-19T00:00:00Z" }];
  assert.equal(accessTo(proj("p", "boss"), "me", members), null);
});

test("no project means no access", () => {
  assert.equal(accessTo(undefined, "me", []), null);
});

test("canEdit is owner or write only", () => {
  assert.equal(canEdit("owner"), true);
  assert.equal(canEdit("write"), true);
  assert.equal(canEdit("view"), false);
  assert.equal(canEdit(null), false);
});

test("isSharedToMe excludes owned and unrelated", () => {
  assert.equal(isSharedToMe("write"), true);
  assert.equal(isSharedToMe("view"), true);
  assert.equal(isSharedToMe("owner"), false);
  assert.equal(isSharedToMe(null), false);
});

test("otherMemberCount ignores yourself and deleted rows", () => {
  const members = [
    m("p", "me", "write"),
    m("p", "bob", "write"),
    m("p", "ana", "view"),
    { ...m("p", "gone", "write"), deletedAt: "x" },
  ];
  assert.equal(otherMemberCount("p", "me", members), 2);
});
