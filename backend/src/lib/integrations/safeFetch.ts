/**
 * SSRF-hardened fetch for plugins.
 *
 * Plugins fetch URLs the user controls (e.g. an .ics feed URL). Without a guard,
 * a user could point a plugin at internal services, the cloud metadata endpoint
 * (169.254.169.254), or localhost — a classic server-side request forgery. This
 * wrapper blocks that: https/http only, no credentials in the URL, the resolved
 * IP must be public (loopback/private/link-local/metadata are refused), no
 * redirects (a redirect could bounce to an internal host), a hard timeout, and a
 * response-size cap so a huge body can't exhaust memory.
 *
 * In development, private/loopback targets are allowed ONLY when
 * INTEGRATIONS_ALLOW_PRIVATE=true (so local test feeds work); production must
 * never set it. The metadata endpoint is blocked even then.
 */

import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";

const TIMEOUT_MS = Number(process.env.PLUGIN_FETCH_TIMEOUT_MS ?? 10_000);
const MAX_BYTES = Number(process.env.PLUGIN_FETCH_MAX_BYTES ?? 5_000_000); // 5 MB
const ALLOW_PRIVATE = process.env.INTEGRATIONS_ALLOW_PRIVATE === "true";

export class SsrfBlockedError extends Error {}

/** Metadata endpoints are refused in every environment. */
const METADATA_HOSTS = new Set(["169.254.169.254", "metadata.google.internal", "100.100.100.100"]);

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true; // loopback
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true; // link-local / ULA
  if (lower.startsWith("::ffff:")) return isPrivateIp(lower.replace("::ffff:", "")); // v4-mapped
  return false;
}

async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError("Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SsrfBlockedError("Only http(s) URLs are allowed");
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError("URLs with embedded credentials are not allowed");
  }
  if (METADATA_HOSTS.has(url.hostname.toLowerCase())) {
    throw new SsrfBlockedError("Blocked host");
  }

  // Resolve the host and check every returned address is public.
  const host = url.hostname;
  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    const records = await dns.lookup(host, { all: true }).catch(() => []);
    addresses = records.map((r) => r.address);
    if (addresses.length === 0) throw new SsrfBlockedError("Host does not resolve");
  }
  for (const ip of addresses) assertPublicAddress(ip);
  return url;
}

/** Throws unless `ip` is a public address we're willing to talk to. */
function assertPublicAddress(ip: string): void {
  if (METADATA_HOSTS.has(ip)) throw new SsrfBlockedError("Blocked address");
  if (isPrivateIp(ip) && !ALLOW_PRIVATE) {
    throw new SsrfBlockedError("Refusing to fetch a private/internal address");
  }
}

/**
 * Validating the URL and then calling `fetch(raw)` leaves a DNS-rebinding hole:
 * the pre-flight check resolves the name once, and the HTTP client resolves it
 * again independently. An attacker who controls the authoritative DNS can answer
 * with a public IP for our check and 127.0.0.1 for the connection a millisecond
 * later, and the guard never sees it — a classic time-of-check/time-of-use SSRF
 * bypass.
 *
 * Closing it means validating the address that is actually being connected to.
 * This dispatcher hooks the socket-level lookup, so every address the client
 * tries — including each candidate in a multi-record or Happy-Eyeballs
 * connection — is re-checked at the moment of use. There is no window left
 * between the check and the connect.
 */
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

/**
 * Deliberately built on node:http(s) rather than a fetch dispatcher. The
 * dispatcher route requires the standalone `undici` package, whose internals
 * track the Node version it ships with — pinning it to the deploy's Node is a
 * portability trap we hit for real (a build fine on Node 24 crashed on boot
 * under Node 20). The `lookup` option here is stable public Node API and behaves
 * identically on every supported version.
 */
function guardedLookup(
  hostname: string,
  options: { all?: boolean },
  callback: LookupCallback,
): void {
  dns.lookup(hostname, { all: true, verbatim: true }).then(
    (records) => {
      try {
        for (const r of records) assertPublicAddress(r.address);
      } catch (err) {
        callback(err as NodeJS.ErrnoException, "", 0);
        return;
      }
      if (options.all) callback(null, records);
      else callback(null, records[0].address, records[0].family);
    },
    (err: NodeJS.ErrnoException) => callback(err, "", 0),
  );
}

// Node's LookupFunction type models `family` as number | "IPv4" | "IPv6"; the
// guard only ever reads `all`, so the narrower signature is safe here.
const lookup = guardedLookup as unknown as https.AgentOptions["lookup"];
const httpsAgent = new https.Agent({ lookup, keepAlive: false });
const httpAgent = new http.Agent({ lookup, keepAlive: false });

/** Fetch text safely. Returns the body (capped) or throws SsrfBlockedError. */
export async function safeFetchText(
  raw: string,
  accept = "text/calendar",
  extraHeaders?: Record<string, string>,
): Promise<string> {
  const url = await assertSafeUrl(raw);
  const isHttps = url.protocol === "https:";

  return new Promise<string>((resolve, reject) => {
    const req = (isHttps ? https : http).request(
      url,
      {
        method: "GET",
        agent: isHttps ? httpsAgent : httpAgent,
        headers: { Accept: accept, "User-Agent": "BearAI-Integrations/1.0", ...extraHeaders },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // Never follow redirects — a 30x could bounce us to an internal host,
        // and the new target would not go through assertSafeUrl.
        if (status >= 300 && status < 400) {
          res.destroy();
          reject(new SsrfBlockedError("Feed attempted a redirect"));
          return;
        }
        if (status < 200 || status >= 300) {
          res.destroy();
          reject(new SsrfBlockedError(`Feed responded ${status}`));
          return;
        }

        const declared = Number(res.headers["content-length"] ?? "0");
        if (declared && declared > MAX_BYTES) {
          res.destroy();
          reject(new SsrfBlockedError("Response too large"));
          return;
        }

        // Enforce the cap while streaming, in case content-length lied or was
        // absent — otherwise a hostile feed could exhaust memory.
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_BYTES) {
            res.destroy();
            reject(new SsrfBlockedError("Response exceeded size limit"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", (err) => reject(new SsrfBlockedError(err.message)));
      },
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new SsrfBlockedError("Fetch timed out"));
    });
    req.on("error", (err) => {
      reject(err instanceof SsrfBlockedError ? err : new SsrfBlockedError(err.message));
    });
    req.end();
  });
}

/**
 * Fetch + parse JSON from an authenticated API (Bearer token), reusing the same
 * SSRF guard, timeout and size cap. Used by API-based importers (e.g. TickTick);
 * the token is sent as `Authorization: Bearer …`, never embedded in the URL.
 */
export async function safeFetchJson<T = unknown>(raw: string, bearer?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const body = await safeFetchText(raw, "application/json", headers);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new SsrfBlockedError("Response was not valid JSON");
  }
}
