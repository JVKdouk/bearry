"use client";

import { useEffect } from "react";

// Registers the app-shell service worker and auto-updates it on new deploys.
// Each deployment ships a new sw.js (build-id stamped), so the browser installs
// the new worker; skipWaiting + clients.claim make it take control immediately,
// which fires `controllerchange` and we reload once to pick up fresh assets.
export function ServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return; // avoid dev caching noise

    // Only auto-reload when an EXISTING controller is replaced (i.e. an update),
    // never on the very first install of the worker.
    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing || !hadController) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let updateTimer: ReturnType<typeof setInterval> | undefined;
    let focusCheck: (() => void) | undefined;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          // Check for a new deploy now, on focus, and hourly.
          const check = () => reg.update().catch(() => {});
          focusCheck = check;
          check();
          window.addEventListener("focus", check);
          updateTimer = setInterval(check, 60 * 60 * 1000);
          // If a new worker installs while a controller exists, activate it now.
          reg.addEventListener("updatefound", () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener("statechange", () => {
              if (nw.state === "installed" && navigator.serviceWorker.controller) {
                nw.postMessage("SKIP_WAITING");
              }
            });
          });
        })
        .catch(() => {});
    };

    // Waiting on `load` unconditionally is a trap: React often hydrates AFTER the
    // load event has already fired, and a listener added then never runs — so the
    // service worker would silently never register and the PWA would never
    // update. Register immediately if the page is already done loading.
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);

    return () => {
      window.removeEventListener("load", onLoad);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      // Added inside the async register(); it was previously never removed, so
      // each remount left another live update-check bound to focus.
      if (focusCheck) window.removeEventListener("focus", focusCheck);
      if (updateTimer) clearInterval(updateTimer);
    };
  }, []);

  return null;
}
