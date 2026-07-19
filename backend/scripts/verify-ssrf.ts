/* Verify the SSRF guard blocks dangerous fetch targets.
   Run: yarn tsx scripts/verify-ssrf.ts  (forces ALLOW_PRIVATE off) */
process.env.INTEGRATIONS_ALLOW_PRIVATE = "false";
import assert from "node:assert";
import { safeFetchText, SsrfBlockedError } from "../src/lib/integrations/safeFetch";

async function blocked(url: string, why: string) {
  await assert.rejects(() => safeFetchText(url), (e: unknown) => e instanceof SsrfBlockedError, `should block: ${why} (${url})`);
}

async function main() {
  await blocked("file:///etc/passwd", "non-http scheme");
  await blocked("ftp://example.com/x", "non-http scheme");
  await blocked("http://user:pass@example.com/", "embedded credentials");
  await blocked("http://169.254.169.254/latest/meta-data/", "cloud metadata IP");
  await blocked("http://metadata.google.internal/x", "GCP metadata host");
  await blocked("http://127.0.0.1:20001/users/me", "loopback");
  await blocked("http://localhost:20055/feed.ics", "localhost");
  await blocked("http://10.0.0.5/x", "private 10/8");
  await blocked("http://192.168.1.1/x", "private 192.168/16");
  await blocked("http://172.16.0.1/x", "private 172.16/12");
  await blocked("http://[::1]/x", "IPv6 loopback");
  await blocked("not a url", "malformed");

  console.log("✓ ssrf: all 12 dangerous targets blocked");
}

main().catch((e) => { console.error("✗ ssrf verification failed:", e); process.exit(1); });
