import { AppShell } from "@/components/AppShell";
import { ServiceWorker } from "@/components/ServiceWorker";
import { NotificationActions } from "@/components/NotificationActions";

export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      {children}
      <ServiceWorker />
      <NotificationActions />
    </AppShell>
  );
}
