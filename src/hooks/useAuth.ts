import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { edgeFunctionError } from "../lib/geminiScan";

export interface AuthState {
  session: Session | null;
  loading: boolean;
}

/** Tracks the Supabase auth session and keeps it live across sign-in/out. */
export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading };
}

/**
 * Send a passwordless sign-in email. The email carries BOTH a one-tap magic
 * link and a numeric code. On iOS the installed (home-screen) app has its own
 * storage separate from Safari, and tapping the link opens Safari — so the code
 * path (verifyEmailCode) is what actually signs the installed app in.
 */
export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

/** Verify the emailed sign-in code (works inside the installed app). */
export async function verifyEmailCode(
  email: string,
  token: string,
): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: "email",
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Delete the account and everything behind it, then sign out.
 *
 * Both stores require this before Brick Book can be listed, and neither accepts
 * a support-email flow — it has to happen inside the app. The work is done in
 * the delete-account Edge Function, since removing an auth user needs the
 * service-role key; the confirmation string is checked on both sides so a
 * stray call can't do this on its own.
 *
 * A household shared with other people is NOT deleted — only this person's
 * membership. The books are removed when the last member leaves.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke("delete-account", {
    body: { confirm: "DELETE" },
  });
  // supabase-js reports every non-2xx as the same opaque "non-2xx status code"
  // and leaves the body unread, so the real reason has to be unwrapped.
  if (error) throw new Error(await edgeFunctionError(error));
  await supabase.auth.signOut();
}
