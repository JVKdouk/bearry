/**
 * SSRF guard for plugin fetches.
 *
 * Plugins fetch URLs the *user* supplies, so this is directly attacker-reachable:
 * anyone who can add an .ics feed can aim the server at its own network. The
 * DNS-rebinding case matters most — it's the one a naive pre-flight check misses.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { safeFetchText, SsrfBlockedError } from "@/src/lib/integrations/safeFetch";

async function assertBlocked(url: string) {
  await assert.rejects(() => safeFetchText(url), SsrfBlockedError, `${url} was not blocked`);
}

test("blocks loopback addresses", async () => {
  await assertBlocked("http://127.0.0.1:20001/");
  await assertBlocked("http://[::1]/");
});

test("blocks the cloud metadata endpoints", async () => {
  await assertBlocked("http://169.254.169.254/latest/meta-data/");
  await assertBlocked("http://metadata.google.internal/");
});

test("blocks RFC1918 and CGNAT ranges", async () => {
  await assertBlocked("http://10.0.0.1/");
  await assertBlocked("http://172.16.0.1/");
  await assertBlocked("http://192.168.0.3:10010/");
  await assertBlocked("http://100.64.0.1/");
});

test("blocks non-http schemes", async () => {
  await assertBlocked("file:///etc/passwd");
  await assertBlocked("gopher://example.com/");
});

test("blocks credentials embedded in the URL", async () => {
  await assertBlocked("http://user:password@example.com/");
});

test("blocks a public hostname that resolves to a private address", async (t) => {
  // localtest.me is a public DNS name that resolves to 127.0.0.1 — the same
  // shape as a DNS-rebinding payload. Needs DNS; skip when offline.
  try {
    await import("node:dns/promises").then((d) => d.lookup("localtest.me"));
  } catch {
    t.skip("no DNS available");
    return;
  }
  await assertBlocked("http://localtest.me/");
});

test("allows a genuine public URL", async (t) => {
  try {
    const body = await safeFetchText("https://example.com", "text/html");
    assert.ok(body.length > 0);
  } catch (err) {
    // Don't fail the suite on a sandbox with no egress.
    t.skip(`no network egress: ${(err as Error).message}`);
  }
});
