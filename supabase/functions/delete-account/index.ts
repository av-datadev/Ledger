// Deletes the caller's account and every trace of their data.
//
// Required by both stores before Brick Flow can be listed: Google Play's User
// Data policy (in force since 2024-04-15) and Apple guideline 5.1.1(v) both
// oblige any app that can create an account to let a person delete it from
// inside the app. Deactivating or "freezing" does not count.
//
// A client cannot delete its own auth user — that needs the service-role key,
// which must never reach a device. So the caller is resolved from THEIR OWN
// token first (never from the body), and only then does the admin client act,
// and only on rows belonging to that resolved id.
//
// The household rule is the one real judgement call here: leaving a household
// must not destroy the books of the people still in it. So membership is always
// removed, and the household and its data are deleted only when the person
// leaving was the LAST member. Three people share the live household today;
// one of them deleting their account has to leave the other two untouched.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Typed into the app before the button works, and required here too, so no
 * stray or replayed POST can ever delete an account on its own. */
const CONFIRM_PHRASE = "DELETE";

/** Every table hanging off households.id, ordered children-first. Deleting the
 * household row without these would either fail on a foreign key or silently
 * orphan rows, depending on how each constraint was declared — doing it
 * explicitly means the outcome doesn't depend on that. */
const HOUSEHOLD_CHILD_TABLES = [
  "entries",
  "categories",
  "people",
  "settings",
  "boq_items",
  "stock_items",
  "stock_moves",
  "attachments",
] as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Remove every object under a storage prefix. Storage has no recursive delete,
 * so the folder is listed and the names are removed in one call. */
async function purgeStorageFolder(
  admin: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<number> {
  const { data, error } = await admin.storage.from(bucket).list(prefix, {
    limit: 1000,
  });
  if (error || !data?.length) return 0;
  const paths = data.map((o: { name: string }) => `${prefix}/${o.name}`);
  await admin.storage.from(bucket).remove(paths);
  return paths.length;
}

/** Delete a site link, the shared rows on it, and their proof photos. */
async function purgeLink(admin: SupabaseClient, linkId: string): Promise<void> {
  await purgeStorageFolder(admin, "shared-proofs", linkId);
  await admin.from("shared_entries").delete().eq("link_id", linkId);
  await admin.from("site_links").delete().eq("id", linkId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Sign in first." }, 401);

  let body: { confirm?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }
  if (body.confirm !== CONFIRM_PHRASE) {
    return json({ error: "Deletion was not confirmed." }, 400);
  }

  // Who is calling? Resolved from their own token — the body never names a user.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes } = await asCaller.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return json({ error: "Sign in first." }, 401);

  const admin = createClient(url, serviceKey);
  const removed = {
    households: 0,
    householdsLeft: 0,
    links: 0,
    photos: 0,
  };

  try {
    // 1. Links where this person is the contractor. Their shared rows and proof
    //    photos go with them; the household on the other side keeps its own books.
    const { data: asContractor } = await admin
      .from("site_links")
      .select("id")
      .eq("contractor_user_id", userId);
    for (const link of asContractor ?? []) {
      await purgeLink(admin, link.id as string);
      removed.links++;
    }

    // 2. Households. Membership always goes; the data goes only if nobody is left.
    const { data: memberships } = await admin
      .from("household_members")
      .select("household_id")
      .eq("user_id", userId);

    for (const m of memberships ?? []) {
      const householdId = m.household_id as string;
      await admin
        .from("household_members")
        .delete()
        .eq("household_id", householdId)
        .eq("user_id", userId);

      const { count } = await admin
        .from("household_members")
        .select("user_id", { count: "exact", head: true })
        .eq("household_id", householdId);

      if ((count ?? 0) > 0) {
        // Someone else still uses this ledger. Leave it exactly as it is.
        removed.householdsLeft++;
        continue;
      }

      // Last one out: the books are now unreachable by anyone, so remove them
      // rather than leaving orphaned rows nobody can read or delete.
      removed.photos += await purgeStorageFolder(
        admin,
        "attachments",
        householdId,
      );

      const { data: houseLinks } = await admin
        .from("site_links")
        .select("id")
        .eq("household_id", householdId);
      for (const link of houseLinks ?? []) {
        await purgeLink(admin, link.id as string);
        removed.links++;
      }

      for (const table of HOUSEHOLD_CHILD_TABLES) {
        const { error } = await admin
          .from(table)
          .delete()
          .eq("household_id", householdId);
        if (error) throw new Error(`${table}: ${error.message}`);
      }

      const { error: hhErr } = await admin
        .from("households")
        .delete()
        .eq("id", householdId);
      if (hhErr) throw new Error(`households: ${hhErr.message}`);
      removed.households++;
    }

    // 3. Rows keyed straight to the user.
    await admin.from("shared_entries").delete().eq("author_user_id", userId);
    await admin.from("push_subscriptions").delete().eq("user_id", userId);
    await admin.from("contractor_profiles").delete().eq("user_id", userId);
  } catch (err) {
    // Stop before removing the login. The person keeps their account and can
    // retry, which is far better than an auth user deleted out from under data
    // that no one can now reach.
    const message = err instanceof Error ? err.message : String(err);
    return json(
      { error: `Could not delete your data, so nothing was removed from your login. ${message}` },
      500,
    );
  }

  // 4. The login itself, last — everything above is retryable while it exists.
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    return json({ error: `Your data was removed but the login could not be deleted: ${delErr.message}` }, 500);
  }

  return json({ deleted: true, ...removed });
});
