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

/**
 * One record, and re-renders only when *that* record changes.
 *
 * Selecting the whole entity map and indexing it (the previous shape) meant a
 * component watching a single task re-rendered on every mutation of any task —
 * the map's identity changes on each write. Selecting the record directly is
 * stable: an unchanged row keeps its reference through the immutable update, so
 * zustand's equality check skips the render. On a drawer open over a large
 * board this is the difference between the editor re-rendering on its own
 * keystrokes and re-rendering on everyone's.
 */
export function useRecord<K extends EntityName>(
  entity: K,
  id: string | null | undefined,
): SyncEntities[K] | undefined {
  return useSync((s) =>
    id ? (s.collections[entity][id] as unknown as SyncEntities[K] | undefined) : undefined,
  );
}
