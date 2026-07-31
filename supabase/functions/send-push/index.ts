// Sends a web-push notification to the OTHER party on a site link.
//
// The caller never names a recipient. It passes a link id and an event type;
// this function checks the caller is actually on that link, then works out who
// the counterparty is and notifies their devices. That way a client can't aim a
// notification at an arbitrary user, and can't discover who is on a link it
// doesn't belong to.
//
// VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY / VAPID_SUBJECT are Edge Function
// secrets. The service-role client is used ONLY after the caller's membership
// has been verified with their own token.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type EventKind = "link_requested" | "link_approved" | "entry_shared";

interface Body {
  linkId?: string;
  event?: EventKind;
  /** Short human detail, e.g. "₹70,000 — Advance for steel". Never trusted for
   * routing; it only ever becomes notification body text. */
  detail?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:noreply@brickflow.app";

  // Authorisation is settled before anything else — an unauthorised caller
  // shouldn't learn whether the server is configured, and reordering these lets
  // the access rules be tested independently of the VAPID secrets.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Sign in first." }, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }
  const { linkId, event, detail } = body;
  if (!linkId || !event) return json({ error: "Missing linkId or event." }, 400);

  // 1. Who is calling? Resolved from THEIR token, not from the body.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes } = await asCaller.auth.getUser();
  const callerId = userRes.user?.id;
  if (!callerId) return json({ error: "Sign in first." }, 401);

  // 2. Read the link through the CALLER's client, so RLS decides whether they
  //    may see it at all. A link they aren't on simply returns nothing.
  const { data: link } = await asCaller
    .from("site_links")
    .select("id, household_id, contractor_user_id, contractor_name, status")
    .eq("id", linkId)
    .maybeSingle();
  if (!link) return json({ error: "Not your link." }, 403);

  if (!vapidPublic || !vapidPrivate) {
    return json({ error: "Push is not configured on the server." }, 500);
  }

  // 3. Work out the recipients: everyone on the other side of this link.
  const admin = createClient(url, serviceKey);
  const callerIsContractor = link.contractor_user_id === callerId;

  let recipientIds: string[] = [];
  if (callerIsContractor) {
    const { data: members } = await admin
      .from("household_members")
      .select("user_id")
      .eq("household_id", link.household_id);
    recipientIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  } else {
    recipientIds = [link.contractor_user_id];
  }
  recipientIds = recipientIds.filter((id) => id !== callerId);
  if (recipientIds.length === 0) return json({ sent: 0 });

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .in("user_id", recipientIds);
  if (!subs?.length) return json({ sent: 0 });

  const who = callerIsContractor ? link.contractor_name || "Your contractor" : "The site owner";
  const TITLES: Record<EventKind, string> = {
    link_requested: "A contractor wants to link",
    link_approved: "You're linked to the site",
    entry_shared: `${who} shared an entry`,
  };
  const payload = JSON.stringify({
    title: TITLES[event] ?? "Brick Flow",
    body: detail ? String(detail).slice(0, 140) : "Open Brick Flow to see it.",
    tag: `${event}:${linkId}`,
    url: "/",
  });

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        // 404/410 mean the browser threw the subscription away (reinstall,
        // cleared data). Prune rather than retrying it forever.
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint);
      }
    }),
  );

  if (dead.length) {
    await admin.from("push_subscriptions").delete().in("endpoint", dead);
  }

  return json({ sent, pruned: dead.length });
});
