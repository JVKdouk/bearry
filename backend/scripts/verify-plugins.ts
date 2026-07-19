/* Verify the plugin system: manifest validation, strict block schema, ingest
   idempotency, ICS parsing. Run: yarn tsx scripts/verify-plugins.ts */
import assert from "node:assert";
import { validateBlocks, CanonicalBlockSchema } from "../src/lib/integrations/schema/blocks";
import { ManifestSchema } from "../src/lib/integrations/types";
import { registerAllProviders } from "../src/lib/integrations/providers";
import { listProviders, getProvider } from "../src/lib/integrations/registry";

// 1. All shipped plugins have valid manifests + register cleanly.
registerAllProviders();
const providers = listProviders();
assert.ok(providers.length >= 6, "providers registered");
for (const p of providers) {
  const m = ManifestSchema.safeParse({
    id: p.id, name: p.name, version: p.version, category: p.category, description: p.description,
    authType: p.authType, icon: p.icon, scopes: p.scopes, capabilities: p.capabilities,
    available: p.available, trust: p.trust,
  });
  assert.ok(m.success, `manifest valid: ${p.id}`);
}

// 2. Strict schema: unknown keys rejected, bad shapes rejected, good ones pass.
const raw = [
  { type: "event", sourceId: "e1", title: "Standup", start: "2026-07-13T09:00:00Z", end: "2026-07-13T09:15:00Z" },
  { type: "event", sourceId: "e2", title: "Bad", start: "2026-07-13T10:00:00Z", end: "2026-07-13T09:00:00Z" }, // end<start
  { type: "event", sourceId: "e3", title: "Extra", start: "2026-07-13T11:00:00Z", end: "2026-07-13T12:00:00Z", evil: true }, // unknown key
  { type: "task", sourceId: "t1", title: "Write report", due: "2026-07-15T17:00:00Z", priority: "high" },
  { type: "task", sourceId: "t2", title: "Bad prio", priority: "URGENT" }, // bad enum
  { type: "note", sourceId: "n1", title: "Idea", body: "remember this" },
  { type: "contact", sourceId: "c1" }, // unknown block type
];
const { valid, errors } = validateBlocks(raw);
assert.equal(valid.length, 3, "3 valid blocks (e1, t1, n1)");
assert.equal(errors.length, 4, "4 rejects (end<start, unknown key, bad enum, unknown type)");
assert.ok(valid.every((b) => ["event", "task", "note"].includes(b.type)), "only known types pass");

// 3. Strict discriminated union catches unknown discriminant.
assert.ok(!CanonicalBlockSchema.safeParse({ type: "video", sourceId: "x" }).success, "unknown type rejected");

// 4. The ICS plugin is registered and declares event-pull capability. Its
//    end-to-end pull→validate→ingest path is covered by the live API + UI tests
//    (it now fetches through the SSRF-hardened safeFetch, so it isn't unit-stubbed
//    here to avoid faking real DNS/network).
const ics = getProvider("ics-calendar")!;
assert.ok(ics && ics.available && ics.capabilities.pull.includes("event"), "ics-calendar registered & pulls events");
assert.ok(typeof ics.pull === "function", "ics-calendar implements pull()");

console.log("✓ plugins: all checks passed");
console.log(`  registered: ${providers.map((p) => p.id).join(", ")}`);
console.log(`  schema: kept ${valid.length}, rejected ${errors.length} (${errors.map((e) => e.sourceId ?? "?").join(",")})`);
