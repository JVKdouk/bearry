"use client";

import { useEffect, useState } from "react";
import {
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  Select,
  Segmented,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  CalendarOutlined,
  CheckOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  FileTextOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { ListSkeleton } from "@/components/Skeletons";
import { ApiError } from "@/lib/api";
import { useSync } from "@/store/sync";
import { useCollection } from "@/store/hooks";
import dayjs from "dayjs";
import { useCapture, useInboxItems } from "@/store/capture";
import { useIsOffline } from "@/store/network";
import { fmtDateTime } from "@/lib/format";
import type { AcceptOverrides, CaptureItem } from "@/lib/types";

const { Text, Paragraph } = Typography;

const TYPE_META: Record<string, { color: string; icon: React.ReactNode }> = {
  task: { color: "purple", icon: <CheckOutlined /> },
  note: { color: "blue", icon: <FileTextOutlined /> },
  event: { color: "geekblue", icon: <CalendarOutlined /> },
  trash: { color: "default", icon: <DeleteOutlined /> },
};

type Edit = { date?: string; dateCleared?: boolean; projectId?: string | null };

/**
 * The classifier's guesses, as things you can accept or change.
 *
 * The triage ritual is "confirm, don't configure", so this stays a single row
 * of chips rather than a form — but confirming something you can't see isn't
 * confirmation, it's a coin flip.
 */
function Suggestions({
  item,
  edit,
  projects,
  onEdit,
}: {
  item: CaptureItem;
  edit: Edit;
  projects: { id: string; name: string }[];
  onEdit: (patch: Partial<Edit>) => void;
}) {
  const detectedDate = item.extractedFields?.date as string | undefined;
  const date = edit.dateCleared ? null : (edit.date ?? detectedDate ?? null);
  const projectId = edit.projectId !== undefined ? edit.projectId : item.suggestedProjectId ?? null;
  const duration = item.extractedFields?.durationMinutes as number | undefined;

  // Nothing was extracted and there's nothing to assign — don't add an empty row.
  if (!detectedDate && !edit.date && !projectId && projects.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        marginTop: 10,
        paddingTop: 10,
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <Text type="secondary" style={{ fontSize: 11.5 }}>
        Suggested
      </Text>

      <DatePicker
        size="small"
        value={date ? dayjs(date) : null}
        onChange={(d) =>
          onEdit(d ? { date: d.toISOString(), dateCleared: false } : { dateCleared: true })
        }
        format="MMM D"
        placeholder="No date"
        variant="filled"
        style={{ width: 118 }}
      />

      {duration ? (
        <Tag style={{ marginInlineEnd: 0 }}>{duration} min</Tag>
      ) : null}

      {projects.length > 0 && (
        <Select
          size="small"
          value={projectId}
          onChange={(v) => onEdit({ projectId: v ?? null })}
          placeholder="No list"
          allowClear
          style={{ minWidth: 130 }}
          options={projects.map((p) => ({ label: p.name, value: p.id }))}
        />
      )}
    </div>
  );
}

export default function InboxPage() {
  const { message } = AntdApp.useApp();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  /**
   * Per-item edits to what the classifier extracted.
   *
   * `dateCleared` is tracked separately from `date` because "the user removed
   * the detected date" and "the user hasn't touched it" must reach the server
   * as different answers — otherwise a wrongly-detected date can only be
   * escaped by dismissing the capture and retyping it.
   */
  const [edits, setEdits] = useState<
    Record<string, { date?: string; dateCleared?: boolean; projectId?: string | null }>
  >({});
  const projects = useCollection("project");

  function editItem(id: string, patch: Partial<(typeof edits)[string]>) {
    setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  }
  const pull = useSync((s) => s.pull);
  const items = useInboxItems();
  const loading = useCapture((s) => s.loading);
  const loaded = useCapture((s) => s.loaded);
  const failed = useCapture((s) => s.error);
  const load = useCapture((s) => s.load);
  const doCapture = useCapture((s) => s.capture);
  const doAccept = useCapture((s) => s.accept);
  const doDismiss = useCapture((s) => s.dismiss);
  const queuedCount = useCapture((s) => s.queued.length);
  const offline = useIsOffline();

  useEffect(() => {
    void load(true); // always land on a fresh inbox
  }, [load]);

  useEffect(() => {
    if (failed) message.error("Couldn't load your inbox");
  }, [failed, message]);

  async function capture() {
    const raw = text.trim();
    if (!raw) return;
    setSubmitting(true);
    try {
      // Never throws for connectivity — offline it queues and returns.
      await doCapture(raw);
      setText("");
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : "Capture failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function accept(item: CaptureItem) {
    const type = overrides[item.id] ?? item.proposedType;
    if (item.pending && type !== "trash") {
      message.info("This one files itself once you're back online");
      return;
    }

    // `null` clears a suggestion the user rejected; leaving the key out keeps
    // whatever the classifier found. The two are genuinely different answers.
    const edit = edits[item.id] ?? {};
    const chosen: AcceptOverrides = {
      ...(edit.dateCleared ? { date: null } : edit.date ? { date: edit.date } : {}),
      ...(edit.projectId !== undefined ? { projectId: edit.projectId } : {}),
    };

    try {
      await doAccept(item.id, type, chosen);
      if (!offline) await pull(); // bring the new todo/note/event into the store
      message.success(type === "trash" ? "Dismissed" : `Added as ${type}`);
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : "Couldn't accept");
    }
  }

  async function dismiss(item: CaptureItem) {
    try {
      await doDismiss(item.id);
    } catch {
      message.error("Couldn't dismiss");
    }
  }

  return (
    <div>
      <PageHeader
        title="Inbox"
        subtitle="Capture now, decide later — one tap to file each thought"
      />

      <Space.Compact style={{ width: "100%", marginBottom: queuedCount ? 8 : 20 }}>
        <Input
          size="large"
          placeholder="Brain-dump anything… a task, a link, a thought"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPressEnter={capture}
        />
        <Button
          size="large"
          type="primary"
          icon={<SendOutlined />}
          loading={submitting}
          onClick={capture}
        >
          Capture
        </Button>
      </Space.Compact>

      {/* Capture always works; say so plainly rather than leaving the user to
          wonder whether an offline thought was actually kept. */}
      {queuedCount > 0 && (
        <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 20 }}>
          <CloudUploadOutlined />{" "}
          {queuedCount} capture{queuedCount === 1 ? "" : "s"} saved on this device — they&apos;ll
          file themselves when you&apos;re back online.
        </Text>
      )}

      {loading && !loaded ? (
        <ListSkeleton rows={3} header={false} />
      ) : items.length === 0 ? (
        <Empty description="Inbox zero. Nicely done." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((item) => {
            const chosen = overrides[item.id] ?? item.proposedType;
            const title =
              (item.extractedFields?.title as string | undefined) ?? item.rawContent;
            return (
              <Card key={item.id} size="small" styles={{ body: { padding: 16 } }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <Paragraph style={{ margin: 0, fontSize: 15 }} ellipsis={{ rows: 3 }}>
                      {title}
                    </Paragraph>
                    {item.pending && (
                      <Tag
                        icon={<CloudUploadOutlined />}
                        color="orange"
                        style={{ marginTop: 6, marginInlineEnd: 0 }}
                      >
                        saved offline
                      </Tag>
                    )}
                    <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
                      {fmtDateTime(item.createdAt)}
                      {/* A queued capture hasn't been classified yet, so a 0%
                          confidence score would be misleading, not informative. */}
                      {!item.pending &&
                        ` · confidence ${Math.round((item.confidence ?? 0) * 100)}%`}
                    </Text>
                  </div>
                  <Tag
                    color={TYPE_META[chosen]?.color}
                    icon={TYPE_META[chosen]?.icon}
                    style={{ height: "fit-content" }}
                  >
                    {chosen}
                  </Tag>
                </div>

                {/* What the classifier found, shown rather than applied
                    silently. Accepting used to file a task with a date and a
                    project the user never saw — right most of the time, and
                    quietly wrong the rest, with no way to tell which. */}
                {chosen !== "trash" && !item.pending && (
                  <Suggestions
                    item={item}
                    edit={edits[item.id] ?? {}}
                    projects={projects}
                    onEdit={(patch) => editItem(item.id, patch)}
                  />
                )}

                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                  <Segmented
                    size="small"
                    value={chosen}
                    onChange={(v) =>
                      setOverrides((o) => ({ ...o, [item.id]: v as string }))
                    }
                    options={[
                      { label: "Task", value: "task" },
                      { label: "Note", value: "note" },
                      { label: "Event", value: "event" },
                      { label: "Trash", value: "trash" },
                    ]}
                  />
                  <Space>
                    <Button size="small" onClick={() => dismiss(item)}>
                      Dismiss
                    </Button>
                    <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => accept(item)}>
                      Accept
                    </Button>
                  </Space>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
