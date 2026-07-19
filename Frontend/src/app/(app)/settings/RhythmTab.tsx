"use client";

import { Segmented, Slider, Typography } from "antd";
import { useCollection } from "@/store/hooks";
import { useSync } from "@/store/sync";
import { SURFACE, TEXT, ACCENT } from "@/lib/theme";

const { Text } = Typography;

/**
 * The work-personality settings.
 *
 * Every value is an ordinary synced `setting` row (`persona.*`), so this whole
 * tab edits offline and syncs like any task — no bespoke endpoints, and the
 * solver reads the same rows server-side.
 *
 * The copy deliberately asks about *behaviour* ("how long before your focus
 * drifts") rather than *configuration* ("session length"). People can answer the
 * first accurately and guess at the second.
 */


const DEFAULTS: Record<string, string> = {
  sessionLength: "50",
  breakLength: "15",
  longBreakEvery: "3",
  longBreakLength: "30",
  dailyMaxMinutes: "240",
  maxSessionsPerDay: "5",
  startDifficulty: "moderate",
  stopDifficulty: "moderate",
  weekendMode: "light",
  flexibility: "balanced",
};

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: `1px solid ${SURFACE.border}`,
        borderRadius: 16,
        padding: 18,
        background: SURFACE.card,
      }}
    >
      <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 2 }}>{title}</div>
      <Text type="secondary" style={{ fontSize: 12.5, display: "block", marginBottom: 14 }}>
        {hint}
      </Text>
      {children}
    </div>
  );
}

export function RhythmTab() {
  const settings = useCollection("setting");
  const create = useSync((s) => s.create);
  const update = useSync((s) => s.update);

  function rowFor(name: string) {
    return settings.find((s) => s.key === `persona.${name}`);
  }

  function valueOf(name: string): string {
    return rowFor(name)?.value ?? DEFAULTS[name];
  }

  function set(name: string, value: string | number) {
    const key = `persona.${name}`;
    const existing = rowFor(name);
    const v = String(value);
    if (existing) update("setting", existing.id, { value: v });
    else create("setting", { key, value: v });
  }

  const num = (name: string) => Number(valueOf(name));

  const sessionMinutes = num("sessionLength");
  const dailyMinutes = num("dailyMaxMinutes");
  const sessions = num("maxSessionsPerDay");

  const hours = (m: number) => {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Text type="secondary" style={{ fontSize: 12.5 }}>
        This is how the planner decides what a realistic day looks like for you.
        It would rather leave a task unscheduled than hand you a wall of blocks
        you&apos;ll bounce off.
      </Text>

      <Row
        title="How long can you actually focus?"
        hint={`One work session runs about ${sessionMinutes} minutes before the planner suggests a break.`}
      >
        <Slider
          min={15}
          max={120}
          step={5}
          value={sessionMinutes}
          onChange={(v) => set("sessionLength", v)}
          marks={{ 15: "15m", 50: "50m", 90: "90m", 120: "2h" }}
          styles={{ track: { background: ACCENT } }}
        />
      </Row>

      <Row
        title="How much rest between sessions?"
        hint={`${num("breakLength")} minutes between blocks, stretching to ${num(
          "longBreakLength",
        )} after every ${num("longBreakEvery")} sessions.`}
      >
        <Slider
          min={0}
          max={60}
          step={5}
          value={num("breakLength")}
          onChange={(v) => set("breakLength", v)}
          marks={{ 0: "none", 15: "15m", 30: "30m", 60: "1h" }}
          styles={{ track: { background: ACCENT } }}
        />
        <div style={{ marginTop: 18, fontSize: 12.5, color: TEXT.secondary }}>Longer break after</div>
        <Slider
          min={1}
          max={8}
          value={num("longBreakEvery")}
          onChange={(v) => set("longBreakEvery", v)}
          marks={{ 1: "1", 3: "3", 8: "8 sessions" }}
          styles={{ track: { background: ACCENT } }}
        />
      </Row>

      <Row
        title="How much focused work fits in a day?"
        hint={`Up to ${hours(dailyMinutes)} of scheduled work, in at most ${sessions} separate blocks. Everything else in your day — meetings, admin, life, overrun — lives in the space this leaves alone.`}
      >
        <Slider
          min={30}
          max={600}
          step={30}
          value={dailyMinutes}
          onChange={(v) => set("dailyMaxMinutes", v)}
          marks={{ 30: "30m", 240: "4h", 480: "8h", 600: "10h" }}
          styles={{ track: { background: ACCENT } }}
        />
        <div style={{ marginTop: 18, fontSize: 12.5, color: TEXT.secondary }}>
          Most separate blocks in one day
        </div>
        <Slider
          min={1}
          max={12}
          value={sessions}
          onChange={(v) => set("maxSessionsPerDay", v)}
          marks={{ 1: "1", 5: "5", 12: "12" }}
          styles={{ track: { background: ACCENT } }}
        />
      </Row>

      <Row
        title="How hard is it to get started?"
        hint="If starting is the hard part, the planner gives you fewer and longer blocks — every separate start costs you, so it stops scattering ten-minute fragments across the day."
      >
        <Segmented
          block
          value={valueOf("startDifficulty")}
          onChange={(v) => set("startDifficulty", v)}
          options={[
            { label: "I just start", value: "easy" },
            { label: "Sometimes", value: "moderate" },
            { label: "Starting is the hard part", value: "hard" },
          ]}
        />
      </Row>

      <Row
        title="How hard is it to stop?"
        hint="If you lose hours once you're in, the planner leaves a landing strip after each block so overrunning doesn't wreck what comes next."
      >
        <Segmented
          block
          value={valueOf("stopDifficulty")}
          onChange={(v) => set("stopDifficulty", v)}
          options={[
            { label: "I stop on time", value: "easy" },
            { label: "Sometimes", value: "moderate" },
            { label: "I lose hours", value: "hard" },
          ]}
        />
      </Row>

      <Row
        title="Weekends"
        hint="Whether the planner is allowed to put work on Saturday and Sunday."
      >
        <Segmented
          block
          value={valueOf("weekendMode")}
          onChange={(v) => set("weekendMode", v)}
          options={[
            { label: "Keep them free", value: "none" },
            { label: "A little", value: "light" },
            { label: "Same as weekdays", value: "full" },
          ]}
        />
      </Row>

      <Row
        title="When plans change"
        hint="How close to the line the planner runs. Leaving slack means a plan that survives contact with a bad morning; running tight fits more in but needs re-planning more often."
      >
        <Segmented
          block
          value={valueOf("flexibility")}
          onChange={(v) => set("flexibility", v)}
          options={[
            { label: "Leave me slack", value: "rigid" },
            { label: "Balanced", value: "balanced" },
            { label: "Fill my day", value: "fluid" },
          ]}
        />
      </Row>
    </div>
  );
}
