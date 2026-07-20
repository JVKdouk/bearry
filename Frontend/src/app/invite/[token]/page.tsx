"use client";

/**
 * The screen a share link opens.
 *
 * One URL does both jobs the feature asks for: opened in the installed PWA it
 * runs here in the app; opened in a browser it runs here on the site. There's
 * no separate "app vs web" branch to build — it's the same in-scope page, and
 * the OS decides which surface shows it.
 *
 * The flow adapts to who's holding the link:
 *   - signed in  -> accept, then land on the list
 *   - signed out -> the same preview, with a sign-in that returns here to accept
 * so the link works before the clicker has an account, which is the whole point
 * of sharing by link.
 */

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { App as AntdApp, Button, Spin } from "antd";
import { api, errText } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useSync } from "@/store/sync";
import { ListIcon } from "@/components/ListIcon";

type Preview = Awaited<ReturnType<typeof api.invitePreview>>;

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { user, loading: authLoading } = useAuth();
  const pull = useSync((s) => s.pull);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .invitePreview(token)
      .then((p) => !cancelled && setPreview(p))
      .catch((e) => !cancelled && setLoadError(errText(e, "This link isn't valid")));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const accept = useCallback(async () => {
    setAccepting(true);
    try {
      const { projectId } = await api.inviteAccept(token);
      // Pull so the newly-shared list and its tasks are in the store before we
      // navigate — otherwise the list page opens on a list the client doesn't
      // know about yet and shows "not found" for a beat.
      await pull();
      message.success("You're in");
      router.replace(`/lists?list=${projectId}`);
    } catch (e) {
      message.error(errText(e, "Couldn't accept the invitation"));
      setAccepting(false);
    }
  }, [token, pull, router, message]);

  const dead = loadError || (preview && (preview.revoked || preview.expired));

  return (
    <div className="login-shell">
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "#0d0d13",
          border: "1px solid #1c1c26",
          borderRadius: 20,
          padding: "32px 28px",
          textAlign: "center",
        }}
      >
        {!preview && !loadError ? (
          <Spin size="large" />
        ) : dead ? (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 8px" }}>
              This link isn&apos;t usable
            </h1>
            <p style={{ color: "#8f8fa2", fontSize: 14, margin: "0 0 22px" }}>
              {loadError
                ? loadError
                : preview?.revoked
                  ? "The owner has turned this link off."
                  : "This link has expired."}
            </p>
            <Button onClick={() => router.replace(user ? "/today" : "/login")}>
              {user ? "Back to Kuma" : "Go to sign in"}
            </Button>
          </>
        ) : preview ? (
          <>
            <div
              style={{
                width: 56,
                height: 56,
                margin: "0 auto 16px",
                borderRadius: 16,
                display: "grid",
                placeItems: "center",
                background: `${preview.color}22`,
                boxShadow: `0 0 0 1px ${preview.color}55`,
              }}
            >
              <ListIcon icon={preview.icon} color={preview.color} size={28} />
            </div>
            <p style={{ color: "#8f8fa2", fontSize: 13, margin: "0 0 4px" }}>
              You&apos;ve been invited to a shared list
            </p>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 6px" }}>
              {preview.listName}
            </h1>
            <p style={{ color: "#8f8fa2", fontSize: 13, margin: "0 0 24px" }}>
              {preview.role === "write" ? "You'll be able to add and edit tasks." : "You'll be able to view its tasks."}
            </p>

            {authLoading ? (
              <Spin />
            ) : user ? (
              <Button type="primary" size="large" block loading={accepting} onClick={accept}>
                Accept invitation
              </Button>
            ) : (
              <>
                <Button
                  type="primary"
                  size="large"
                  block
                  onClick={() => router.push(`/login?next=/invite/${token}`)}
                >
                  Sign in to accept
                </Button>
                <p style={{ color: "#6f6f80", fontSize: 12, marginTop: 12, marginBottom: 0 }}>
                  New to Kuma? You can create an account on the next screen.
                </p>
              </>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
