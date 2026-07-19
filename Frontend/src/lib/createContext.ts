/**
 * What a "new task" button should assume, given where you are.
 *
 * Pressing + while looking at a list and getting a task in *no* list is a small
 * betrayal: the screen said "Personal", so the thing you just made should be in
 * Personal. The list page already did this; the nav's own + did not, so the
 * same gesture meant different things depending on which + you reached for.
 *
 * Pure, because "which of these route shapes carries a project id" is exactly
 * the sort of thing that looks obvious and has four exceptions.
 */

/**
 * Pseudo-lists that live at the same place in the URL as a real list id but
 * aren't one. Creating into "Completed" is meaningless; creating into "All
 * tasks" or "No list" means explicitly no project.
 */
const PSEUDO_LISTS = new Set(["all", "none", "completed"]);

export interface CreateDefaults {
  projectId?: string | null;
}

/**
 * The defaults for a create started from `pathname` + `?list=`.
 *
 * Returns undefined when there's nothing to assume, so callers can pass it
 * straight through without inventing an empty object that reads as "I decided
 * these were the defaults".
 */
export function createDefaultsFor(
  pathname: string,
  listParam: string | null | undefined,
): CreateDefaults | undefined {
  // Only the list route carries a list in the URL. `/lists/settings` is about
  // the lists themselves, not the work in one.
  if (pathname !== "/lists") return undefined;
  if (!listParam || PSEUDO_LISTS.has(listParam)) return undefined;
  return { projectId: listParam };
}

/**
 * The same rule, reading the list straight off the current URL.
 *
 * For click handlers. `useSearchParams` would force every page under this
 * layout into a Suspense boundary — including statically prerendered ones —
 * to answer a question that only matters at the moment of the click.
 */
export function createDefaultsNow(pathname: string): CreateDefaults | undefined {
  if (typeof window === "undefined") return undefined;
  const list = new URLSearchParams(window.location.search).get("list");
  return createDefaultsFor(pathname, list);
}
