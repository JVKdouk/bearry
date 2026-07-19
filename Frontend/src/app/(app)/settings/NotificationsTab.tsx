"use client";

/**
 * Notification settings.
 *
 * Push can fail in four independent places — the server has no VAPID keys, the
 * browser doesn't support it, the user denied permission, or no device is
 * registered — and from the outside they all look the same: nothing arrives.
 * This page's job is to say *which*, because "notifications don't work" is
 * unactionable and each of those has a different fix.
 *
 * A denied permission is called out especially: it can't be re-requested from
 * the page once refused, so the only honest thing is to say so and point at
 * browser settings rather than showing a button that does nothing.
 */

import { useCallback, useEffect, useState } from "react";
import { App as AntdApp, Alert, Button, Card, Space, Switch, Typography } from "antd";
import { BellOutlined } from "@ant-design/icons";
import { api, errText } from "@/lib/api";
import {
  permissionState,
  requestPermission,
  subscribeDevice,
  unsubscribeDevice,
  type PermissionState,
} from "@/lib/notifications";

const { Text } = Typography;

interface Config {
  enabled: boolean;
  publicKey: string | null;
  devices: number;
}

export function NotificationsTab() {
  const { message } = AntdApp.useApp();
  const [config, setConfig] = useState<Config | null>(null);
  const [permission, setPermission] = useState<PermissionState>("default");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setPermission(permissionState());
    try {
      setConfig(await api.pushConfig());
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const supported = permission !== "unsupported";
  const serverReady = !!config?.enabled;
  const active = permission === "granted" && (config?.devices ?? 0) > 0;

  /**
   * Turning it on is three steps that can each fail: ask the browser, subscribe
   * to the push service, register with us. Doing them in one action means the
   * user makes one decision — but each failure has to report itself honestly
   * rather than leaving a switch that looks on and isn't.
   */
  async function enable() {
    if (!config?.publicKey) return;
    setBusy(true);
    try {
      const granted = await requestPermission();
      setPermission(granted);
      if (granted !== "granted") {
        message.warning(
          granted === "denied"
            ? "Your browser blocked notifications for this site"
            : "Notifications weren't enabled",
        );
        return;
      }

      const subscription = await subscribeDevice(config.publicKey);
      if (!subscription) {
        message.error("This browser wouldn't provide a push subscription");
        return;
      }

      await api.pushSubscribe(subscription);
      await load();
      message.success("Notifications on for this device");
    } catch (e) {
      message.error(errText(e, "Couldn't enable notifications"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const endpoint = await unsubscribeDevice();
      // Tell the server even if the browser had nothing to unsubscribe: the row
      // may exist from a previous session on this device.
      if (endpoint) await api.pushUnsubscribe(endpoint);
      await load();
      message.success("Notifications off for this device");
    } catch (e) {
      message.error(errText(e, "Couldn't turn notifications off"));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    try {
      await api.pushTest();
      message.success("Sent — it should arrive in a moment");
    } catch (e) {
      message.error(errText(e, "Couldn't send a test notification"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {!supported && (
        <Alert
          type="info"
          showIcon
          message="This browser can't show notifications"
          description="Installing Bearry to your home screen usually enables them on mobile."
        />
      )}

      {supported && !loading && !serverReady && (
        <Alert
          type="info"
          showIcon
          message="Notifications aren't set up on this server"
          description="They need VAPID keys configured server-side. Nothing you can change from here."
        />
      )}

      {permission === "denied" && (
        <Alert
          type="warning"
          showIcon
          message="Your browser is blocking notifications for this site"
          description="It can't be re-requested from this page — you'll need to allow notifications for this site in your browser's settings, then come back."
        />
      )}

      <Card size="small">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15 }}>
              <BellOutlined style={{ marginRight: 8 }} />
              Notifications on this device
            </div>
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              {active
                ? "Reminders you set on tasks and events will arrive here."
                : "Reminders won't reach you on this device."}
            </Text>
          </div>
          <Switch
            checked={active}
            loading={busy}
            disabled={!supported || !serverReady || permission === "denied"}
            onChange={(on) => void (on ? enable() : disable())}
          />
        </div>

        {(config?.devices ?? 0) > 0 && (
          <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 14 }}>
            {config?.devices} device{config?.devices === 1 ? "" : "s"} registered on this
            account.
          </Text>
        )}
      </Card>

      {active && (
        <Button loading={busy} onClick={() => void sendTest()}>
          Send a test notification
        </Button>
      )}

      <Text type="secondary" style={{ fontSize: 12 }}>
        Reminders are set per task, from the schedule panel — by default at the
        time it starts, with 1 hour, 1 day and 1 week before available too.
      </Text>
    </Space>
  );
}
