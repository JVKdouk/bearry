"use client";

/**
 * Draw a list's icon, whichever kind it is.
 *
 * One component so every surface — sidebar, settings page, drawer preview,
 * project picker — renders the same value the same way. The alternative was a
 * ternary repeated in four places, which is how the sidebar ends up showing an
 * emoji where the settings page shows a dot.
 */

import * as Lucide from "lucide-react";
import { parseIcon, lucideComponentName } from "@/lib/listIcon";

type LucideComponent = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

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
    const Component = (Lucide as unknown as Record<string, LucideComponent>)[
      lucideComponentName(parsed.name)
    ];
    // A name that no longer exists in Lucide falls through to the dot rather
    // than rendering a blank square, which reads as a broken image.
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
