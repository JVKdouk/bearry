/**
 * Which tasks are selected for a bulk edit, and whether we're in that mode.
 *
 * A tiny store of its own rather than a slice of the UI store: selection is
 * short-lived and page-scoped, and keeping it separate means a component that
 * cares about the drawer doesn't re-render when a selection toggles, and vice
 * versa.
 *
 * "Selection mode" is tracked explicitly rather than inferred from `size > 0`,
 * because the two come apart: entering mode with a long-press selects one item
 * (size 1), but deselecting that last item should keep you in mode with an
 * empty bar, not silently drop you out mid-task.
 */

import { create } from "zustand";

interface SelectionState {
  active: boolean;
  ids: Set<string>;

  /** Enter selection mode, seeding it with one id (the long-pressed card). */
  begin: (id: string) => void;
  /** Toggle a card while in selection mode. */
  toggle: (id: string) => void;
  /** Select every id in `ids` (e.g. "select all" over the current view). */
  selectAll: (ids: string[]) => void;
  /** Leave selection mode and clear everything. */
  clear: () => void;
  /** Remove ids that no longer exist (e.g. after a bulk delete). */
  prune: (existing: Set<string>) => void;
}

export const useSelection = create<SelectionState>((set) => ({
  active: false,
  ids: new Set(),

  begin: (id) => set({ active: true, ids: new Set([id]) }),

  toggle: (id) =>
    set((s) => {
      const ids = new Set(s.ids);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { ids, active: true };
    }),

  selectAll: (all) => set({ active: true, ids: new Set(all) }),

  clear: () => set({ active: false, ids: new Set() }),

  prune: (existing) =>
    set((s) => {
      const ids = new Set([...s.ids].filter((id) => existing.has(id)));
      // Deleting the last selected item leaves the bar empty but still in mode
      // is wrong here — a bulk delete that empties the selection has finished,
      // so drop out of mode.
      return ids.size === s.ids.size ? {} : { ids, active: ids.size > 0 };
    }),
}));
