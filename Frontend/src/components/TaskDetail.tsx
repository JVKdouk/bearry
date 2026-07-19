"use client";

import { useEffect, useMemo, useState } from "react";
import {
  App as AntdApp,
  Button,
  Checkbox,
  Drawer,
  Input,
  Popconfirm,
  Popover,
  Segmented,
  Select,
  Tooltip,
} from "antd";
import {
  BulbOutlined,
  CalendarOutlined,
  CloseOutlined,
  DeleteOutlined,
  FlagFilled,
  FlagOutlined,
  HeartOutlined,
  MoreOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { api, errText } from "@/lib/api";
import { useUI } from "@/store/ui";
import { useSync } from "@/store/sync";
import { useIsOffline } from "@/store/network";
import { useCollection, useRecord } from "@/store/hooks";
import { LIFE_AREAS, PRIORITY_COLOR } from "@/lib/format";
import { SchedulePopover, type ScheduleValue } from "@/components/SchedulePopover";
import { nextQuarterHour, taskToEvent, taskToNote } from "@/lib/convert";
import { fireAtFor, rescheduleReminders } from "@/lib/reminders";
import { SURFACE } from "@/lib/theme";
import type { Priority, Todo } from "@/lib/types";

const PRIORITY_OPTS = [
  { label: "ASAP", value: "ASAP" as Priority },
  { label: "High", value: "high" as Priority },
  { label: "Med", value: "medium" as Priority },
  { label: "Low", value: "low" as Priority },
];

function schedulePatch(date: Dayjs | null, time: Dayjs | null, duration: number) {
  if (date && time) {
    const start = date.hour(time.hour()).minute(time.minute()).second(0).millisecond(0);
    const end = start.add(duration || 30, "minute");
    return {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      deadline: null,
      estimatedDuration: duration || 30,
    };
  }
  if (date) {
    return {
      deadline: date.endOf("day").toISOString(),
      startTime: null,
      endTime: null,
      estimatedDuration: duration || 30,
    };
  }
  return { deadline: null, startTime: null, endTime: null, estimatedDuration: duration || 30 };
}

export function TaskDetail({ overlay, isMobile }: { overlay: boolean; isMobile: boolean }) {
  const { message } = AntdApp.useApp();
  const open = useUI((s) => s.taskDrawerOpen);
  const editingId = useUI((s) => s.editingTaskId);
  const defaults = useUI((s) => s.createDefaults);
  const closeDrawer = useUI((s) => s.closeTaskDrawer);

  const create = useSync((s) => s.create);
  const update = useSync((s) => s.update);
  const remove = useSync((s) => s.remove);
  const projects = useCollection("project");
  const editing = useRecord("todo", editingId);

  // Create mode keeps an in-memory draft — nothing is written to the store (or
  // shows up on the calendar) until the user explicitly confirms with Create.
  const isCreate = !editingId;
  // Everything about editing a task is local; only the AI assists need the API.
  const offline = useIsOffline();
  const [draft, setDraft] = useState<Partial<Todo>>({});

  const [date, setDate] = useState<Dayjs | null>(null);
  const [time, setTime] = useState<Dayjs | null>(null);
  const [duration, setDuration] = useState(30);
  const [enriching, setEnriching] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [newStep, setNewStep] = useState("");
  // Controlled so "Done" can close it; an uncontrolled Popover has no such hook.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  /**
   * What's being created. Notes are deliberately not offered: everything here
   * is either something you do or something that happens, and a third kind
   * with neither property was a choice people had to make before they knew
   * what the thing was. An existing task can still be converted to a note.
   */
  const [createKind, setCreateKind] = useState<"task" | "event">("task");

  /**
   * Dependencies (§7.4). Stored as Link rows with `linkType: "blocks"`, where
   * `from` is the prerequisite and `to` is this task — so they sync, work
   * offline, and need no new table. The scheduler reads the same rows and won't
   * start a task before everything blocking it has finished.
   */
  /**
   * Reminders for this task. They're ordinary syncable rows, so they work
   * offline and need no bespoke endpoint — the server sweep just reads
   * `fireAt`.
   */
  const allReminders = useCollection("reminder");
  const reminders = useMemo(
    () =>
      allReminders
        .filter((r) => r.targetType === "todo" && r.targetId === editingId && !r.deletedAt)
        .sort((a, b) => a.offsetMinutes - b.offsetMinutes),
    [allReminders, editingId],
  );

  const links = useCollection("link");
  const blockedByIds = useMemo(
    () =>
      links
        .filter(
          (l) =>
            l.linkType === "blocks" &&
            l.toType === "todo" &&
            l.toId === editingId &&
            !l.deletedAt,
        )
        .map((l) => l.fromId),
    [links, editingId],
  );

  // Anything open that isn't this task. Excluding the task itself is what stops
  // the most obvious way to create a self-blocking deadlock.
  const allTodos = useCollection("todo");
  const candidateBlockers = useMemo(
    () =>
      allTodos.filter(
        (t) => t.id !== editingId && t.status !== "done" && !t.letGoAt && !t.deletedAt,
      ),
    [allTodos, editingId],
  );

  function setBlockedBy(nextIds: string[]) {
    if (!editingId) return;
    const current = new Set(blockedByIds);
    const next = new Set(nextIds);
    for (const id of next) {
      if (!current.has(id)) {
        create("link", {
          fromType: "todo",
          fromId: id,
          toType: "todo",
          toId: editingId,
          linkType: "blocks",
        });
      }
    }
    for (const l of links) {
      if (
        l.linkType === "blocks" &&
        l.toId === editingId &&
        !next.has(l.fromId) &&
        current.has(l.fromId)
      ) {
        remove("link", l.id);
      }
    }
  }

  // Sub-steps for the task being edited (the ADHD "doing" layer).
  const allSteps = useCollection("taskStep");
  const steps = allSteps
    .filter((s) => s.todoId === editingId)
    .sort((a, b) => a.order - b.order);

  // Seed local state whenever the panel opens (or switches task).
  useEffect(() => {
    if (!open) return;
    if (editingId) {
      if (!editing) return;
      const timed = editing.startTime && editing.endTime;
      setDate(timed ? dayjs(editing.startTime) : editing.deadline ? dayjs(editing.deadline) : null);
      setTime(timed ? dayjs(editing.startTime) : null);
      setDuration(editing.estimatedDuration ?? 30);
      return;
    }
    const base: Partial<Todo> = {
      title: "",
      notes: null,
      status: "todo",
      priority: "medium",
      energyDemand: "medium",
      estimatedDuration: 30,
      order: 0,
      projectId: defaults?.projectId ?? null,
    };
    let d: Dayjs | null = null;
    let t: Dayjs | null = null;
    let dur = 30;
    if (defaults?.startTime) {
      const start = dayjs(defaults.startTime);
      const end = defaults.endTime ? dayjs(defaults.endTime) : start.add(30, "minute");
      dur = Math.max(end.diff(start, "minute"), 5) || 30;
      base.startTime = start.toISOString();
      base.endTime = end.toISOString();
      base.estimatedDuration = dur;
      d = start;
      t = start;
    } else if (defaults?.deadline) {
      base.deadline = defaults.deadline;
      d = dayjs(defaults.deadline);
    }
    setDraft(base);
    // A time supplied by the caller (tapping a calendar slot) means an event is
    // the likelier intent, so start there rather than making them switch.
    setCreateKind(defaults?.startTime ? "event" : "task");
    setDate(d);
    setTime(t);
    setDuration(dur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId]);

  // The record being edited, or the unsaved draft.
  const v: Partial<Todo> = isCreate ? draft : (editing ?? {});

  function patch(p: Partial<Todo>) {
    if (editingId) update("todo", editingId, p);
    else setDraft((d) => ({ ...d, ...p }));
  }

  function closePanel() {
    setDraft({});
    setNewStep("");
    closeDrawer();
  }

  // ---- AI assist ----------------------------------------------------------

  async function enrich() {
    if (!editingId) return;
    setEnriching(true);
    try {
      const { results } = await api.aiEnrich({ todoIds: [editingId] });
      const r = results[0];
      if (!r) {
        message.info("Nothing to suggest for this task");
        return;
      }
      patch({
        estimatedDuration: r.estimatedDuration,
        energyDemand: r.energyDemand,
        category: r.category,
      });
      setDuration(r.estimatedDuration);
      message.success(
        r.kind === "reminder"
          ? "Marked as a reminder — it won't be scheduled as work"
          : r.reason,
      );
    } catch (e) {
      // Surface what the server said when it explained itself — "you've used
      // this hour's AI suggestions" tells the user what to do; a flat
      // "couldn't estimate" leaves them retrying into the same wall.
      message.error(errText(e, "Couldn't estimate this task"));
    } finally {
      setEnriching(false);
    }
  }

  async function suggestSteps() {
    if (!editingId) return;
    setSuggesting(true);
    try {
      const { steps: suggested, source } = await api.aiFirstStep(editingId);
      if (suggested.length === 0) {
        // The server now always returns something, so an empty list is a real
        // fault rather than "your task can't be broken down".
        message.warning("Couldn't break this one down — try rewording the title");
        return;
      }
      suggested.forEach((text, i) =>
        create("taskStep", {
          todoId: editingId,
          text,
          order: steps.length + i,
          isFirstStep: steps.length === 0 && i === 0,
          done: false,
        }),
      );
      // Say where they came from — "AI wrote these" and "we reformatted your
      // own notes" earn different levels of trust.
      message.success(
        source === "ai"
          ? `Added ${suggested.length} steps`
          : source === "notes"
            ? `Added ${suggested.length} steps from your notes`
            : `Added ${suggested.length} starter steps — edit them to fit`,
      );
    } catch (e) {
      message.error(errText(e, "Couldn't suggest steps"));
    } finally {
      setSuggesting(false);
    }
  }

  function addStep() {
    const text = newStep.trim();
    if (!text || !editingId) return;
    create("taskStep", {
      todoId: editingId,
      text,
      order: steps.length,
      isFirstStep: steps.length === 0,
      done: false,
    });
    setNewStep("");
  }

  /**
   * Turn this task into a note or a calendar event.
   *
   * Creates the replacement first and only then removes the original: the two
   * writes are separate sync ops, and doing it the other way round means a
   * failure between them loses the content outright.
   *
   * Steps don't survive — neither notes nor events have them. That's stated in
   * the confirm rather than discovered afterwards.
   */
  function convertTo(target: "note" | "event") {
    if (!editingId || !editing) return;

    if (target === "note") {
      create("note", taskToNote(editing));
      message.success("Converted to a note");
    } else {
      create("calendarEvent", taskToEvent(editing, nextQuarterHour()));
      message.success("Converted to an event");
    }

    for (const step of steps) remove("taskStep", step.id);
    remove("todo", editingId);
    closePanel();
  }

  /**
   * Create the thing, as whichever kind was chosen.
   *
   * An event needs a time to exist at all — it occupies a slot whether or not
   * you act on it — so choosing "event" without one falls back to the next
   * quarter hour rather than silently creating something with no place on the
   * calendar.
   */
  function confirmCreate() {
    const title = (draft.title ?? "").trim();
    if (!title) return;

    if (createKind === "event") {
      const start = date && time
        ? date.hour(time.hour()).minute(time.minute()).second(0).millisecond(0).toDate()
        : nextQuarterHour();
      create("calendarEvent", {
        source: "bearai",
        title,
        description: draft.notes ?? null,
        start: start.toISOString(),
        end: new Date(start.getTime() + (duration || 30) * 60_000).toISOString(),
        isFixed: true,
      });
    } else {
      create("todo", { ...draft, title, status: "todo", order: 0 });
    }
    closePanel();
  }

  const done = v.status === "done";
  const priority = (v.priority ?? "medium");
  const canCreate = !!(draft.title ?? "").trim();

  /**
   * One handler for every scheduling field, because they're interdependent:
   * changing the date has to rewrite start/end when a time is set, and clearing
   * the date has to drop the repeat rule with it.
   */
  function addReminder(offsetMinutes: number) {
    if (!editingId || !date) return;
    const start = time ? date.hour(time.hour()).minute(time.minute()) : date.hour(9).minute(0);
    create("reminder", {
      targetType: "todo",
      targetId: editingId,
      kind: "time",
      // triggerSpec is the encrypted record of intent; fireAt is the cleartext
      // moment the sweep queries against.
      triggerSpec: JSON.stringify({ offsetMinutes }),
      offsetMinutes,
      fireAt: fireAtFor(start.toDate(), offsetMinutes).toISOString(),
    });
  }

  /**
   * Move every reminder when the task's time changes.
   *
   * Done here because this is where the change originates and it has to work
   * offline. Without it a reminder keeps pointing at the old moment — firing
   * for a meeting that moved, or never firing at all.
   */
  function rescheduleAttachedReminders(start: Date | null) {
    for (const patch of rescheduleReminders(reminders, start)) {
      update("reminder", patch.id, { fireAt: patch.fireAt });
    }
  }

  function applySchedule(next: Partial<ScheduleValue>) {
    const d = next.date !== undefined ? next.date : date;
    const t = next.time !== undefined ? next.time : time;
    const dur = next.duration !== undefined ? next.duration : duration;

    if (next.date !== undefined) setDate(d);
    if (next.time !== undefined) setTime(t);
    if (next.duration !== undefined) setDuration(dur);

    patch({
      ...schedulePatch(d, t, dur),
      ...(next.recurrenceRule !== undefined ? { recurrenceRule: next.recurrenceRule } : {}),
    });

    if (next.date !== undefined || next.time !== undefined) {
      const start = d ? (t ? d.hour(t.hour()).minute(t.minute()) : d.hour(9).minute(0)) : null;
      rescheduleAttachedReminders(start ? start.toDate() : null);
    }
  }

  const datePill = (
    <Popover
      trigger="click"
      placement="bottomLeft"
      open={scheduleOpen}
      onOpenChange={setScheduleOpen}
      content={
        <SchedulePopover
          value={{ date, time, duration, recurrenceRule: v.recurrenceRule ?? null }}
          onChange={applySchedule}
          onClear={() => {
            setDate(null);
            setTime(null);
            rescheduleAttachedReminders(null);
            // A repeat rule with nothing to repeat from is dead config.
            patch({ ...schedulePatch(null, null, duration), recurrenceRule: null });
          }}
          onClose={() => setScheduleOpen(false)}
          reminders={isCreate ? undefined : reminders}
          onAddReminder={isCreate ? undefined : addReminder}
          onRemoveReminder={(id) => remove("reminder", id)}
        />
      }
    >
      <button className="meta-pill" style={metaPillStyle(!!date)}>
        <CalendarOutlined />
        {date ? `${date.format("MMM D")}${time ? ` · ${time.format("HH:mm")}` : ""}` : "Schedule"}
      </button>
    </Popover>
  );

  const priorityControl = (
    <Popover
      trigger="click"
      placement="bottomRight"
      content={
        <Segmented
          value={priority}
          onChange={(val) => patch({ priority: val })}
          options={PRIORITY_OPTS}
        />
      }
    >
      <Tooltip title="Priority">
        <Button
          type="text"
          icon={
            priority === "medium" || priority === "low" ? (
              <FlagOutlined style={{ color: "#7c7c8a" }} />
            ) : (
              <FlagFilled style={{ color: PRIORITY_COLOR[priority] }} />
            )
          }
        />
      </Tooltip>
    </Popover>
  );

  /**
   * Duration, editable straight from the toolbar.
   *
   * It used to be a read-only caption here and only editable inside the date
   * popover — so setting "how long will this take" meant opening a menu about
   * *when* it happens, which are different questions. How long something takes
   * is the field the scheduler leans on most, so it gets a one-tap control with
   * presets for the common answers.
   */
  const morePopover = (
    <Popover
      trigger="click"
      placement="topRight"
      content={
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 220 }}>
          <label style={metaLabel}>
            <ThunderboltOutlined /> Energy
            <Select
              size="small"
              value={v.energyDemand ?? "medium"}
              onChange={(val) => patch({ energyDemand: val })}
              style={{ width: "100%", marginTop: 4 }}
              options={[
                { label: "High", value: "high" },
                { label: "Medium", value: "medium" },
                { label: "Low", value: "low" },
              ]}
            />
          </label>
          {/* Appetite is not the same as effort. A ten-minute phone call can be
              trivially easy and still the reason a whole week stalls, so the
              scheduler needs to know about the dread, not just the duration. */}
          <label style={metaLabel}>
            <HeartOutlined /> How much you want to
            <Select
              size="small"
              value={v.desire ?? "neutral"}
              onChange={(val) => patch({ desire: val })}
              style={{ width: "100%", marginTop: 4 }}
              options={[
                { label: "Looking forward to it", value: "wanted" },
                { label: "Neutral", value: "neutral" },
                { label: "Avoiding it", value: "avoided" },
              ]}
            />
          </label>
          {!isCreate && (
            <label style={metaLabel}>
              <NodeIndexOutlined /> Blocked by
              <Select
                size="small"
                mode="multiple"
                allowClear
                placeholder="Must happen first"
                value={blockedByIds}
                onChange={setBlockedBy}
                style={{ width: "100%", marginTop: 4 }}
                filterOption={(input, option) =>
                  String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                }
                options={candidateBlockers.map((t) => ({
                  label: t.title || "Untitled",
                  value: t.id,
                }))}
              />
            </label>
          )}
          <label style={metaLabel}>
            Category
            <Select
              size="small"
              allowClear
              placeholder="Life area"
              value={v.category ?? undefined}
              onChange={(val) => patch({ category: val ?? null })}
              style={{ width: "100%", marginTop: 4 }}
              options={LIFE_AREAS.map((a) => ({ label: a[0].toUpperCase() + a.slice(1), value: a }))}
            />
          </label>

          {/* Converting is rare and destructive, so it lives at the bottom of
              the overflow menu rather than beside the everyday controls. */}
          {!isCreate && (
            <div style={{ borderTop: "1px solid #2a2a33", paddingTop: 10 }}>
              <div style={metaLabel}>Convert to</div>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <Button size="small" style={{ flex: 1 }} onClick={() => convertTo("note")}>
                  Note
                </Button>
                <Button size="small" style={{ flex: 1 }} onClick={() => convertTo("event")}>
                  Event
                </Button>
              </div>
              <div style={{ fontSize: 11, color: "#6f6f80", marginTop: 6, lineHeight: 1.45 }}>
                {"A note isn't actionable. An event holds time and completes itself once it passes."}
              </div>
            </div>
          )}
        </div>
      }
    >
      <Tooltip title="More">
        <Button type="text" icon={<MoreOutlined />} />
      </Tooltip>
    </Popover>
  );

  const body = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: `1px solid ${SURFACE.borderSoft}`,
        }}
      >
        {!isCreate && (
          <Checkbox
            checked={done}
            onChange={(e) => patch({ status: e.target.checked ? "done" : "todo" })}
          />
        )}
        {/* Task or event, chosen up front — the two behave differently enough
            that deciding afterwards means re-entering the same information. */}
        {isCreate && (
          <Segmented
            size="small"
            value={createKind}
            onChange={(k) => setCreateKind(k as "task" | "event")}
            options={[
              { label: "Task", value: "task" },
              { label: "Event", value: "event" },
            ]}
          />
        )}
        {datePill}
        <div style={{ flex: 1 }} />
        {priorityControl}
        <Tooltip title="Close">
          <Button type="text" icon={<CloseOutlined />} onClick={closePanel} />
        </Tooltip>
      </div>

      {/* markdown-style editor */}
      {/* A column, so the notes editor can take whatever height the title and
          steps don't. `minHeight: 0` is what lets it actually shrink — without
          it a flex item refuses to go below its content size and the editor
          would push the drawer into scrolling instead of resizing. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "18px 22px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <input
          value={v.title ?? ""}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder={
            isCreate ? (createKind === "event" ? "What's happening?" : "What needs doing?") : "Untitled"
          }
          autoFocus={isCreate || !v.title}
          onKeyDown={(e) => {
            if (isCreate && e.key === "Enter" && canCreate) confirmCreate();
          }}
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            color: done ? "#7c7c8a" : "#f4f4f8",
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
            marginBottom: 14,
            textDecoration: done ? "line-through" : "none",
            flexShrink: 0,
          }}
        />
        {/* Sub-steps — the first one is the "just start" step.
            Rendered whenever the task is saved, not only once steps exist:
            gating this on `steps.length > 0` meant the ONLY way to get a first
            step was to ask the AI for one, which made a manual checklist
            impossible and put a network round-trip in front of typing. */}
        {!isCreate && (
          // Never compressed: a checklist item squeezed to half a line is
          // unreadable, so steps keep their natural height and the notes
          // editor gives up space instead.
          <div style={{ marginBottom: 16, flexShrink: 0 }}>
            {steps.map((s) => (
              <div
                key={s.id}
                style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "5px 0" }}
              >
                <Checkbox
                  checked={s.done}
                  onChange={(e) => update("taskStep", s.id, { done: e.target.checked })}
                  style={{ marginTop: 2 }}
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: 14,
                    lineHeight: 1.5,
                    color: s.done ? "#6f6f80" : "#c9c9d6",
                    textDecoration: s.done ? "line-through" : "none",
                  }}
                >
                  {s.text}
                  {s.isFirstStep && !s.done && (
                    <span style={{ marginLeft: 8, fontSize: 10.5, color: "#ff6b2c", fontWeight: 700 }}>
                      START HERE
                    </span>
                  )}
                </span>
                <Button
                  type="text"
                  size="small"
                  aria-label="Remove step"
                  icon={<CloseOutlined style={{ fontSize: 11, color: "#6f6f80" }} />}
                  onClick={() => remove("taskStep", s.id)}
                />
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="add-step-row" style={{ flex: 1, minWidth: 0 }}>
                <PlusOutlined />
                <Input
                  size="small"
                  variant="borderless"
                  placeholder="Add a step"
                  value={newStep}
                  onChange={(e) => setNewStep(e.target.value)}
                  onPressEnter={addStep}
                  onBlur={addStep}
                  style={{ paddingInline: 0, flex: 1 }}
                />
              </div>
              {steps.length === 0 && (
                <Tooltip
                  title={
                    offline
                      ? "Suggestions need a connection"
                      : "Suggest steps from the title and notes"
                  }
                >
                  <Button
                    type="text"
                    size="small"
                    icon={<BulbOutlined />}
                    loading={suggesting}
                    disabled={offline}
                    onClick={suggestSteps}
                    style={{ color: "#8f8fa2", flexShrink: 0 }}
                  >
                    Suggest
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
        )}

        <textarea
          value={v.notes ?? ""}
          onChange={(e) => patch({ notes: e.target.value || null })}
          placeholder="Start writing — notes, links, sub-steps…"
          style={{
            width: "100%",
            // Takes every pixel the title and steps leave behind, so the
            // writing area is the whole drawer rather than a 160px box with
            // dead space under it. Adding steps shrinks it rather than
            // stranding it; the floor stops a long checklist squeezing the
            // editor down to a single line, at which point the drawer scrolls
            // instead.
            flex: "1 1 auto",
            minHeight: 140,
            border: "none",
            outline: "none",
            resize: "none",
            background: "transparent",
            color: "#c9c9d6",
            fontSize: 15,
            lineHeight: 1.65,
            fontFamily: "inherit",
          }}
        />

      </div>

      {/* bottom toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderTop: `1px solid ${SURFACE.borderSoft}`,
        }}
      >
        <Select
          variant="borderless"
          size="small"
          placeholder="No list"
          value={v.projectId ?? undefined}
          onChange={(val) => patch({ projectId: val ?? null })}
          allowClear
          style={{ minWidth: 120 }}
          options={projects
            .filter((p) => !p.archived)
            .map((p) => ({
              label: (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
                  {p.name}
                </span>
              ),
              value: p.id,
            }))}
        />
        <div style={{ flex: 1 }} />
        {!isCreate && (
          <Tooltip
            title={
              offline
                ? "Estimates need a connection"
                : "Estimate duration, energy and category"
            }
          >
            <Button
              type="text"
              aria-label="Estimate metadata"
              icon={<PlusOutlined style={{ display: "none" }} />}
              loading={enriching}
              disabled={offline}
              onClick={enrich}
              style={{ fontSize: 15, paddingInline: 8 }}
            >
              ✨
            </Button>
          </Tooltip>
        )}
        {morePopover}
        {isCreate ? (
          <>
            <Button onClick={closePanel}>Cancel</Button>
            <Button type="primary" disabled={!canCreate} onClick={confirmCreate}>
              Create
            </Button>
          </>
        ) : (
          // No Tooltip here: it would render on top of the confirm popup.
          <Popconfirm
            title="Delete this task?"
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => {
              if (editingId) {
                remove("todo", editingId);
                closePanel();
              }
            }}
          >
            <Button type="text" danger aria-label="Delete task" icon={<DeleteOutlined />} />
          </Popconfirm>
        )}
      </div>
    </div>
  );

  // Mobile: bottom sheet that slides up over the current screen, leaving the
  // context (e.g. the calendar) visible behind the mask.
  if (isMobile) {
    return (
      <Drawer
        placement="bottom"
        open={open}
        onClose={closePanel}
        height="85%"
        maskClosable
        keyboard
        closeIcon={null}
        styles={{
          body: { padding: 0, background: SURFACE.bg },
          header: { display: "none" },
          content: {
            background: SURFACE.bg,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            overflow: "hidden",
          },
          mask: { background: "rgba(0,0,0,0.55)" },
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ display: "grid", placeItems: "center", padding: "10px 0 2px", flexShrink: 0 }}>
            <span style={{ width: 38, height: 4, borderRadius: 999, background: "#33333f" }} />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>{body}</div>
        </div>
      </Drawer>
    );
  }

  // Desktop overlay (calendar): floating panel on the right.
  if (overlay) {
    if (!open) return null;
    return (
      <>
        <div
          onClick={closePanel}
          style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 30 }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: 420,
            background: "#0d0d13",
            borderLeft: `1px solid ${SURFACE.borderSoft}`,
            boxShadow: "-16px 0 40px rgba(0,0,0,0.4)",
            zIndex: 31,
          }}
        >
          {body}
        </div>
      </>
    );
  }

  // Desktop inline: squish sibling that animates its width.
  return (
    <div
      style={{
        width: open ? 420 : 0,
        flexShrink: 0,
        overflow: "hidden",
        borderLeft: open ? `1px solid ${SURFACE.borderSoft}` : "none",
        background: "#0d0d13",
        transition: "width 0.22s ease",
        height: "calc(100vh - 56px)",
      }}
    >
      <div style={{ width: 420, height: "100%" }}>{open && body}</div>
    </div>
  );
}

const metaLabel: React.CSSProperties = { fontSize: 12, color: "#a9a9b8" };

function metaPillStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: `1px solid ${active ? "rgba(168,85,247,0.45)" : "#24242f"}`,
    background: active ? "rgba(168,85,247,0.14)" : "transparent",
    color: active ? "#d9b8ff" : "#a9a9b8",
    borderRadius: 999,
    padding: "4px 12px",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    height: 30,
  };
}
