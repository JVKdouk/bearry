/**
 * Offline-first behaviour.
 *
 * These are the properties that fail silently and destroy trust: a queued edit
 * that doesn't survive a reload, a bulk flush that turns into N requests, or one
 * user's cached workspace leaking to the next person on a shared device. None of
 * them show up in a normal online click-through, so they get tests.
 */

import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";

import { useNetwork } from "@/store/network";
import { useSync } from "@/store/sync";
import { useCapture } from "@/store/capture";
import { idbGet, KEYS } from "@/lib/offlineDb";

// --- fetch stub -----------------------------------------------------------
// Records requests so we can assert on how many went out, and can be flipped
// into "no network" mode to simulate being offline.

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let networkUp = true;

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Map(),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/**
 * Narrow fetch's very wide argument types to what api.ts actually sends: a URL
 * string and a JSON string body. Blindly `String()`-ing a Request object or a
 * FormData would silently produce "[object Object]" and the mock would match no
 * route while looking like it worked.
 */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function jsonBodyOf(init?: RequestInit): unknown {
  if (typeof init?.body !== "string") return undefined;
  return JSON.parse(init.body);
}

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (!networkUp) throw new TypeError("Failed to fetch");
  const url = urlOf(input);
  const body = jsonBodyOf(init);
  calls.push({ url, method: init?.method ?? "GET", body });

  if (url.includes("/sync/push")) {
    const ops = (body as { ops: { entity: string; id?: string }[] }).ops;
    return Promise.resolve(
      jsonResponse({
        results: ops.map((o) => ({
          entity: o.entity,
          id: o.id ?? "srv",
          status: "applied",
          version: 1,
        })),
      }),
    );
  }
  if (url.includes("/sync/pull")) {
    return Promise.resolve(jsonResponse({ cursor: new Date().toISOString(), changes: {}, hasMore: false }));
  }
  if (url.includes("/capture/")) return Promise.resolve(jsonResponse({ id: "c1" }));
  return Promise.resolve(jsonResponse({}));
});

function goOffline() {
  networkUp = false;
  useNetwork.setState({ status: "offline", browserOnline: false });
}
function goOnline() {
  networkUp = true;
  useNetwork.setState({ status: "online", browserOnline: true });
}

/** Let debounced persistence and microtasks settle. */
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));

test("edits made offline are queued, not lost", async () => {
  goOnline();
  useSync.getState().reset();
  await useSync.getState().bootstrap("user-a");

  goOffline();
  const id = useSync.getState().create("todo", { title: "written on a train" });

  // Visible locally straight away — the UI must not wait on the network.
  assert.equal(useSync.getState().collections.todo[id].title, "written on a train");
  assert.equal(useSync.getState().pendingCount, 1);
  assert.equal(useSync.getState().status, "queued");
});

test("the queue survives a reload while still offline", async () => {
  goOnline();
  useSync.getState().reset();
  await useSync.getState().bootstrap("user-a");

  goOffline();
  useSync.getState().create("todo", { title: "survives reload" });
  await settle();

  // Simulate a fresh tab: wipe memory, restore from disk.
  useSync.setState({ collections: { ...useSync.getState().collections, todo: {} } });
  await useSync.getState().bootstrap("user-a");

  const titles = Object.values(useSync.getState().collections.todo).map((t) => t.title);
  assert.ok(titles.includes("survives reload"), `restored: ${JSON.stringify(titles)}`);
  assert.ok(useSync.getState().pendingCount >= 1, "outbox should be restored");
});

test("reconnecting flushes the whole queue as ONE bulk request", async () => {
  goOnline();
  useSync.getState().reset();
  await useSync.getState().bootstrap("user-a");

  goOffline();
  for (let i = 0; i < 12; i++) useSync.getState().create("todo", { title: `offline ${i}` });
  await settle();
  assert.equal(useSync.getState().pendingCount, 12);

  goOnline();
  calls = [];
  await useSync.getState().flush();

  const pushes = calls.filter((c) => c.url.includes("/sync/push"));
  assert.equal(pushes.length, 1, `expected a single bulk push, got ${pushes.length}`);
  assert.equal((pushes[0].body as { ops: unknown[] }).ops.length, 12);
  assert.equal(useSync.getState().pendingCount, 0);
});

test("no push is attempted while offline", async () => {
  goOnline();
  useSync.getState().reset();
  await useSync.getState().bootstrap("user-a");

  goOffline();
  calls = [];
  useSync.getState().create("todo", { title: "quiet" });
  await settle(1200); // long enough for any stray debounce to have fired

  assert.equal(
    calls.filter((c) => c.url.includes("/sync/push")).length,
    0,
    "offline clients must not burn requests they know will fail",
  );
});

test("cached workspace loads without any network call", async () => {
  goOnline();
  useSync.getState().reset();
  await useSync.getState().bootstrap("user-a");
  useSync.getState().create("todo", { title: "cached item" });
  await settle();
  await useSync.getState().flush();
  await settle();

  // Cold start with no connectivity at all.
  goOffline();
  useSync.setState({ collections: { ...useSync.getState().collections, todo: {} } });
  calls = [];
  await useSync.getState().bootstrap("user-a");

  const titles = Object.values(useSync.getState().collections.todo).map((t) => t.title);
  assert.ok(titles.includes("cached item"), "workspace should come from disk");
  assert.equal(calls.length, 0, "cache-first boot must not require the network");
});

test("logout clears the cached workspace from disk", async () => {
  goOnline();
  useSync.getState().reset();
  await useSync.getState().bootstrap("user-b");
  useSync.getState().create("todo", { title: "private note" });
  await settle();

  assert.notEqual(await idbGet(KEYS.collections("user-b")), null);
  useSync.getState().reset();
  await settle(200);

  assert.equal(
    await idbGet(KEYS.collections("user-b")),
    null,
    "a shared device must not keep the previous user's data",
  );
});

test("a different user does not inherit the cached workspace", async () => {
  goOnline();
  useSync.getState().reset();
  await useSync.getState().bootstrap("user-a");
  useSync.getState().create("todo", { title: "user A secret" });
  await settle();

  // Second account signs in on the same device.
  await useSync.getState().bootstrap("user-c");
  const titles = Object.values(useSync.getState().collections.todo).map((t) => t.title);
  assert.ok(!titles.includes("user A secret"), `leaked: ${JSON.stringify(titles)}`);
});

test("captures made offline are queued and shown optimistically", async () => {
  goOnline();
  useCapture.getState().clear();
  await useCapture.getState().attach("user-a");

  goOffline();
  await useCapture.getState().capture("remember the milk");

  assert.equal(useCapture.getState().queued.length, 1);
  const stored = await idbGet<unknown[]>(KEYS.captureQueue("user-a"));
  assert.equal(stored?.length, 1, "queued capture must be on disk");
});

test("queued captures upload on reconnect", async () => {
  goOnline();
  useCapture.getState().clear();
  await useCapture.getState().attach("user-d");

  goOffline();
  await useCapture.getState().capture("one");
  await useCapture.getState().capture("two");
  assert.equal(useCapture.getState().queued.length, 2);

  goOnline();
  calls = [];
  await useCapture.getState().flush();

  const creates = calls.filter((c) => c.url.includes("/capture/") && c.method === "POST");
  assert.ok(creates.length >= 2, `expected both captures uploaded, saw ${creates.length}`);
  assert.equal(useCapture.getState().queued.length, 0);
});

test("a capture is never lost when the connection drops mid-request", async () => {
  goOnline();
  useCapture.getState().clear();
  await useCapture.getState().attach("user-e");

  // Online by our reckoning, but the request fails — the exact race that used
  // to surface as "Capture failed" and drop the thought.
  networkUp = false;
  await useCapture.getState().capture("thought mid-drop");

  assert.equal(useCapture.getState().queued.length, 1);
  assert.equal(useCapture.getState().queued[0].kind, "create");
});
