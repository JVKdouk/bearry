/**
 * Browser-side notification plumbing.
 *
 * Push has four independent failure points — server keys, browser permission,
 * service worker registration, and the push service — and the user can only see
 * the second. Everything here is written so the UI can say *which* one is
 * missing rather than showing a toggle that silently does nothing.
 */

export type PermissionState = "granted" | "denied" | "default" | "unsupported";

/** What the device currently allows. Distinct from what the server can do. */
export function permissionState(): PermissionState {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Ask for permission.
 *
 * Only ever call this from a real user gesture. Browsers permanently deny
 * prompts that appear unprompted on page load, and a permanent denial can't be
 * undone from the page — the user has to dig through site settings, which in
 * practice means notifications are simply lost for that person forever.
 */
export async function requestPermission(): Promise<PermissionState> {
  if (permissionState() === "unsupported") return "unsupported";
  return (await Notification.requestPermission());
}

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  // Explicitly backed by an ArrayBuffer (not a SharedArrayBuffer), which is
  // what PushManager's BufferSource requires.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface SubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  label?: string;
}

/**
 * Subscribe this device, returning what the server needs to store.
 *
 * Reuses an existing subscription when the browser already has one for our key.
 * Re-subscribing needlessly rotates the endpoint and leaves the old row on the
 * server delivering to nothing.
 */
export async function subscribeDevice(publicKey: string): Promise<SubscriptionPayload | null> {
  if (permissionState() !== "granted") return null;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();

  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      // Required by every browser now: a push that can't show a notification
      // isn't allowed at all.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  return toPayload(subscription);
}

/** Unsubscribe this device from the browser's side. Returns its endpoint. */
export async function unsubscribeDevice(): Promise<string | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return null;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  return endpoint;
}

function toPayload(subscription: PushSubscription): SubscriptionPayload | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  // A subscription missing its keys can't be encrypted to, so storing it would
  // only produce failures later, attributed to the wrong thing.
  if (!json.endpoint || !p256dh || !auth) return null;

  return {
    endpoint: json.endpoint,
    keys: { p256dh, auth },
    label: deviceLabel(),
  };
}

/** A rough, human-recognisable name so a device list means something. */
export function deviceLabel(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const platform = /iPhone|iPad/i.test(ua)
    ? "iOS"
    : /Android/i.test(ua)
      ? "Android"
      : /Mac/i.test(ua)
        ? "Mac"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Device";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /Chrome\//i.test(ua)
      ? "Chrome"
      : /Safari\//i.test(ua)
        ? "Safari"
        : /Firefox\//i.test(ua)
          ? "Firefox"
          : "Browser";
  return `${browser} on ${platform}`;
}
