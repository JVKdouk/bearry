"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  App as AntdApp,
  Button,
  Card,
  Form,
  Input,
  Segmented,
  Typography,
} from "antd";
import { LockOutlined } from "@ant-design/icons";
import { KumaLockup } from "@/components/Brand";
import { useAuth } from "@/store/auth";
import { api, ApiError, isOfflineError } from "@/lib/api";

const { Text } = Typography;

function LoginInner() {
  const { message } = AntdApp.useApp();
  const { user, loading, login, signup } = useAuth();
  const params = useSearchParams();
  // A share link sends people here with ?next=/invite/<token>; after signing in
  // they go back to accept rather than being dropped on Today. Only same-origin
  // paths are honoured, so the param can't be used to bounce someone offsite.
  const rawNext = params.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/today";
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  // Assume closed until the server says otherwise, so the signup tab never
  // flashes into view on a slow connection and then vanishes.
  const [signupsOpen, setSignupsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .authConfig()
      .then((c) => {
        if (!cancelled) setSignupsOpen(c.signupsOpen);
      })
      .catch(() => {
        /* offline or unreachable: leave signup hidden, login still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // If registration closes while someone is sitting on the signup tab, put them
  // back on login rather than leaving a form that can only fail.
  useEffect(() => {
    if (!signupsOpen && mode === "signup") setMode("login");
  }, [signupsOpen, mode]);

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, router, next]);

  async function onFinish(values: {
    email: string;
    password: string;
    first_name?: string;
  }) {
    setSubmitting(true);
    try {
      if (mode === "signup") {
        await signup(values.email, values.password, values.first_name);
      } else {
        await login(values.email, values.password);
      }
      router.replace(next);
    } catch (err) {
      // Signing in is the one thing that genuinely can't happen offline — it
      // needs the server to verify the password and unwrap the key. Say that,
      // instead of a vague "something went wrong" the user might read as a
      // wrong password.
      const msg = isOfflineError(err)
        ? "You're offline — signing in needs a connection. Once you're back, your saved work is still here."
        : err instanceof ApiError
          ? err.message
          : "Something went wrong";
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <Card
        style={{ width: 400, maxWidth: "100%" }}
        styles={{ body: { padding: "clamp(20px, 5vw, 28px)" } }}
      >
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
            <KumaLockup height={44} />
          </div>
          <Text type="secondary">Your calm ADHD command center</Text>
        </div>

        {signupsOpen ? (
          <Segmented
            block
            value={mode}
            onChange={(v) => setMode(v as "login" | "signup")}
            options={[
              { label: "Log in", value: "login" },
              { label: "Sign up", value: "signup" },
            ]}
            style={{ marginBottom: 20 }}
          />
        ) : (
          <Text
            type="secondary"
            style={{ display: "block", textAlign: "center", fontSize: 12.5, marginBottom: 20 }}
          >
            New sign-ups are closed for now.
          </Text>
        )}

        <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
          {mode === "signup" && (
            <Form.Item name="first_name" label="First name">
              <Input placeholder="Optional" size="large" />
            </Form.Item>
          )}
          <Form.Item
            name="email"
            label="Email"
            rules={[{ required: true, type: "email", message: "Enter a valid email" }]}
          >
            <Input placeholder="you@example.com" size="large" autoComplete="email" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Password"
            rules={[
              { required: true, message: "Enter your password" },
              mode === "signup"
                ? { min: 8, message: "At least 8 characters" }
                : {},
            ]}
          >
            <Input.Password
              placeholder="••••••••"
              size="large"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            block
            loading={submitting}
          >
            {mode === "signup" ? "Create account" : "Log in"}
          </Button>
        </Form>

        <div style={{ textAlign: "center", marginTop: 16 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <LockOutlined /> End-to-end field encryption on the server
          </Text>
        </div>
      </Card>
    </div>
  );
}

/**
 * useSearchParams (for ?next=) makes this a client-bailout page, which Next
 * requires wrapped in Suspense so the shell can prerender. The fallback is a
 * plain centred spinner rather than nothing, so a slow chunk doesn't flash an
 * empty screen.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-shell" />}>
      <LoginInner />
    </Suspense>
  );
}
