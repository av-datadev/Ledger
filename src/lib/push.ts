// Web-push subscription management.
//
// A notification matters here because both sides act on information the other
// one entered: an owner needs to know a contractor asked to link, and a
// contractor needs to know a figure moved. Without this, either only finds out
// the next time they happen to open the app.
//
// Nothing about the ledger travels in a push payload — only a short line of
// text and a tag. The device fetches the real data itself once opened.

import { supabase } from "./supabase";

/** Public half of the VAPID pair. Safe to ship — the private half is an Edge
 * Function secret and never reaches the browser. */
export const VAPID_PUBLIC_KEY =
  "BK_6pwKtJ1yAEYmjKRF1bNg9zEpHNTk9ht1oTTjQFwuo-jMg7-o1n6J2gk7Mmsn1V5sgNliF9-PQYqdXfeRjkL4";

export type PushState =
  | "unsupported"
  | "denied"
  | "off"
  | "on";

// Backed by an explicit ArrayBuffer: pushManager.subscribe wants a
// BufferSource over a real ArrayBuffer, and a bare `new Uint8Array(n)` is typed
// as ArrayBufferLike (which admits SharedArrayBuffer) and is rejected.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** iOS only exposes push to an app added to the home screen, so an in-browser
 * tab there genuinely cannot subscribe — worth saying rather than failing. */
export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function pushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

/**
 * Ask for permission, subscribe, and store the endpoint against this user.
 * Returns the resulting state so the caller can explain a refusal rather than
 * silently doing nothing.
 */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return permission === "denied" ? "denied" : "off";
  }

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));

  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error("Sign in before turning on notifications.");

  const json = sub.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("This browser gave an incomplete push subscription.");
  }

  // Endpoint is the primary key: re-subscribing on the same device updates the
  // row instead of piling up duplicates that would each get a notification.
  const { error } = await supabase.from("push_subscriptions").upsert({
    endpoint: json.endpoint,
    user_id: uid,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent.slice(0, 200),
  });
  if (error) throw error;

  return "on";
}

/** Stop notifications on this device and drop its endpoint from the server. */
export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  }
  return "off";
}

/**
 * Ask the server to notify the OTHER party on a link.
 *
 * Deliberately fire-and-forget: a failed notification must never block or
 * fail the action that triggered it — sharing a payment still succeeded even
 * if the other phone can't be reached.
 */
export function notifyCounterparty(
  linkId: string,
  event: "link_requested" | "link_approved" | "entry_shared",
  detail?: string,
): void {
  void supabase.functions
    .invoke("send-push", { body: { linkId, event, detail } })
    .catch(() => {
      /* best effort */
    });
}
