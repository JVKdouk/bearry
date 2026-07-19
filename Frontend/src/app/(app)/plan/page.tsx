"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Spin } from "antd";

// Planning now happens on the calendar itself, where proposals render as ghost
// blocks against your real commitments. The ⚡ nav item lands here and hands
// straight over to the calendar with planning already running.
export default function PlanPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/calendar?plan=1");
  }, [router]);

  return (
    <div style={{ display: "grid", placeItems: "center", padding: 60 }}>
      <Spin />
    </div>
  );
}
