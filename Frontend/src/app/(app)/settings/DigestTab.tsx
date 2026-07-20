"use client";

import { useCallback, useEffect, useState } from "react";
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Space,
  Spin,
  Switch,
  Typography,
} from "antd";
import { MailOutlined } from "@ant-design/icons";
import { api, isOfflineError, errText } from "@/lib/api";
import type { DigestStatus } from "@/lib/types";

const { Text } = Typography;

function Row({
  title,
  desc,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "10px 0" }}>
      <div>
        <div style={{ fontSize: 14 }}>{title}</div>
        <Text type="secondary" style={{ fontSize: 12 }}>{desc}</Text>
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

export function DigestTab() {
  const { message } = AntdApp.useApp();
  const [status, setStatus] = useState<DigestStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<{ ok: boolean; error?: string } | null>(null);

  async function checkConnection() {
    setChecking(true);
    setChecked(null);
    try {
      const fresh = await api.digestStatus(true);
      setChecked(fresh.verified ?? { ok: false, error: "The server didn't report a result" });
    } catch (e) {
      setChecked({ ok: false, error: errText(e, "Couldn't reach the server") });
    } finally {
      setChecking(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await api.digestStatus());
    } catch (err) {
      // Offline is expected, not an error worth shouting about — the render
      // below explains it. Anything else is a genuine failure.
      if (!isOfflineError(err)) message.error("Couldn't load digest settings");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: { daily?: boolean; weekly?: boolean; aiConsent?: boolean }) {
    setStatus((s) => (s ? { ...s, ...body } : s));
    try {
      await api.digestSettings(body);
    } catch (e) {
      message.error(errText(e, "Couldn't save"));
      await load();
    }
  }

  async function sendTest() {
    setSending(true);
    try {
      await api.digestSend();
      message.success("Digest sent to your email");
    } catch (e) {
      message.error(errText(e, "Send failed — check the mailer is configured"));
    } finally {
      setSending(false);
    }
  }

  // Digests are composed and emailed server-side, so this tab has nothing to
  // show or change offline. Previously the failed load left it spinning forever.
  if (!loading && !status) {
    return (
      <Alert
        type="info"
        showIcon
        message="Digest settings need a connection"
        description="Your daily and weekly digests are prepared and emailed by the server. Reconnect to view or change them — nothing else in Kuma is affected."
      />
    );
  }

  if (loading || !status) {
    return (
      <div style={{ display: "grid", placeItems: "center", padding: 40 }}>
        <Spin />
      </div>
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {!status.serverEmail && (
        <Alert type="info" showIcon message="Email isn't configured on this server, so digests can't be delivered yet." />
      )}
      <Card size="small">
        <Row
          title="Daily digest"
          desc="A gentle morning summary of what's on your plate"
          checked={status.daily}
          onChange={(v) => patch({ daily: v })}
        />
        <Row
          title="Weekly digest"
          desc="A Sunday look at the week ahead"
          checked={status.weekly}
          onChange={(v) => patch({ weekly: v })}
        />
        <Row
          title="AI-written digests"
          desc="Use Gemini to phrase your digest warmly"
          checked={status.aiConsent}
          disabled={!status.serverGemini}
          onChange={(v) => patch({ aiConsent: v })}
        />
      </Card>
      <Space wrap>
        <Button icon={<MailOutlined />} loading={sending} onClick={sendTest} disabled={!status.serverEmail}>
          Send a test digest now
        </Button>
        {/* Configuration being present isn't the same as it working: a Gmail
            account password where an App Password is required looks correctly
            set up and fails only at send time. This checks rather than assumes. */}
        <Button loading={checking} onClick={checkConnection} disabled={!status.serverEmail}>
          Check connection
        </Button>
      </Space>
      {checked && (
        <Alert
          type={checked.ok ? "success" : "error"}
          showIcon
          message={
            checked.ok
              ? "The mail server accepted our credentials."
              : `The mail server rejected the connection: ${checked.error ?? "unknown error"}`
          }
        />
      )}
    </Space>
  );
}
