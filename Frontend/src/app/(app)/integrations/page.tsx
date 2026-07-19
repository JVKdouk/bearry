"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  Empty,
  Input,
  Modal,
  Tag,
  Tooltip,
} from "antd";
import {
  ApiOutlined,
  CheckCircleFilled,
  CloudOutlined,
  DisconnectOutlined,
  PlusOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { GridSkeleton } from "@/components/Skeletons";
import { api, ApiError, errText } from "@/lib/api";
import { useSync } from "@/store/sync";
import { useIntegrations } from "@/store/integrations";
import { useIsOffline } from "@/store/network";
import type { Integration, IntegrationConnection } from "@/lib/types";

// Brand-ish accents so each card feels distinct — "make it shine".
const BRAND: Record<string, string> = {
  google: "#4285f4",
  "google-calendar": "#4285f4",
  gcal: "#4285f4",
  todoist: "#e44332",
  ticktick: "#4772fa",
  notion: "#c9c9d6",
  outlook: "#0f6cbd",
  slack: "#611f69",
  trello: "#0079bf",
  github: "#c9c9d6",
};

function brandColor(id: string) {
  return BRAND[id] ?? BRAND[id.split("-")[0]] ?? "#a855f7";
}

export default function IntegrationsPage() {
  const { message } = AntdApp.useApp();
  const list = useIntegrations((s) => s.list);
  const loading = useIntegrations((s) => s.loading);
  const loaded = useIntegrations((s) => s.loaded);
  const load = useIntegrations((s) => s.load);
  const setList = useIntegrations((s) => s.set);
  const pull = useSync((s) => s.pull);
  const [busy, setBusy] = useState<string | null>(null);
  const [secretFor, setSecretFor] = useState<Integration | null>(null);
  const [secret, setSecret] = useState("");
  // Integrations are the one area that genuinely cannot work offline — every
  // action round-trips to a third-party service. The page stays readable so you
  // can still see what's connected; the controls go inert.
  const offline = useIsOffline();

  useEffect(() => {
    void load(true);
  }, [load]);

  async function refresh() {
    try {
      const { integrations } = await api.integrations();
      setList(integrations);
    } catch {
      /* keep */
    }
  }

  async function connect(p: Integration) {
    setBusy(p.id);
    try {
      if (p.authType === "oauth2") {
        const { url } = await api.integrationAuthUrl(p.id);
        const popup = window.open(url, "_blank", "width=520,height=640");
        const started = Date.now();
        const timer = setInterval(async () => {
          if (Date.now() - started > 120_000 || (popup && popup.closed)) {
            clearInterval(timer);
            await refresh();
            setBusy(null);
            return; // don't fall through into another poll after giving up
          }
          try {
            const { integrations } = await api.integrations();
            const me = integrations.find((i) => i.id === p.id);
            if (me?.connected) {
              clearInterval(timer);
              popup?.close();
              setList(integrations);
              setBusy(null);
              message.success(`${p.name ?? p.id} connected`);
            }
          } catch {
            /* keep polling */
          }
        }, 2000);
      } else {
        // token / apikey providers need a credential — ask for it rather than
        // POSTing an empty body and reporting a useless "couldn't connect".
        setBusy(null);
        setSecretFor(p);
        setSecret("");
      }
    } catch (e) {
      message.error(errText(e, "Couldn't connect"));
      setBusy(null);
    }
  }

  /** Submit the pasted token / URL for a token-based provider. */
  async function submitSecret() {
    const p = secretFor;
    const value = secret.trim();
    if (!p || !value) return;
    setBusy(p.id);
    try {
      await api.integrationConnect(p.id, { secret: value });
      await refresh();
      message.success(`${p.name ?? p.id} connected`);
      setSecretFor(null);
      setSecret("");
    } catch (err) {
      // The API explains precisely what's wrong ("Paste your TickTick access
      // token", "Couldn't reach TickTick with that token") — surface it.
      message.error(err instanceof ApiError ? err.message : "Couldn't connect");
    } finally {
      setBusy(null);
    }
  }

  /** Connected accounts for a provider (falls back for older API shapes). */
  function connectionsOf(p: Integration): IntegrationConnection[] {
    return p.connections ?? [];
  }

  async function disconnectOne(c: IntegrationConnection) {
    setBusy(c.id);
    try {
      await api.connectionDisconnect(c.id);
      await refresh();
      message.success(`Disconnected ${c.label}`);
    } catch (e) {
      message.error(errText(e, "Couldn't disconnect"));
    } finally {
      setBusy(null);
    }
  }

  async function syncOne(c: IntegrationConnection) {
    setBusy(c.id);
    try {
      await api.connectionSync(c.id);
      await pull();
      message.success(`Synced ${c.label}`);
      await refresh();
    } catch (e) {
      message.error(errText(e, "Sync failed"));
    } finally {
      setBusy(null);
    }
  }

  async function saveGroups(c: IntegrationConnection, selected: string[]) {
    try {
      const all = (c.groups ?? []).length;
      await api.connectionOptions(c.id, selected.length === all ? null : selected);
      message.success("Selection saved");
      await refresh();
    } catch (e) {
      message.error(errText(e, "Couldn't save"));
    }
  }

  const connected = list.filter((i) => i.connected).length;

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle={connected ? `${connected} connected · your tools, in one calm place` : "Bring your tools into Bearry"}
      />

      {offline && (
        <Alert
          type="info"
          showIcon
          icon={<CloudOutlined />}
          style={{ marginBottom: 16 }}
          message="Integrations need a connection"
          description="Connecting and syncing talk to services like Google and TickTick, so they're paused while you're offline. Everything already imported is still here, and the rest of Bearry works normally."
        />
      )}

      {loading && !loaded ? (
        // A skeleton in the real layout beats a centred spinner: the page keeps
        // its shape, so nothing jumps when the providers arrive.
        <GridSkeleton cards={6} />
      ) : list.length === 0 ? (
        <Empty description="No providers available" />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 16,
          }}
        >
          {list.map((p) => {
            const color = brandColor(p.id);
            return (
              <div
                key={p.id}
                style={{
                  position: "relative",
                  borderRadius: 16,
                  border: "1px solid #1c1c26",
                  background: `linear-gradient(180deg, ${color}14 0%, #12121a 42%)`,
                  padding: 18,
                  overflow: "hidden",
                  opacity: offline ? 0.55 : 1,
                  transition: "opacity 0.2s",
                }}
              >
                {p.connected && (
                  <div
                    style={{
                      position: "absolute",
                      top: 14,
                      right: 14,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      color: "#7ee36b",
                    }}
                  >
                    <CheckCircleFilled /> Connected
                  </div>
                )}
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      display: "grid",
                      placeItems: "center",
                      background: color + "22",
                      color,
                      fontSize: 20,
                      fontWeight: 700,
                    }}
                  >
                    {(p.name ?? p.id)[0]?.toUpperCase() ?? <ApiOutlined />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{p.name ?? p.id}</div>
                    <div style={{ fontSize: 12.5, color: "#8f8fa2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.category ?? "Integration"}
                    </div>
                  </div>
                </div>

                <p style={{ fontSize: 13, color: "#a9a9b8", margin: "0 0 12px", minHeight: 34, lineHeight: 1.5 }}>
                  {p.description}
                </p>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                  {p.version && <Tag bordered={false} style={{ background: "#17171f", color: "#8f8fa2" }}>v{p.version}</Tag>}
                  {p.capabilities?.pull && <Tag bordered={false} color="blue">import</Tag>}
                  {p.capabilities?.push && <Tag bordered={false} color="purple">export</Tag>}
                  {!p.available && <Tag bordered={false}>coming soon</Tag>}
                </div>

                {/* One row per connected account — a provider can hold several */}
                {connectionsOf(p).length > 0 && (
                  <div style={{ borderTop: "1px solid #1c1c26", paddingTop: 12, marginBottom: 12 }}>
                    {connectionsOf(p).map((c) => (
                      <div key={c.id} style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            style={{
                              width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                              background: c.connected ? "#7ee36b" : "#6f6f80",
                            }}
                          />
                          <span
                            style={{
                              flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}
                            title={c.accountKey}
                          >
                            {c.label}
                          </span>
                          <Tooltip
                            title={
                              offline
                                ? "Syncing needs a connection"
                                : p.capabilities?.pull
                                  ? "Sync this account"
                                  : "This provider can't import"
                            }
                          >
                            <Button
                              size="small"
                              icon={<SyncOutlined />}
                              loading={busy === c.id}
                              disabled={offline || !p.capabilities?.pull}
                              onClick={() => syncOne(c)}
                            />
                          </Tooltip>
                          <Tooltip title={offline ? "Needs a connection" : "Disconnect this account"}>
                            <Button
                              size="small"
                              danger
                              type="text"
                              icon={<DisconnectOutlined />}
                              loading={busy === c.id}
                              disabled={offline}
                              onClick={() => disconnectOne(c)}
                            />
                          </Tooltip>
                        </div>

                        {c.lastSyncedAt && (
                          <div style={{ fontSize: 11.5, color: "#6f6f80", marginTop: 3, marginLeft: 15 }}>
                            Last synced {new Date(c.lastSyncedAt).toLocaleString()}
                          </div>
                        )}

                        {c.groups && c.groups.length > 0 && (
                          <div style={{ marginTop: 8, marginLeft: 15 }}>
                            <div style={{ fontSize: 11, letterSpacing: 0.5, color: "#6f6f80", textTransform: "uppercase", marginBottom: 6 }}>
                              Import from
                            </div>
                            <Checkbox.Group
                              disabled={offline}
                              style={{ display: "flex", flexDirection: "column", gap: 4 }}
                              defaultValue={c.selectedGroups ?? c.groups.map((g) => g.id)}
                              options={c.groups.map((g) => ({ label: g.label, value: g.id }))}
                              onChange={(vals) => saveGroups(c, vals)}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    type={connectionsOf(p).length > 0 ? "default" : "primary"}
                    block
                    icon={connectionsOf(p).length > 0 ? <PlusOutlined /> : undefined}
                    disabled={offline || !p.available || (connectionsOf(p).length > 0 && !p.multiAccount)}
                    loading={busy === p.id}
                    onClick={() => connect(p)}
                  >
                    {connectionsOf(p).length === 0
                      ? "Connect"
                      : p.multiAccount
                        ? "Add another account"
                        : "Connected"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Credential prompt for token / apikey providers, driven by the manifest
          so a new provider describes its own input with no frontend changes. */}
      <Modal
        open={!!secretFor}
        title={`Connect ${secretFor?.name ?? ""}`}
        onCancel={() => setSecretFor(null)}
        onOk={submitSecret}
        okText="Connect"
        okButtonProps={{ disabled: !secret.trim(), loading: busy === secretFor?.id }}
        destroyOnClose
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 13, color: "#c9c9d6" }}>
            {secretFor?.secretLabel ?? "Access token"}
          </label>
          <Input.TextArea
            autoFocus
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={secretFor?.secretPlaceholder ?? ""}
            autoSize={{ minRows: 2, maxRows: 4 }}
            onPressEnter={(e) => {
              e.preventDefault();
              void submitSecret();
            }}
          />
          {secretFor?.secretHelp && (
            <div style={{ fontSize: 12.5, color: "#8f8fa2", lineHeight: 1.55 }}>
              {secretFor.secretHelp}
            </div>
          )}
          {secretFor?.multiAccount && (secretFor.connections?.length ?? 0) > 0 && (
            <div style={{ fontSize: 12.5, color: "#8f8fa2" }}>
              This will be added alongside your existing{" "}
              {secretFor.connections?.length} connection
              {(secretFor.connections?.length ?? 0) === 1 ? "" : "s"}.
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
