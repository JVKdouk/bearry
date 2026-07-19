"use client";

import { useEffect, useState } from "react";

/**
 * A clock that re-renders on the minute.
 *
 * The day screen decides what to hide and what to lead with by comparing
 * against "now", so a static `new Date()` at mount means a meeting that ends at
 * 15:30 sits there looking current until something else happens to re-render.
 *
 * Aligned to the next minute boundary rather than ticking every 60s from mount:
 * the thing being watched is the minute changing, and a timer started at
 * :47 would notice it 47 seconds late, every time.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    const align = setTimeout(
      () => {
        setNow(new Date());
        interval = setInterval(() => setNow(new Date()), 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      clearTimeout(align);
      clearInterval(interval);
    };
  }, []);

  return now;
}
