"use client";

/**
 * Pull down at the top of a scroll area to sync.
 *
 * Wraps its children in the scroller rather than sitting beside one, so the
 * gesture and the scroll position are read from the same element — asking a
 * sibling how far it's scrolled is how these end up firing halfway down a list.
 *
 * The arbitration lives in lib/pullRefresh with its own tests: the failure mode
 * here isn't a crash, it's a refresh that fires while someone is scrolling back
 * up, which trains people to scroll cautiously.
 */

import { useRef, useState } from "react";
import { LoadingOutlined, ArrowDownOutlined } from "@ant-design/icons";
import {
  DEFAULT_PULL,
  canPull,
  isPullVisible,
  pullDistance,
  pullProgress,
  shouldRefresh,
} from "@/lib/pullRefresh";

interface Props {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  /** Off on pointer devices, where a scrollbar and a button already exist. */
  enabled?: boolean;
  style?: React.CSSProperties;
}

export function PullToRefresh({ onRefresh, children, enabled = true, style }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number; armed: boolean } | null>(null);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  function onTouchStart(e: React.TouchEvent) {
    if (!enabled || refreshing || e.touches.length !== 1) return;
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY, armed: false };
  }

  function onTouchMove(e: React.TouchEvent) {
    const s = startRef.current;
    if (!s || refreshing) return;
    const t = e.touches[0];
    const dy = t.clientY - s.y;
    const dx = t.clientX - s.x;

    if (!s.armed) {
      // Re-read the scroll position on every move until armed: the gesture may
      // have begun mid-list and only reached the top part-way through.
      if (!canPull(scrollRef.current?.scrollTop ?? 0, dy, dx)) return;
      s.armed = true;
    }
    setDistance(pullDistance(dy));
  }

  async function onTouchEnd() {
    const s = startRef.current;
    startRef.current = null;
    if (!s?.armed || refreshing) {
      setDistance(0);
      return;
    }

    if (!shouldRefresh(distance)) {
      setDistance(0);
      return;
    }

    // Hold the indicator at the trigger point while the work runs, so a fast
    // sync still reads as "it did something" rather than a flicker.
    setRefreshing(true);
    setDistance(DEFAULT_PULL.triggerAt);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      setDistance(0);
    }
  }

  const progress = pullProgress(distance);
  const visible = refreshing || isPullVisible(distance);

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, ...style }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: distance,
          display: "grid",
          placeItems: "center",
          pointerEvents: "none",
          opacity: visible ? 1 : 0,
          transition: startRef.current ? "none" : "height 0.2s ease, opacity 0.2s ease",
          zIndex: 2,
        }}
        aria-hidden={!visible}
      >
        <span style={{ color: progress >= 1 || refreshing ? "#e5893f" : "#6f6f80", fontSize: 16 }}>
          {refreshing ? (
            <LoadingOutlined spin />
          ) : (
            <ArrowDownOutlined
              style={{
                // Flips over once you've pulled far enough, which is the whole
                // signal that letting go will actually do something.
                transform: `rotate(${progress >= 1 ? 180 : 0}deg)`,
                transition: "transform 0.15s ease",
              }}
            />
          )}
        </span>
      </div>

      <div
        ref={scrollRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          height: "100%",
          overflowY: "auto",
          transform: `translateY(${distance}px)`,
          transition: startRef.current ? "none" : "transform 0.2s ease",
        }}
      >
        {children}
      </div>
    </div>
  );
}
