/**
 * Who may write which block, and under whose key it lands.
 *
 * These are the rules that stop a view-member editing, a stranger writing, and
 * a task being silently re-keyed under the wrong user by a cross-owner move.
 * Pure, so the awkward combinations are pinned without a database.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { authorizeBlockWrite, type AccessView } from "@/src/lib/sharing/writeAuthz";

// A world where: actor "me" owns "mine"; is a write member of "team" (owned by
// "boss"); a view member of "readonly" (owned by "boss"); no access to "other".
const owners: Record<string, string> = { mine: "me", team: "boss", readonly: "boss", other: "stranger" };
const ownerOf = (id: string) => owners[id] ?? null;
const access: AccessView = {
  owns: (id) => id === "mine",
  roleOn: (id) => (id === "team" ? "write" : id === "readonly" ? "view" : undefined),
};

test("creating a personal task is allowed, owned by the actor", () => {
  const d = authorizeBlockWrite("me", access, null, null, ownerOf);
  assert.deepEqual(d, { allowed: true, ownerId: "me" });
});

test("creating in your own list is owned by you", () => {
  const d = authorizeBlockWrite("me", access, null, "mine", ownerOf);
  assert.deepEqual(d, { allowed: true, ownerId: "me" });
});

test("a write member creates under the owner's key", () => {
  // This is the whole invariant: content in a shared list is stored under the
  // owner, whoever wrote it.
  const d = authorizeBlockWrite("me", access, null, "team", ownerOf);
  assert.deepEqual(d, { allowed: true, ownerId: "boss" });
});

test("a view member cannot create in the shared list", () => {
  const d = authorizeBlockWrite("me", access, null, "readonly", ownerOf);
  assert.equal(d.allowed, false);
});

test("a stranger cannot create in a list they can't see", () => {
  const d = authorizeBlockWrite("me", access, null, "other", ownerOf);
  assert.equal(d.allowed, false);
});

test("editing your own personal task is fine, owner unchanged", () => {
  const d = authorizeBlockWrite("me", access, { userId: "me", projectId: "mine" }, undefined, ownerOf);
  assert.deepEqual(d, { allowed: true, ownerId: "me" });
});

test("a write member editing a shared task keeps it under the owner", () => {
  const d = authorizeBlockWrite("me", access, { userId: "boss", projectId: "team" }, undefined, ownerOf);
  assert.deepEqual(d, { allowed: true, ownerId: "boss" });
});

test("a view member cannot edit a shared task", () => {
  const d = authorizeBlockWrite("me", access, { userId: "boss", projectId: "readonly" }, undefined, ownerOf);
  assert.equal(d.allowed, false);
});

test("moving a task between the owner's own lists is allowed", () => {
  // boss's task moving from team to another of boss's lists (same owner).
  const owners2: Record<string, string> = { ...owners, team2: "boss" };
  const d = authorizeBlockWrite(
    "me",
    { owns: () => false, roleOn: (id) => (id === "team" || id === "team2" ? "write" : undefined) },
    { userId: "boss", projectId: "team" },
    "team2",
    (id) => owners2[id] ?? null,
  );
  assert.deepEqual(d, { allowed: true, ownerId: "boss" });
});

test("a member cannot pull a shared task into their private list", () => {
  // Cross-owner move: boss's task -> me's personal list would re-key it.
  const d = authorizeBlockWrite("me", access, { userId: "boss", projectId: "team" }, "mine", ownerOf);
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.match(d.reason, /different owners/);
});

test("a member cannot push their private task into someone else's shared list", () => {
  // me's task -> team (owned by boss). Destination owner differs from the
  // block's owner (me), so it's refused.
  const d = authorizeBlockWrite("me", access, { userId: "me", projectId: "mine" }, "team", ownerOf);
  assert.equal(d.allowed, false);
});

test("moving your own task out of a list to no list keeps your ownership", () => {
  const d = authorizeBlockWrite("me", access, { userId: "me", projectId: "mine" }, null, ownerOf);
  assert.deepEqual(d, { allowed: true, ownerId: "me" });
});
