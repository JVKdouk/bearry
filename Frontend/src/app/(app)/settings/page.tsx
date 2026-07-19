"use client";

import { Button, Card, Tabs, Typography } from "antd";
import { LogoutOutlined } from "@ant-design/icons";
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

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" subtitle="Tune Bearry to how your brain works" />
      <Tabs
        defaultActiveKey="rhythm"
        items={[
          { key: "rhythm", label: "How you work", children: <RhythmTab /> },
          { key: "scheduling", label: "Scheduling", children: <SchedulingTab /> },
          { key: "ai", label: "AI", children: <AITab /> },
          { key: "digests", label: "Digests", children: <DigestTab /> },
          { key: "account", label: "Account", children: <AccountTab /> },
        ]}
      />
    </div>
  );
}
