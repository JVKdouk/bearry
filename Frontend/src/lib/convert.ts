/**
 * Turning one kind of thing into another.
 *
 * A captured thought rarely arrives as the right shape. "Read the Q3 report"
 * starts as a task, turns out to be reference material, and becomes a note.
 * "Dentist" is a task until you book it, at which point it's an event that
 * happens whether or not you do anything. Forcing people to delete and retype
 * is how content gets lost.
 *
 * These functions are pure and return the fields for the new record plus the id
 * of the old one to remove. The rules about what survives a conversion are the
 * whole point, so they're here and tested rather than inline in a menu handler.
 */

import type { CalendarEventEntity, Note, Todo } from "./types";

export type Convertible = "task" | "note" | "event";

/** What something currently is, from its stored shape. */
export function kindOf(item: { startTime?: string | null; endTime?: string | null }): Convertible {
  return item.startTime && item.endTime ? "event" : "task";
}

/**
 * Task → Note.
 *
 * Notes have no schedule, no priority and no steps, so all of that is dropped.
 * The task's notes body becomes the note body; the title carries over. Nothing
 * is silently merged — a note whose body suddenly contained "priority: high"
 * would be worse than losing the field.
 */
export function taskToNote(todo: Partial<Todo>): Partial<Note> {
  return {
    title: (todo.title ?? "").trim() || "Untitled",
    bodyMarkdown: todo.notes ?? "",
  };
}

/**
 * Note → Task.
 *
 * The body becomes the task's notes. Defaults match a freshly created task
 * rather than guessing: a converted note has no evidence about how long it
 * takes or how much it matters, and inventing an estimate would feed the
 * planner a number nobody chose.
 */
export function noteToTask(note: Partial<Note>): Partial<Todo> {
  return {
    title: (note.title ?? "").trim() || "Untitled",
    notes: note.bodyMarkdown || null,
    status: "todo",
    priority: "medium",
    energyDemand: "medium",
    estimatedDuration: 30,
    order: 0,
  };
}

/**
 * Task → Event.
 *
 * An event occupies time whether or not you act, so it needs a start. The
 * task's own schedule is used when it has one; otherwise its deadline at a
 * sensible hour; otherwise the caller's fallback (usually "now, rounded").
 * Duration comes from the estimate, because that's the closest thing to an
 * intended length the task carries.
 */
export function taskToEvent(
  todo: Partial<Todo>,
  fallbackStart: Date,
): Partial<CalendarEventEntity> {
  const start = todo.startTime
    ? new Date(todo.startTime)
    : todo.deadline
      ? atHour(new Date(todo.deadline), 9)
      : fallbackStart;

  const minutes =
    todo.startTime && todo.endTime
      ? Math.max(5, (new Date(todo.endTime).getTime() - new Date(todo.startTime).getTime()) / 60_000)
      : (todo.estimatedDuration ?? 30);

  return {
    source: "bearai",
    title: (todo.title ?? "").trim() || "Untitled",
    description: todo.notes ?? null,
    start: start.toISOString(),
    end: new Date(start.getTime() + minutes * 60_000).toISOString(),
    // A converted commitment is something you decided to hold, so the planner
    // treats it as immovable rather than shuffling it like proposed work.
    isFixed: true,
  };
}

/**
 * Event → Task.
 *
 * The reverse trip keeps the time, so converting back and forth doesn't lose
 * when it was. It becomes actionable again — a thing you do, not a thing that
 * merely happens.
 */
export function eventToTask(event: Partial<CalendarEventEntity>): Partial<Todo> {
  const start = event.start ? new Date(event.start) : null;
  const end = event.end ? new Date(event.end) : null;
  const minutes =
    start && end ? Math.max(5, Math.round((end.getTime() - start.getTime()) / 60_000)) : 30;

  return {
    title: (event.title ?? "").trim() || "Untitled",
    notes: event.description ?? null,
    status: "todo",
    priority: "medium",
    energyDemand: "medium",
    estimatedDuration: minutes,
    startTime: start ? start.toISOString() : null,
    endTime: end ? end.toISOString() : null,
    order: 0,
  };
}

/** Note → Event, via task — a note has no time, so it lands on the fallback. */
export function noteToEvent(
  note: Partial<Note>,
  fallbackStart: Date,
): Partial<CalendarEventEntity> {
  return taskToEvent(noteToTask(note), fallbackStart);
}

/** Event → Note. Keeps the description; the time is what's being given up. */
export function eventToNote(event: Partial<CalendarEventEntity>): Partial<Note> {
  return {
    title: (event.title ?? "").trim() || "Untitled",
    bodyMarkdown: event.description ?? "",
  };
}

function atHour(date: Date, hour: number): Date {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * The next sensible slot for something being given a time it never had.
 *
 * Rounded up to the next quarter hour: an event starting at 14:37 is nobody's
 * intention, it's just when they happened to tap the button.
 */
export function nextQuarterHour(now = new Date()): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15);
  return d;
}
