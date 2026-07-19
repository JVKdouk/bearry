"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  CalendarOutlined,
  InboxOutlined,
  PlusOutlined,
  SunOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { useUI } from "@/store/ui";
import { useCapture } from "@/store/capture";
import { createDefaultsNow } from "@/lib/createContext";

const LEFT = [
  { key: "/today", icon: <SunOutlined />, label: "Today" },
  { key: "/lists", icon: <UnorderedListOutlined />, label: "Lists" },
];
// Plan and Events keep their place in the nav drawer. Five items plus the FAB
// leaves each one about 60px on a phone, and the inbox earns its slot because
// it is the one destination that accrues work while you are away.
const RIGHT = [
  { key: "/calendar", icon: <CalendarOutlined />, label: "Calendar" },
  { key: "/inbox", icon: <InboxOutlined />, label: "Inbox" },
];

// Floating pill nav for mobile, with the create action as the centre FAB.
export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const openCreateTask = useUI((s) => s.openCreateTask);
  const pending = useCapture((s) => s.items.length);

  const btn = (n: { key: string; icon: React.ReactNode; label: string }) => {
    const count = n.key === "/inbox" ? pending : 0;
    return (
      <button
        key={n.key}
        aria-label={count ? `${n.label}, ${count} waiting` : n.label}
        className="bottom-nav-btn"
        data-active={pathname.startsWith(n.key)}
        onClick={() => router.push(n.key)}
      >
        {n.icon}
        {count > 0 && <span className="bottom-nav-count">{count > 99 ? "99+" : count}</span>}
      </button>
    );
  };

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {LEFT.map(btn)}
      <button
        aria-label="New task"
        className="bottom-nav-fab"
        // Creating from a list puts the task in that list. Reaching for the
        // nav's + instead of the page's used to mean the difference between
        // "in Personal" and "in nothing", which is not a distinction the two
        // buttons look like they make.
        onClick={() => openCreateTask(createDefaultsNow(pathname))}
      >
        <PlusOutlined />
      </button>
      {RIGHT.map(btn)}
    </nav>
  );
}
