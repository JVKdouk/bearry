"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Avatar,
  Badge,
  Button,
  Drawer,
  Dropdown,
  Grid,
  Spin,
  Tooltip,
} from "antd";
import {
  ApiOutlined,
  CalendarOutlined,
  InboxOutlined,
  LogoutOutlined,
  MenuOutlined,
  PlusOutlined,
  SettingOutlined,
  SunOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { useAuth } from "@/store/auth";
import { useUI } from "@/store/ui";
import { useSync } from "@/store/sync";
import { useIntegrations } from "@/store/integrations";
import { useCapture } from "@/store/capture";
import { useIsOffline, watchConnectivity } from "@/store/network";
import { SyncBadge } from "./SyncBadge";
import { SidebarLists } from "./SidebarLists";
import { TaskDetail } from "./TaskDetail";
import { BottomNav } from "./BottomNav";
import { ACCENT } from "@/lib/theme";

const PRIMARY = [
  { key: "/today", icon: <SunOutlined />, label: "Today" },
  { key: "/lists", icon: <UnorderedListOutlined />, label: "Lists" },
  { key: "/calendar", icon: <CalendarOutlined />, label: "Calendar" },
  { key: "/plan", icon: <ThunderboltOutlined />, label: "Plan" },
  { key: "/inbox", icon: <InboxOutlined />, label: "Inbox" },
];

// Routes that get the contextual "lists" panel (rail 2).
const SECONDARY_ROUTES = ["/today", "/lists"];

function RailButton({
  active,
  icon,
  label,
  onClick,
  badgeDot,
  dimmed,
}: {
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  badgeDot?: boolean;
  /** Reachable, but its features need a connection — shown faded. */
  dimmed?: boolean;
}) {
  return (
    <Tooltip title={label} placement="right">
      <button
        aria-label={label}
        onClick={onClick}
        style={{
          position: "relative",
          width: 44,
          height: 44,
          display: "grid",
          placeItems: "center",
          border: "none",
          borderRadius: 12,
          cursor: "pointer",
          fontSize: 19,
          color: active ? "#fff" : "#7c7c8a",
          background: active ? "rgba(168,85,247,0.18)" : "transparent",
          boxShadow: active ? "inset 0 0 0 1px rgba(168,85,247,0.35)" : "none",
          opacity: dimmed ? 0.4 : 1,
          transition: "all 0.14s",
        }}
        onMouseEnter={(e) => {
          if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          if (!active) e.currentTarget.style.color = "#c9c9d6";
        }}
        onMouseLeave={(e) => {
          if (!active) e.currentTarget.style.background = "transparent";
          if (!active) e.currentTarget.style.color = "#7c7c8a";
        }}
      >
        {icon}
        {badgeDot && (
          <span
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#52c41a",
              boxShadow: "0 0 0 2px #0a0a0f",
            }}
          />
        )}
      </button>
    </Tooltip>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const navDrawerOpen = useUI((s) => s.navDrawerOpen);
  const taskDrawerOpen = useUI((s) => s.taskDrawerOpen);
  const closeTaskDrawer = useUI((s) => s.closeTaskDrawer);
  const setNavDrawer = useUI((s) => s.setNavDrawer);
  const openCreateTask = useUI((s) => s.openCreateTask);
  const secondaryCollapsed = useUI((s) => s.secondaryCollapsed);
  const planOpen = useUI((s) => s.planOpen);
  const pull = useSync((s) => s.pull);
  const integrations = useIntegrations((s) => s.list);
  const loadIntegrations = useIntegrations((s) => s.load);

  const loadCaptures = useCapture((s) => s.load);
  const attachCaptures = useCapture((s) => s.attach);
  const flushCaptures = useCapture((s) => s.flush);
  const serverCaptures = useCapture((s) => s.items.length);
  const queuedCaptures = useCapture((s) => s.queued.length);
  const flushSync = useSync((s) => s.flush);
  const offline = useIsOffline();

  const pendingCaptures = serverCaptures + queuedCaptures;
  const connectedCount = integrations.filter((i) => i.connected).length;

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Changing page closes the task panel. It's scoped to the task you were
  // looking at, so carrying it into a different view leaves an editor floating
  // over unrelated content with no obvious way back.
  useEffect(() => {
    closeTaskDrawer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  /**
   * Warm every top-level route once we're signed in.
   *
   * Navigation uses `router.push`, which — unlike `<Link>` — does no
   * prefetching, so each first visit to a tab had to fetch that segment's code
   * before it could paint. On a weak connection that's seconds of looking at the
   * previous screen. Prefetching pulls the chunks in the background while the
   * user is reading, so switching is instant; the route's `loading.tsx`
   * skeleton covers whatever's left.
   */
  useEffect(() => {
    if (!user) return;
    const routes = [...PRIMARY.map((n) => n.key), "/integrations", "/settings"];
    const id = setTimeout(() => {
      for (const r of routes) router.prefetch(r);
    }, 400); // let the current page settle first
    return () => clearTimeout(id);
  }, [user, router]);

  useEffect(() => {
    if (!user) return;
    void attachCaptures(user.id);
    void loadIntegrations();
    void loadCaptures();

    // Everything queued goes up as soon as we're reachable again: the sync
    // outbox as one bulk request, then any offline captures.
    const drain = () => {
      void flushSync();
      void flushCaptures();
      void pull();
      void loadIntegrations(true);
    };

    const stopWatching = watchConnectivity(drain);
    const t = setInterval(() => void pull(), 60_000);
    const onFocus = () => {
      // Returning to the tab is also a good moment to retry — the browser's
      // `online` event doesn't fire for a server that was down and came back.
      drain();
      void loadCaptures(true);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      stopWatching();
      window.removeEventListener("focus", onFocus);
    };
  }, [user, pull, loadIntegrations, loadCaptures, attachCaptures, flushCaptures, flushSync]);

  if (loading || !user) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
        <Spin size="large" />
      </div>
    );
  }

  // Planning is a mode over the calendar rather than a route, so the ⚡ item
  // has to take its active state from the proposal being on screen.
  const activeKey = planOpen
    ? "/plan"
    : (PRIMARY.find((n) => pathname.startsWith(n.key))?.key ?? "/today");
  const showSecondary =
    !isMobile && !secondaryCollapsed && SECONDARY_ROUTES.some((r) => pathname.startsWith(r));
  const fullBleed = pathname.startsWith("/calendar");

  const userMenu = (
    <Dropdown
      menu={{
        items: [
          { key: "email", label: user.email, disabled: true },
          { type: "divider" },
          { key: "settings", icon: <SettingOutlined />, label: "Settings", onClick: () => router.push("/settings") },
          { key: "logout", icon: <LogoutOutlined />, label: "Log out", onClick: () => void logout() },
        ],
      }}
      trigger={["click"]}
      placement="topRight"
    >
      <Avatar style={{ background: ACCENT, cursor: "pointer" }} size={32}>
        {(user.first_name?.[0] ?? user.email[0] ?? "?").toUpperCase()}
      </Avatar>
    </Dropdown>
  );

  const iconRail = (
    <nav
      style={{
        width: 60,
        flexShrink: 0,
        background: "#0a0a0f",
        borderRight: "1px solid #17171f",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "12px 0",
        gap: 6,
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
      <div
        style={{ fontSize: 24, color: ACCENT, fontWeight: 700, marginBottom: 8, lineHeight: 1 }}
        title="Bearry"
      >
        ◗
      </div>
      {PRIMARY.map((n) => (
        <RailButton
          key={n.key}
          active={activeKey === n.key}
          icon={n.icon}
          label={
            n.key === "/inbox" && pendingCaptures
              ? `Inbox · ${pendingCaptures} waiting`
              : n.label
          }
          onClick={() => router.push(n.key)}
          badgeDot={n.key === "/inbox" && pendingCaptures > 0}
        />
      ))}
      <div style={{ flex: 1 }} />
      <RailButton
        active={pathname.startsWith("/integrations")}
        icon={<ApiOutlined />}
        // Integrations talk to third-party services, so they genuinely cannot
        // work offline. The page stays reachable (you can read what's connected)
        // but the entry point says why it's inert.
        label={
          offline
            ? "Integrations — unavailable offline"
            : connectedCount
              ? `Integrations · ${connectedCount} connected`
              : "Integrations"
        }
        onClick={() => router.push("/integrations")}
        badgeDot={!offline && connectedCount > 0}
        dimmed={offline}
      />
      <RailButton
        active={pathname.startsWith("/settings")}
        icon={<SettingOutlined />}
        label="Settings"
        onClick={() => router.push("/settings")}
      />
      <div style={{ marginTop: 4 }}>{userMenu}</div>
    </nav>
  );

  const secondaryPanel = (
    <aside
      style={{
        width: 250,
        flexShrink: 0,
        background: "#0d0d13",
        borderRight: "1px solid #17171f",
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
      <div
        style={{
          height: 56,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          borderBottom: "1px solid #17171f",
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: 0.2 }}>Bearry</span>
      </div>
      <div style={{ flex: 1, overflow: "hidden", padding: "8px 4px 4px" }}>
        <Suspense fallback={null}>
          <SidebarLists />
        </Suspense>
      </div>
      <button
        onClick={() => router.push("/integrations")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          border: "none",
          borderTop: "1px solid #17171f",
          background: "transparent",
          color: "#c9c9d6",
          padding: "12px 16px",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        <ApiOutlined style={{ color: ACCENT }} />
        <span style={{ flex: 1, textAlign: "left" }}>Integrations</span>
        {connectedCount > 0 && (
          <Badge
            count={connectedCount}
            style={{ background: "rgba(82,196,26,0.18)", color: "#7ee36b", boxShadow: "none" }}
          />
        )}
      </button>
    </aside>
  );

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0b0b10" }}>
      {!isMobile && iconRail}
      {showSecondary && secondaryPanel}

      {isMobile && (
        <Drawer
          placement="left"
          open={navDrawerOpen}
          onClose={() => setNavDrawer(false)}
          width={280}
          styles={{ body: { padding: 0, background: "#0d0d13" }, header: { display: "none" } }}
        >
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ padding: "18px 16px 8px", fontSize: 20, fontWeight: 700 }}>
              <span style={{ color: ACCENT }}>◗</span> Bearry
            </div>
            <div style={{ padding: "0 6px 6px", display: "flex", flexDirection: "column", gap: 2 }}>
              {PRIMARY.filter((n) => n.key === "/calendar" || n.key === "/plan" || n.key === "/inbox").map(
                (n) => (
                  <button
                    key={n.key}
                    onClick={() => {
                      router.push(n.key);
                      setNavDrawer(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      border: "none",
                      background: activeKey === n.key ? "rgba(168,85,247,0.14)" : "transparent",
                      color: activeKey === n.key ? "#d9b8ff" : "#c9c9d6",
                      padding: "9px 12px",
                      borderRadius: 9,
                      cursor: "pointer",
                      fontSize: 14,
                    }}
                  >
                    {n.icon} {n.label}
                  </button>
                ),
              )}
            </div>
            <div style={{ borderTop: "1px solid #17171f", flex: 1, overflow: "hidden", paddingTop: 6 }}>
              <Suspense fallback={null}>
                <SidebarLists onNavigate={() => setNavDrawer(false)} />
              </Suspense>
            </div>
          </div>
        </Drawer>
      )}

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: isMobile ? "0 14px" : "0 22px",
            borderBottom: "1px solid #17171f",
            background: "rgba(11,11,16,0.8)",
            backdropFilter: "blur(8px)",
            position: "sticky",
            top: 0,
            zIndex: 20,
          }}
        >
          {isMobile && (
            <Button type="text" icon={<MenuOutlined />} onClick={() => setNavDrawer(true)} />
          )}
          {isMobile && <span style={{ fontWeight: 700, fontSize: 16 }}>Bearry</span>}
          <div style={{ flex: 1 }} />
          <SyncBadge />
          {/* Inbox lives in the bottom nav on mobile, badge and all. */}
          {isMobile && (
            <Badge dot={connectedCount > 0} color="#52c41a" offset={[-2, 4]}>
              <Button type="text" icon={<ApiOutlined />} onClick={() => router.push("/integrations")} />
            </Badge>
          )}
          {/* On mobile the create action lives in the bottom-nav FAB. */}
          {!isMobile && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreateTask()}>
              New task
            </Button>
          )}
          {isMobile && userMenu}
        </header>

        <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex" }}>
          <main
            style={{
              flex: 1,
              minWidth: 0,
              overflowY: "auto",
              height: "calc(100vh - 56px)",
            }}
          >
            <div
              style={
                fullBleed
                  ? { height: "100%" }
                  : {
                      maxWidth: 1000,
                      width: "100%",
                      margin: "0 auto",
                      // extra bottom room so content clears the floating nav
                      padding: isMobile ? "18px 16px 130px" : "26px 30px",
                    }
              }
            >
              {children}
            </div>
          </main>
          <TaskDetail overlay={fullBleed} isMobile={isMobile} />
        </div>
      </div>

      {isMobile && <BottomNav />}
    </div>
  );
}
