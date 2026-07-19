// Lightweight shared store for provider integrations so both the sidebar entry
// point and the dedicated Integrations page read one live list.
//
// The list is cached locally too. Integrations can't *act* offline, but you
// should still be able to see which accounts are connected and when they last
// synced — an empty page would read as "everything got disconnected".

import { create } from "zustand";
import { api, isOfflineError } from "@/lib/api";
import { idbGet, idbSet } from "@/lib/offlineDb";
import { isOffline } from "./network";
import type { Integration } from "@/lib/types";

const CACHE_KEY = "integrations.v1";

interface IntegrationsState {
  list: Integration[];
  loading: boolean;
  loaded: boolean;
  /** True when the list came from cache and may be out of date. */
  stale: boolean;
  load: (force?: boolean) => Promise<void>;
  set: (list: Integration[]) => void;
}

export const useIntegrations = create<IntegrationsState>((set, get) => ({
  list: [],
  loading: false,
  loaded: false,
  stale: false,

  load: async (force) => {
    if (get().loading) return;
    if (get().loaded && !force) return;

    // Show cached providers immediately — including offline, where the request
    // below will fail and this is the only thing we can show.
    if (!get().loaded) {
      const cached = await idbGet<Integration[]>(CACHE_KEY);
      if (Array.isArray(cached) && cached.length) {
        set({ list: cached, loaded: true, stale: true });
      }
    }
    if (isOffline()) return;

    set({ loading: true });
    try {
      const { integrations } = await api.integrations();
      set({ list: integrations, loaded: true, stale: false });
      await idbSet(CACHE_KEY, integrations);
    } catch (err) {
      // Offline is expected and already handled by the cache above; anything
      // else leaves the prior list in place rather than blanking the page.
      if (!isOfflineError(err)) {
        /* keep prior list */
      }
    } finally {
      set({ loading: false });
    }
  },

  set: (list) => {
    set({ list, loaded: true, stale: false });
    void idbSet(CACHE_KEY, list);
  },
}));
