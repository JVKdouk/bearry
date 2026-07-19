import { create } from "zustand";

export type ListView = "list" | "board" | "timeline";

interface UIState {
  // Task create/edit detail panel. taskId=null => create mode.
  // On desktop this renders as a split panel that squishes the content;
  // on mobile it becomes a full-screen sheet.
  taskDrawerOpen: boolean;
  editingTaskId: string | null;
  createDefaults: {
    deadline?: string;
    startTime?: string;
    endTime?: string;
    projectId?: string | null;
  } | null;
  openCreateTask: (defaults?: UIState["createDefaults"]) => void;
  openEditTask: (id: string) => void;
  closeTaskDrawer: () => void;

  // Secondary (double-sidebar) lists panel — desktop.
  secondaryCollapsed: boolean;
  toggleSecondary: () => void;
  setSecondary: (v: boolean) => void;

  // Mobile nav drawer
  navDrawerOpen: boolean;
  setNavDrawer: (v: boolean) => void;

  // Per-list layout preference (persisted to localStorage, keyed by list id
  // or the special "all" / "none" pseudo-lists).
  listViews: Record<string, ListView>;
  setListView: (listKey: string, view: ListView) => void;

  // Show recurring block regions (work/personal/sleep…) behind the calendar.
  showRegions: boolean;
  setShowRegions: (v: boolean) => void;

  /**
   * True while a plan proposal is on screen. Planning isn't a page — it's a
   * mode layered over the calendar — but the ⚡ rail item still needs to read
   * as active while you're in it, so the state lives here where the shell can
   * see it.
   */
  planOpen: boolean;
  setPlanOpen: (v: boolean) => void;
}

const LS_KEY = "bearry.listViews";
const LS_REGIONS = "bearry.showRegions";

function loadListViews(): Record<string, ListView> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export const useUI = create<UIState>((set, get) => ({
  taskDrawerOpen: false,
  editingTaskId: null,
  createDefaults: null,
  openCreateTask: (defaults) =>
    set({ taskDrawerOpen: true, editingTaskId: null, createDefaults: defaults ?? null }),
  openEditTask: (id) =>
    set({ taskDrawerOpen: true, editingTaskId: id, createDefaults: null }),
  closeTaskDrawer: () =>
    set({ taskDrawerOpen: false, editingTaskId: null, createDefaults: null }),

  secondaryCollapsed: false,
  toggleSecondary: () => set((s) => ({ secondaryCollapsed: !s.secondaryCollapsed })),
  setSecondary: (v) => set({ secondaryCollapsed: v }),

  navDrawerOpen: false,
  setNavDrawer: (v) => set({ navDrawerOpen: v }),

  listViews: loadListViews(),
  setListView: (listKey, view) => {
    const next = { ...get().listViews, [listKey]: view };
    set({ listViews: next });
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota */
      }
    }
  },

  planOpen: false,
  setPlanOpen: (v) => set({ planOpen: v }),

  showRegions:
    typeof window !== "undefined" ? localStorage.getItem(LS_REGIONS) === "1" : false,
  setShowRegions: (v) => {
    set({ showRegions: v });
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(LS_REGIONS, v ? "1" : "0");
      } catch {
        /* ignore quota */
      }
    }
  },
}));
