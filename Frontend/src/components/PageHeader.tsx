"use client";

import { TEXT } from "@/lib/theme";

export function PageHeader({
  title,
  subtitle,
  extra,
}: {
  title: string;
  subtitle?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        marginBottom: 22,
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1 className="hero-title">{title}</h1>
        {subtitle && (
          <p style={{ margin: "6px 0 0", fontSize: 13.5, color: TEXT.secondary }}>
            {subtitle}
          </p>
        )}
      </div>
      {extra}
    </div>
  );
}
