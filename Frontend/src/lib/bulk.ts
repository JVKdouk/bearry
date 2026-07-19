/**
 * Turning "these tasks, this action" into a set of concrete edits.
 *
 * Pure: given the selected blocks and an action, it returns the patches to
 * apply, and nothing else. Keeping it out of the UI is what lets the awkward
 * cases be tested — "mark complete" on a mixed selection where half are already
 * done, "move to list" where some are already in that list — rather than
 * discovered when a bulk edit does something surprising to twelve tasks at once.
 */

import type { Block, Priority } from "./types";

export type BulkAction =
  | { type: "complete" }
  | { type: "reopen" }
  | { type: "priority"; priority: Priority }
  | { type: "move"; projectId: string | null }
  | { type: "delete" };

export interface BulkPatch {
  id: string;
  patch: Partial<Block>;
}

export interface BulkPlan {
  /** Blocks to patch, and with what. Excludes no-ops. */
  patches: BulkPatch[];
  /** Blocks to remove (delete only). */
  removals: string[];
}

/**
 * Whether "mark complete" should be offered as complete or as reopen.
 *
 * If everything selected is already done, the useful action is to reopen it;
 * otherwise it's to complete. Deciding by the selection rather than showing
 * both keeps the bar to one toggle, the way a single card's checkbox works.
 */
export function allComplete(blocks: Pick<Block, "status">[]): boolean {
  return blocks.length > 0 && blocks.every((b) => b.status === "done");
}

type Selectable = Pick<Block, "id" | "status" | "priority" | "projectId">;

/**
 * The edits an action implies over a selection.
 *
 * Every branch skips rows the action wouldn't change — completing an
 * already-done task, moving a task already in the target list — so a bulk edit
 * touches only what it needs to. That matters beyond tidiness: each patch is a
 * synced write and a version bump, and re-writing a row to its current value
 * would churn the outbox and every other client for no reason.
 */
export function planBulk(blocks: Selectable[], action: BulkAction): BulkPlan {
  const plan: BulkPlan = { patches: [], removals: [] };

  switch (action.type) {
    case "delete":
      plan.removals = blocks.map((b) => b.id);
      return plan;

    case "complete":
      for (const b of blocks) {
        if (b.status !== "done") plan.patches.push({ id: b.id, patch: { status: "done" } });
      }
      return plan;

    case "reopen":
      for (const b of blocks) {
        if (b.status === "done") plan.patches.push({ id: b.id, patch: { status: "todo" } });
      }
      return plan;

    case "priority":
      for (const b of blocks) {
        if (b.priority !== action.priority) {
          plan.patches.push({ id: b.id, patch: { priority: action.priority } });
        }
      }
      return plan;

    case "move":
      for (const b of blocks) {
        // Normalise both sides: a block with no project stores null, and the
        // "No list" target is null too, so an already-listless task moved to
        // "No list" is correctly a no-op.
        const current = b.projectId ?? null;
        if (current !== action.projectId) {
          plan.patches.push({ id: b.id, patch: { projectId: action.projectId } });
        }
      }
      return plan;
  }
}

/** A short past-tense summary for the confirmation toast. */
export function bulkSummary(action: BulkAction, count: number): string {
  const n = `${count} task${count === 1 ? "" : "s"}`;
  switch (action.type) {
    case "complete":
      return `Completed ${n}`;
    case "reopen":
      return `Reopened ${n}`;
    case "delete":
      return `Deleted ${n}`;
    case "priority":
      return `Set ${n} to ${action.priority}`;
    case "move":
      return action.projectId ? `Moved ${n}` : `Moved ${n} to No list`;
  }
}
