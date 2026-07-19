"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, ApiError, isOfflineError } from "@/lib/api";
import { idbGet, idbSet, idbDel, KEYS } from "@/lib/offlineDb";
import type { Me } from "@/lib/types";
import { useSync } from "./sync";

interface AuthCtx {
  user: Me | null;
  loading: boolean;
  /** True when we're running on a remembered identity we couldn't re-verify. */
  offlineSession: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (
    email: string,
    password: string,
    first_name?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineSession, setOfflineSession] = useState(false);
  const bootstrap = useSync((s) => s.bootstrap);
  const reset = useSync((s) => s.reset);

  /**
   * Establish who is signed in, network permitting.
   *
   * The distinction that matters: a 401 is the server *telling us* the session
   * is gone, while a transport failure tells us nothing about the session at
   * all. Treating the latter as logged-out is what made the app unusable
   * offline — it bounced straight to /login, where signing in also needs the
   * network. So we remember the identity locally and fall back to it whenever
   * the server simply can't be reached, and only clear it on an actual 401.
   */
  const hydrate = useCallback(async () => {
    const cached = await idbGet<Me>(KEYS.session);
    try {
      const me = await api.me();
      setUser(me);
      setOfflineSession(false);
      await idbSet(KEYS.session, me);
      await bootstrap(me.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Definitive: the session really is over.
        await idbDel(KEYS.session);
        setUser(null);
        reset();
      } else if (cached) {
        // Couldn't reach the server. Carry on as the remembered user against
        // the local workspace; the cookie is still in the jar for reconnect.
        setUser(cached);
        setOfflineSession(true);
        await bootstrap(cached.id);
      }
    } finally {
      setLoading(false);
    }
  }, [bootstrap, reset]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Once the connection returns, re-verify the session we've been trusting.
  useEffect(() => {
    if (!offlineSession) return;
    let cancelled = false;
    const recheck = async () => {
      try {
        const me = await api.me();
        if (cancelled) return;
        setUser(me);
        setOfflineSession(false);
        await idbSet(KEYS.session, me);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401 && !cancelled) {
          await idbDel(KEYS.session);
          setUser(null);
          reset();
        }
      }
    };
    window.addEventListener("online", recheck);
    return () => {
      cancelled = true;
      window.removeEventListener("online", recheck);
    };
  }, [offlineSession, reset]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api.login({ email, password });
      const me = await api.me();
      setUser(me);
      setOfflineSession(false);
      await idbSet(KEYS.session, me);
      await bootstrap(me.id);
    },
    [bootstrap],
  );

  const signup = useCallback(
    async (email: string, password: string, first_name?: string) => {
      await api.signup({ email, password, first_name });
      const me = await api.me();
      setUser(me);
      setOfflineSession(false);
      await idbSet(KEYS.session, me);
      await bootstrap(me.id);
    },
    [bootstrap],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (err) {
      // Offline logout still clears this device; the server session lapses on
      // its own. Anything queued is dropped with it — that's the user's call.
      if (!isOfflineError(err)) {
        /* a real error, but logging out locally is still the right outcome */
      }
    }
    await idbDel(KEYS.session);
    reset();
    setUser(null);
    setOfflineSession(false);
  }, [reset]);

  const value = useMemo(
    () => ({ user, loading, offlineSession, login, signup, logout }),
    [user, loading, offlineSession, login, signup, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
