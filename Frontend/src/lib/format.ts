import dayjs from "dayjs";
import type { LifeArea, Priority } from "./types";

export function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  return dayjs(iso).format("MMM D");
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "";
  return dayjs(iso).format("MMM D, HH:mm");
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return "";
  return dayjs(iso).format("HH:mm");
}

export function durationLabel(min?: number | null): string {
  if (!min || min <= 0) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Urgency runs warm (orange family), everyday priority runs violet — the two
// app accents doing semantic work rather than just decoration.
export const PRIORITY_COLOR: Record<Priority, string> = {
  ASAP: "#ff4d4f",
  high: "#ff6b2c",
  medium: "#a855f7",
  low: "#8c8c8c",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  ASAP: "ASAP",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const LIFE_AREAS: LifeArea[] = [
  "work",
  "focus",
  "personal",
  "family",
  "errand",
  "sleep",
  "meal",
  "other",
];

export const LIFE_AREA_COLOR: Record<LifeArea, string> = {
  work: "#4096ff",
  focus: "#a855f7",
  personal: "#36cfc9",
  family: "#f759ab",
  errand: "#ffa940",
  sleep: "#597ef7",
  meal: "#73d13d",
  other: "#8c8c8c",
};

// dayMask helpers (bit 0 = Sunday .. bit 6 = Saturday)
export const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function maskToDays(mask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 7; i++) if (mask & (1 << i)) out.push(i);
  return out;
}

export function toggleDay(mask: number, day: number): number {
  return mask ^ (1 << day);
}
