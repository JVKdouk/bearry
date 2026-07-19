/**
 * Connectivity state.
 *
 * `navigator.onLine` alone is not trustworthy: it reports whether a network
 * interface exists, not whether our API is reachable, so captive portals, VPN
 * drops and a downed backend all read as "online". So this store combines two
 * signals — the browser event (fast, catches airplane mode instantly) and what
 * actually happened to our own requests (accurate, catches everything else).
 *
 * A request failing flips us offline immediately; a request succeeding flips us
 * back. The browser's `online` event doesn't assert we're back, it just prompts
 * a re-check, because "interface up" is not "server reachable".
 */

import { create } from "zustand";

export type Reachability = "online" | "offline";

interface NetworkState {
  /** Our considered view: is the backend actually reachable right now? */
  status: Reachability;
  /** What the browser thinks, exposed for messaging ("you appear to be offline"). */
  browserOnline: boolean;
  /** Timestamp of the last successful API round-trip. */
  lastOkAt: number | null;
  /** Called by the API layer on every request outcome. */
  reportSuccess: () => void;
  reportFailure: () => void;
  setBrowserOnline: (v: boolean) => void;
}

export const useNetwork = create<NetworkState>((set, get) => ({
  status: "online", // optimistic: assume reachable until a request says otherwise
  browserOnline: typeof navigator === "undefined" ? true : navigator.onLine,
  lastOkAt: null,

  reportSuccess: () => {
    if (get().status !== "online") set({ status: "online" });
    set({ lastOkAt: Date.now() });
  },

  reportFailure: () => {
    if (get().status !== "offline") set({ status: "offline" });
  },

  setBrowserOnline: (v) =>
    set(v ? { browserOnline: true } : { browserOnline: false, status: "offline" }),
}));

/** Convenience hook: `const offline = useIsOffline()`. */
export function useIsOffline(): boolean {
  return useNetwork((s) => s.status === "offline");
}

/** Read connectivity outside React (API layer, stores). */
export function isOffline(): boolean {
  return useNetwork.getState().status === "offline";
}

/**
 * Wire browser connectivity events. Called once from the app shell.
 * Returns a teardown function.
 */
export function watchConnectivity(onReconnect: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const goOnline = () => {
    useNetwork.getState().setBrowserOnline(true);
    // Don't declare victory here — prove it by doing real work. The flush/pull
    // that follows will report the true outcome.
    onReconnect();
  };
  const goOffline = () => useNetwork.getState().setBrowserOnline(false);

  window.addEventListener("online", goOnline);
  window.addEventListener("offline", goOffline);
  return () => {
    window.removeEventListener("online", goOnline);
    window.removeEventListener("offline", goOffline);
  };
}
