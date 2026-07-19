"use client";

import { SURFACE } from "@/lib/theme";

/**
 * Shared loading skeletons.
 *
 * These exist so a tab switch is instant even on a bad connection. Next renders
 * a route's `loading.tsx` the moment you navigate, before the segment's code or
 * data has arrived — so the app changes tab immediately and fills in after,
 * instead of appearing frozen on the old screen while the network catches up.
 *
 * They deliberately mirror the real layout (same header height, same row
 * rhythm) so the content doesn't jump when it lands.
 */

/** One shimmering placeholder bar. */
export function Bar({
  w = "100%",
  h = 14,
  r = 8,
  style,
}: {
  w?: number | string;
  h?: number;
  r?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="skeleton"
      style={{ width: w, height: h, borderRadius: r, ...style }}
      aria-hidden
    />
  );
}

function Header() {
  return (
    <div style={{ marginBottom: 22 }}>
      <Bar w={180} h={26} />
      <Bar w={260} h={12} style={{ marginTop: 10 }} />
    </div>
  );
}

/** A card-shaped row, matching TaskCard's footprint. */
function Row({ tall }: { tall?: boolean }) {
  return (
    <div
      style={{
        border: `1px solid ${SURFACE.border}`,
        background: SURFACE.card,
        borderRadius: 16,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <Bar w="62%" h={15} />
      {tall && <Bar w="88%" h={11} />}
      <div style={{ display: "flex", gap: 8 }}>
        <Bar w={64} h={20} r={999} />
        <Bar w={52} h={20} r={999} />
      </div>
    </div>
  );
}

/** Generic list page (Today, Lists, Inbox). */
export function ListSkeleton({ rows = 5, header = true }: { rows?: number; header?: boolean }) {
  return (
    <div>
      {header && <Header />}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Array.from({ length: rows }, (_, i) => (
          <Row key={i} tall={i === 0} />
        ))}
      </div>
    </div>
  );
}

/** Card-grid page (Integrations). */
export function GridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div>
      <Header />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        {Array.from({ length: cards }, (_, i) => (
          <div
            key={i}
            style={{
              border: `1px solid ${SURFACE.border}`,
              background: SURFACE.card,
              borderRadius: 16,
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Bar w={44} h={44} r={12} />
              <div style={{ flex: 1 }}>
                <Bar w="55%" h={14} />
                <Bar w="80%" h={10} style={{ marginTop: 8 }} />
              </div>
            </div>
            <Bar h={32} r={10} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The calendar grid: sticky header strip plus hour rows. */
export function CalendarSkeleton() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderBottom: `1px solid ${SURFACE.borderSoft}`,
        }}
      >
        <Bar w={36} h={36} r={999} />
        <Bar w={150} h={18} />
        <Bar w={36} h={36} r={999} />
        <div style={{ flex: 1 }} />
        <Bar w={92} h={36} r={10} />
      </div>
      <div style={{ flex: 1, display: "flex", padding: "8px 0 0 0", gap: 1 }}>
        <div style={{ width: 44, display: "flex", flexDirection: "column", gap: 34, padding: "6px 8px" }}>
          {Array.from({ length: 8 }, (_, i) => (
            <Bar key={i} w={22} h={9} />
          ))}
        </div>
        {Array.from({ length: 3 }, (_, c) => (
          <div key={c} style={{ flex: 1, padding: "6px 6px", display: "flex", flexDirection: "column", gap: 12 }}>
            {Array.from({ length: 4 }, (_, i) => (
              <Bar key={i} h={i % 2 ? 40 : 62} r={8} style={{ marginTop: i === 0 ? 20 : 0 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Settings: stacked config cards. */
export function SettingsSkeleton() {
  return (
    <div>
      <Header />
      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <Bar key={i} w={80} h={16} />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            style={{
              border: `1px solid ${SURFACE.border}`,
              background: SURFACE.card,
              borderRadius: 16,
              padding: 18,
            }}
          >
            <Bar w="45%" h={15} />
            <Bar w="70%" h={11} style={{ marginTop: 10 }} />
            <Bar h={28} r={10} style={{ marginTop: 16 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
