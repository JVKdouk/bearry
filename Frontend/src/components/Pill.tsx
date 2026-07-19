"use client";

// Small rounded tag used across cards, headers and the task detail panel.
// `tone` picks how the color is applied so pills stay legible on both the
// dark card surface and the accent-filled featured card.
export function Pill({
  children,
  color = "#a9a9b8",
  tone = "soft",
  style,
}: {
  children: React.ReactNode;
  color?: string;
  tone?: "soft" | "solid" | "onAccent";
  style?: React.CSSProperties;
}) {
  const tones: Record<string, React.CSSProperties> = {
    soft: { background: color + "1f", color },
    solid: { background: color, color: "#fff" },
    onAccent: { background: "rgba(255,255,255,0.18)", color: "#fff" },
  };
  return (
    <span className="pill" style={{ ...tones[tone], ...style }}>
      {children}
    </span>
  );
}
