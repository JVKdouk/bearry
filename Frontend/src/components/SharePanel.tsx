"use client";

/**
 * The "share this list" controls, for the owner.
 *
 * Two jobs: hand out a link (with a role), and manage who's already in. It
 * loads the roster from the server rather than the synced rows because the
 * server is the one place that knows people's names and the pending invite
 * tokens — a member's client only ever sees membership rows, never the secrets.
 */

import { useCallback, useEffect, useState } from "react";
import { App as AntdApp, Button, Segmented, Spin, Tag } from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  LinkOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { api, errText } from "@/lib/api";

type Role = "view" | "write";

interface Member {
  userId: string;
  role: Role | "owner";
  email: string;
  name: string | null;
  isOwner: boolean;
}
interface Invite {
  id: string;
  token: string;
  role: Role;
}

function inviteUrl(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/invite/${token}`;
}

export function SharePanel({ projectId }: { projectId: string }) {
  const { message } = AntdApp.useApp();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [role, setRole] = useState<Role>("write");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.shareMembers(projectId);
      setMembers(r.members);
      setInvites(r.invites);
    } catch {
      // A list you don't own (or a brand-new one not yet synced) has no roster
      // to show; the panel just stays empty rather than erroring.
      setMembers([]);
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The link for the currently-selected role — reused, so flipping the toggle
  // shows the existing link for that role rather than minting a new one.
  const current = invites.find((i) => i.role === role);

  async function copyLink() {
    setBusy(true);
    try {
      const invite = current ?? (await api.shareCreate(projectId, role));
      const url = inviteUrl(invite.token);
      await navigator.clipboard.writeText(url).catch(() => {});
      if (!current) await load();
      message.success("Link copied");
    } catch (e) {
      message.error(errText(e, "Couldn't create a link"));
    } finally {
      setBusy(false);
    }
  }

  async function setMemberRole(userId: string, next: Role) {
    try {
      await api.shareSetRole(projectId, userId, next);
      setMembers((ms) => ms.map((m) => (m.userId === userId ? { ...m, role: next } : m)));
    } catch (e) {
      message.error(errText(e, "Couldn't change the role"));
    }
  }

  async function removeMember(userId: string) {
    try {
      await api.shareRemoveMember(projectId, userId);
      setMembers((ms) => ms.filter((m) => m.userId !== userId));
      message.success("Removed");
    } catch (e) {
      message.error(errText(e, "Couldn't remove them"));
    }
  }

  async function revoke(inviteId: string) {
    try {
      await api.shareRevoke(inviteId);
      setInvites((is) => is.filter((i) => i.id !== inviteId));
      message.success("Link turned off");
    } catch (e) {
      message.error(errText(e, "Couldn't turn off the link"));
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "16px 0", textAlign: "center" }}>
        <Spin size="small" />
      </div>
    );
  }

  return (
    <div>
      <div style={sectionLabel}>Invite by link</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <Segmented
          size="small"
          value={role}
          onChange={(v) => setRole(v as Role)}
          options={[
            { label: "Can edit", value: "write" },
            { label: "Can view", value: "view" },
          ]}
        />
        <Button
          size="small"
          type="primary"
          icon={<CopyOutlined />}
          loading={busy}
          onClick={copyLink}
        >
          Copy link
        </Button>
      </div>
      {current && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
          <LinkOutlined style={{ color: "#6f6f80", fontSize: 12 }} />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11.5,
              color: "#8f8fa2",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {inviteUrl(current.token)}
          </span>
          <Button
            type="text"
            size="small"
            aria-label="Turn off this link"
            icon={<DeleteOutlined style={{ fontSize: 12 }} />}
            onClick={() => revoke(current.id)}
          />
        </div>
      )}

      <div style={sectionLabel}>People</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {members.map((m) => (
          <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "#2a2a37",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <UserOutlined style={{ fontSize: 12, color: "#a9a9b8" }} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  color: "#e8e8ef",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {m.name || m.email}
              </div>
            </div>
            {m.isOwner ? (
              <Tag color="purple" style={{ margin: 0 }}>
                Owner
              </Tag>
            ) : (
              <>
                <Segmented
                  size="small"
                  value={m.role}
                  onChange={(v) => setMemberRole(m.userId, v as Role)}
                  options={[
                    { label: "Edit", value: "write" },
                    { label: "View", value: "view" },
                  ]}
                />
                <Button
                  type="text"
                  size="small"
                  aria-label={`Remove ${m.name || m.email}`}
                  icon={<DeleteOutlined style={{ fontSize: 12, color: "#6f6f80" }} />}
                  onClick={() => removeMember(m.userId)}
                />
              </>
            )}
          </div>
        ))}
        {members.length <= 1 && (
          <div style={{ fontSize: 12, color: "#6f6f80" }}>
            No one else yet. Copy a link to invite people.
          </div>
        )}
      </div>
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  color: "#6f6f80",
  marginBottom: 10,
  marginTop: 4,
};
