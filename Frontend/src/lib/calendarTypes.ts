/**
 * Types shared between the calendar page and the components split out of it.
 *
 * These live outside the page because the page was 2,000 lines and every
 * extraction needed them; a component importing a type from a route file is a
 * dependency pointing the wrong way.
 */

import type { Dayjs } from "dayjs";

/** How much time one view shows. */
export type CalendarView = "day" | "3day" | "week" | "month";

/** One drawn block. A repeating row yields several of these. */
export interface CalendarBlock {
  /** Unique per rendered instance — a repeating event yields several. */
  id: string;
  /** The stored row this came from. Every write must use this, never `id`. */
  masterId: string;
  kind: "todo" | "event";
  title: string;
  start: Dayjs;
  end: Dayjs;
  color: string;
  /** A generated occurrence rather than the stored row itself. */
  isRepeat?: boolean;
}
