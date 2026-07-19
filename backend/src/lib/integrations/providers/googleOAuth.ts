/**
 * Shared Google OAuth2 plumbing.
 *
 * Google Calendar and Google Tasks run the same authorization-code dance and
 * differ only in scope and API host. This was duplicated across both providers;
 * consolidating it means a fix to the token exchange — the part with real
 * security consequences — lands in one place rather than being applied to one
 * provider and forgotten in the other.
 */

// Side-effect import: guarantees dotenv has populated process.env before the
// module-level reads below. Without it the bundled build can evaluate this file
// before core/config runs, silently leaving OAuth "unconfigured" in production
// even though the credentials are present in .env.
import "@/core/config";

export const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
export const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
export const HAS_OAUTH = !!(CLIENT_ID && CLIENT_SECRET);

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * `openid email` lets us learn WHICH Google account was just connected, so the
 * same user can attach several accounts and tell them apart. The identity comes
 * back in the id_token of the token exchange — no extra API call, and no access
 * to anything beyond the address itself.
 */
export const IDENTITY_SCOPES = "openid email";

/**
 * Where Google sends the browser after consent — must EXACTLY match a redirect
 * URI registered on the OAuth client in Google Cloud Console.
 */
export function redirectUriFor(providerId: string): string {
  const base =
    process.env.OAUTH_REDIRECT_BASE ?? `http://localhost:${process.env.SERVER_PORT ?? 20001}`;
  return `${base}/integrations/${providerId}/callback`;
}

async function postForm(body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = (json.error_description ?? json.error ?? res.statusText) as string;
    throw new Error(`Google auth failed (${res.status}): ${detail}`);
  }
  return json;
}

export function authUrlFor(providerId: string, scope: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    redirect_uri: redirectUriFor(providerId),
    response_type: "code",
    // Offline access + forced consent is what makes Google return a refresh
    // token; without `prompt=consent` a re-authorisation returns none and the
    // connection silently can't be renewed.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCode(
  providerId: string,
  code: string,
): Promise<{ refresh_token?: string; id_token?: string }> {
  return postForm({
    code,
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
    redirect_uri: redirectUriFor(providerId),
    grant_type: "authorization_code",
  });
}

export async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  const json = await postForm({
    refresh_token: refreshToken,
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  const token = json.access_token as string | undefined;
  if (!token) throw new Error("Google did not return an access token");
  return token;
}

/**
 * Read the account email out of the id_token.
 *
 * The token came straight from Google's token endpoint over TLS, so we decode
 * the payload for its claim rather than verifying a signature we already trust
 * the transport for; it is used only as a local label and dedupe key, never as
 * an authorization decision.
 */
export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const email = typeof json.email === "string" ? json.email.trim().toLowerCase() : null;
    return email || null;
  } catch {
    return null;
  }
}

/** A GET against a Google API with a bearer token, with readable failures. */
export async function googleGet<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Google API ${res.status}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** The message shown when Google withholds a refresh token on reconnect. */
export const NO_REFRESH_TOKEN_HELP =
  "Google didn't return a refresh token. Remove Bearry under your Google Account → Security → Third-party access, then reconnect.";
