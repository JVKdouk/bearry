/**
 * Shared Microsoft identity-platform OAuth2 plumbing (Azure AD v2 endpoints).
 *
 * Mirrors googleOAuth.ts: the authorization-code dance, refresh-token exchange
 * and a small Graph GET helper, kept in one place so the token exchange — the
 * part with real security consequences — lives once. Microsoft differs from
 * Google in two ways that bite if forgotten: `offline_access` is the scope that
 * yields a refresh token (not an `access_type` param), and the token endpoint
 * wants the `scope` echoed on both the code exchange and the refresh.
 */

// Side-effect import: guarantee dotenv has populated process.env before the
// module-level reads below (see googleOAuth.ts for why this matters in the
// bundled build).
import "@/core/config";

export const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
export const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
/**
 * "common" accepts both work/school and personal Microsoft accounts. Override
 * with a specific directory (tenant) id to lock the app to one organisation.
 */
export const TENANT = process.env.MICROSOFT_TENANT || "common";
export const HAS_OAUTH = !!(CLIENT_ID && CLIENT_SECRET);

const AUTHORIZE_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;

/**
 * `offline_access` is what returns a refresh token; `openid email profile` tell
 * us which account connected (for a per-account label + dedupe key) without any
 * extra call — the claim rides back in the id_token.
 */
export const IDENTITY_SCOPES = "openid email profile offline_access";

/** Where Microsoft returns the browser — must EXACTLY match a redirect URI on
 *  the Azure app registration. */
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
    throw new Error(`Microsoft auth failed (${res.status}): ${String(detail).slice(0, 200)}`);
  }
  return json;
}

export function authUrlFor(providerId: string, scope: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    redirect_uri: redirectUriFor(providerId),
    response_type: "code",
    response_mode: "query",
    // Microsoft accepts only ONE prompt value (login|none|consent|select_account)
    // — a space-separated pair like Google's is AADSTS90023. `select_account`
    // shows the chooser so a second account can be added; the refresh token still
    // comes back because it's tied to the `offline_access` scope, not to prompt.
    prompt: "select_account",
    scope,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCode(
  providerId: string,
  code: string,
  scope: string,
): Promise<{ refresh_token?: string; id_token?: string }> {
  return postForm({
    code,
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
    redirect_uri: redirectUriFor(providerId),
    grant_type: "authorization_code",
    scope,
  });
}

export async function accessTokenFromRefresh(refreshToken: string, scope: string): Promise<string> {
  const json = await postForm({
    refresh_token: refreshToken,
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
    grant_type: "refresh_token",
    scope,
  });
  const token = json.access_token as string | undefined;
  if (!token) throw new Error("Microsoft did not return an access token");
  return token;
}

/**
 * The account address from the id_token. Decoded, not verified — the token came
 * straight from Microsoft's token endpoint over TLS, and it's used only as a
 * local label and dedupe key, never for an authorization decision.
 */
export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const raw = json.email ?? json.preferred_username ?? json.upn;
    const email = typeof raw === "string" ? raw.trim().toLowerCase() : null;
    return email || null;
  } catch {
    return null;
  }
}

/** A GET against Microsoft Graph with a bearer token, with readable failures. */
export async function graphGet<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Microsoft Graph ${res.status}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export const NO_REFRESH_TOKEN_HELP =
  "Microsoft didn't return a refresh token. Remove Kuma at https://microsoft.com/consent, then reconnect.";
