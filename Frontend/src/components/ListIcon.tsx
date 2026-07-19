"use client";

/**
 * Draw a list's icon, whichever kind it is.
 *
 * One component so every surface — sidebar, settings page, drawer preview,
 * project picker — renders the same value the same way. The alternative was a
 * ternary repeated in four places, which is how the sidebar ends up showing an
 * emoji where the settings page shows a dot.
 */

import { parseIcon } from "@/lib/listIcon";
import { LUCIDE_MAP } from "@/lib/lucideMap";

export function ListIcon({
  icon,
  color,
  size = 16,
}: {
  icon: string | null | undefined;
  /** Used to tint a Lucide glyph, and as the fallback dot. */
  color: string;
  size?: number;
}) {
  const parsed = parseIcon(icon);

  if (parsed?.kind === "emoji") {
    // Line-height 1 so the glyph sits on the same baseline as a Lucide stroke;
    // emoji fonts otherwise carry their own leading and drift downward.
    return (
      <span style={{ fontSize: size, lineHeight: 1 }} aria-hidden>
        {parsed.char}
      </span>
    );
  }

  if (parsed?.kind === "lucide") {
    // Only the curated set is bundled (lib/lucideMap). A name outside it —
    // including a stale one from an older client — falls through to the dot
    // rather than rendering a blank square, which reads as a broken image.
    const Component = LUCIDE_MAP[parsed.name];
    if (Component) return <Component size={size} color={color} strokeWidth={2.2} />;
  }

  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: Math.round(size * 0.56),
        height: Math.round(size * 0.56),
        borderRadius: "50%",
        background: color,
      }}
    />
  );
}
