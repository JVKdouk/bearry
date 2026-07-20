"use client";

import { Switch, Typography } from "antd";
import { useCollection } from "@/store/hooks";
import { useSync } from "@/store/sync";
import { SURFACE, TEXT } from "@/lib/theme";

const { Text } = Typography;

/**
 * Cloud-AI consent. Stored as a normal synced `setting` row (`ai_consent`), so
 * it needs no bespoke endpoint and works offline like everything else.
 */
export function AITab() {
  const settings = useCollection("setting");
  const create = useSync((s) => s.create);
  const update = useSync((s) => s.update);

  const row = settings.find((s) => s.key === "ai_consent");
  const on = row?.value === "on";

  function toggle(v: boolean) {
    const value = v ? "on" : "off";
    if (row) update("setting", row.id, { value });
    else create("setting", { key: "ai_consent", value });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          border: `1px solid ${SURFACE.border}`,
          borderRadius: 16,
          padding: 18,
          background: SURFACE.card,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700 }}>AI assistance</div>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Better time estimates, task breakdowns, and warmer plan explanations.
            </Text>
          </div>
          <Switch checked={on} onChange={toggle} />
        </div>

        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: `1px solid ${SURFACE.borderSoft}`,
            fontSize: 12.5,
            color: TEXT.secondary,
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: TEXT.primary }}>What this means.</strong> Your task
          titles and notes are encrypted on the server. Turning this on decrypts
          them for the duration of a request and sends them to Google&apos;s Gemini
          API so it can estimate and summarise. Nothing is stored there by Kuma.
          <br />
          <br />
          With this <strong>off</strong>, Kuma still estimates durations, spots
          reminders, and explains why a plan failed — using local rules only, and
          without any text leaving the server. AI is an upgrade, never a
          requirement.
        </div>
      </div>
    </div>
  );
}
