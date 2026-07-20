/**
 * When the planner places a task, the task's own placed time (if it had one)
 * must be vacated — otherwise a timed task the solver re-placed keeps rendering
 * at its old slot *next to* the planner block that replaces it: the same task
 * drawn twice, the stale copy still flagged "carried over".
 *
 * This is the pure decision behind that vacate, kept separate from the DB write
 * in `applyPlan` so every branch is testable without a database:
 *
 *  • A deadline-only task placed nothing of its own — nothing to vacate.
 *  • A timed task is stripped of its start/end and its `isFixed` pin; the
 *    planner block becomes the single source of truth for where it sits.
 *  • A *recurring* task must keep a series anchor (`advanceRecurrence` walks
 *    from `startTime ?? deadline`). If it has no deadline to fall back on, its
 *    old start is pinned as the deadline so the next occurrence can still be
 *    computed. `whenOf` prefers the planner block over a bare deadline, so this
 *    never re-surfaces the task as overdue.
 */

export interface VacateSource {
  id: string;
  startTime: Date | null;
  deadline: Date | null;
  recurrenceRule: string | null;
}

export interface VacatePatch {
  id: string;
  startTime: null;
  endTime: null;
  isFixed: false;
  /** Set only to preserve a recurring task's anchor when it has no deadline. */
  deadline?: Date;
}

export function vacatePatches(sources: VacateSource[]): VacatePatch[] {
  const out: VacatePatch[] = [];
  for (const s of sources) {
    // A task that never carried its own time placed nothing on the grid, so the
    // planner block stands alone — leave it untouched.
    if (!s.startTime) continue;
    const patch: VacatePatch = {
      id: s.id,
      startTime: null,
      endTime: null,
      isFixed: false,
    };
    if (s.recurrenceRule && !s.deadline) patch.deadline = s.startTime;
    out.push(patch);
  }
  return out;
}
