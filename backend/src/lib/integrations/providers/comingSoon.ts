/**
 * Declarative "coming soon" plugins — proof that adding an integration is mostly
 * data. Each declares its manifest (including which block types it will import);
 * when ready, add `pull()` and flip `available` to true. Nothing else changes.
 */

import type { IntegrationProvider, BlockType } from "../types";

function stub(
  id: string,
  name: string,
  category: IntegrationProvider["category"],
  icon: string,
  description: string,
  pull: BlockType[],
): IntegrationProvider {
  return {
    id,
    name,
    version: "0.1.0",
    category,
    icon,
    description,
    authType: "oauth2",
    capabilities: { pull, push: [] },
    available: false,
    trust: "first-party",
    async connect() {
      throw new Error(`${name} integration is not available yet`);
    },
  };
}

export const comingSoonProviders: IntegrationProvider[] = [
  stub("outlook-calendar", "Outlook Calendar", "calendar", "📆", "Two-way sync with Microsoft 365 calendars.", ["event"]),
  stub("apple-calendar", "iCloud Calendar", "calendar", "🍎", "Sync your Apple Calendar via CalDAV.", ["event"]),
  stub("todoist", "Todoist", "tasks", "✅", "Import tasks and projects from Todoist.", ["task"]),
  stub("notion", "Notion", "notes", "🗒️", "Pull pages and databases in as notes.", ["note"]),
];
