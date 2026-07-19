"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Grid, Tabs, Typography } from "antd";
import {
  ApiOutlined,
  BulbOutlined,
  CalendarOutlined,
  LeftOutlined,
  LogoutOutlined,
  MailOutlined,
  RightOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/store/auth";
import { AITab } from "./AITab";
import { DigestTab } from "./DigestTab";
import { RhythmTab } from "./RhythmTab";
import { SchedulingTab } from "./SchedulingTab";

const { Text } = Typography;

function AccountTab() {
  const { user, logout } = useAuth();
  return (
    <Card size="small">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15 }}>{user?.first_name || "Your account"}</div>
          <Text type="secondary">{user?.email}</Text>
        </div>
        <Button danger icon={<LogoutOutlined />} onClick={() => void logout()}>
          Log out
        </Button>
      </div>
      <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 16 }}>
        Your task titles, notes, and event details are encrypted per-field on the
        server under a key derived from your account.
      </Text>
    </Card>
  );
}

interface Section {
  key: string;
  label: string;
  /** One line on the menu row saying what's inside, so you don't drill in to find out. */
  blurb: string;
  icon: React.ReactNode;
  render: () => React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    key: "rhythm",
    label: "How you work",
    blurb: "Session length, breaks, weekends",
    icon: <BulbOutlined />,
    render: () => <RhythmTab />,
  },
  {
    key: "scheduling",
    label: "Scheduling",
    blurb: "Time blocks and protected hours",
    icon: <CalendarOutlined />,
    render: () => <SchedulingTab />,
  },
  {
    key: "ai",
    label: "AI",
    blurb: "What the assistant may do for you",
    icon: <ApiOutlined />,
    render: () => <AITab />,
  },
  {
    key: "digests",
    label: "Digests",
    blurb: "Daily and weekly summary emails",
    icon: <MailOutlined />,
    render: () => <DigestTab />,
  },
  {
    key: "account",
    label: "Account",
    blurb: "Sign-in and encryption",
    icon: <UserOutlined />,
    render: () => <AccountTab />,
  },
];

/**
 * Settings, as a menu on a phone and as tabs on a wide screen.
 *
 * Five tab labels don't fit a phone: they collapse into a horizontally
 * scrolling strip where the last two are off-screen and nothing signals they
 * exist. A drill-down list shows every section at once with a line explaining
 * what's inside, so you can find a setting without opening each tab to look.
 *
 * It also means one section mounts at a time rather than all five — settings is
 * the heaviest route in the app, and the phone is where that costs most.
 */
function SettingsInner() {
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const router = useRouter();
  const params = useSearchParams();

  // The open section lives in the URL rather than in state, so the phone's back
  // gesture returns to the menu instead of leaving Settings altogether — the
  // thing every user tries first, and the one that makes a drill-down feel
  // broken when it doesn't work.
  const openKey = params.get("s");
  const setOpenKey = (key: string | null) =>
    router.push(key ? `/settings?s=${key}` : "/settings", { scroll: false });

  const open = SECTIONS.find((s) => s.key === openKey) ?? null;

  if (!isNarrow) {
    return (
      <div>
        <PageHeader title="Settings" subtitle="Tune Bearry to how your brain works" />
        <Tabs
          defaultActiveKey="rhythm"
          items={SECTIONS.map((s) => ({
            key: s.key,
            label: s.label,
            children: s.render(),
          }))}
        />
      </div>
    );
  }

  if (open) {
    return (
      <div>
        <button
          onClick={() => setOpenKey(null)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            color: "#a9a9b8",
            fontSize: 14,
            padding: "4px 0 10px",
            cursor: "pointer",
          }}
        >
          <LeftOutlined style={{ fontSize: 12 }} />
          Settings
        </button>
        <PageHeader title={open.label} subtitle={open.blurb} />
        {open.render()}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Tune Bearry to how your brain works" />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setOpenKey(s.key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              width: "100%",
              textAlign: "left",
              padding: "14px 16px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.025)",
              color: "inherit",
              cursor: "pointer",
              // Comfortably above the 44px tap-target floor.
              minHeight: 60,
            }}
          >
            <span style={{ fontSize: 17, color: "#e5893f", display: "flex" }}>{s.icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 15, lineHeight: 1.3 }}>{s.label}</span>
              <span style={{ display: "block", fontSize: 12.5, color: "#8a8a99", lineHeight: 1.4 }}>
                {s.blurb}
              </span>
            </span>
            <RightOutlined style={{ fontSize: 12, color: "#5c5c6b" }} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsInner />
    </Suspense>
  );
}
