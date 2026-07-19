import { useMemo } from "react";
import { useSync } from "./sync";
import type { EntityName, SyncEntities } from "@/lib/types";

// Returns a stable array of records for an entity. Selects the keyed map (stable
// identity across unrelated updates) and derives the array with useMemo so
// consumers don't re-render on every store change.
export function useCollection<K extends EntityName>(
  entity: K,
): SyncEntities[K][] {
  const map = useSync((s) => s.collections[entity]);
  return useMemo(
    () => Object.values(map) as unknown as SyncEntities[K][],
    [map],
  );
}

export function useRecord<K extends EntityName>(
  entity: K,
  id: string | null | undefined,
): SyncEntities[K] | undefined {
  const map = useSync((s) => s.collections[entity]);
  return id ? (map[id] as unknown as SyncEntities[K] | undefined) : undefined;
}
