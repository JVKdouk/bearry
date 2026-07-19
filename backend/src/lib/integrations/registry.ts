/**
 * The integration registry. Every plugin's manifest is validated against
 * ManifestSchema at registration — a malformed plugin fails fast at boot rather
 * than at runtime. This is the gate a third-party plugin would pass through.
 */

import { ManifestSchema, manifestOf, type IntegrationProvider } from "./types";

const registry = new Map<string, IntegrationProvider>();

export function register(provider: IntegrationProvider): void {
  const result = ManifestSchema.safeParse(manifestOf(provider));
  if (!result.success) {
    throw new Error(
      `Invalid integration manifest for "${provider.id ?? "?"}": ${result.error.issues
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join(", ")}`,
    );
  }
  // A plugin that claims to pull must actually implement pull().
  if (provider.available && provider.capabilities.pull.length > 0 && !provider.pull) {
    throw new Error(`Plugin "${provider.id}" declares pull capabilities but has no pull()`);
  }
  if (registry.has(provider.id)) {
    throw new Error(`Integration provider "${provider.id}" is already registered`);
  }
  registry.set(provider.id, provider);
}

export function getProvider(id: string): IntegrationProvider | undefined {
  return registry.get(id);
}

export function listProviders(): IntegrationProvider[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
}
