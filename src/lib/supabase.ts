import { createClient } from "@supabase/supabase-js";

// Brick Flow's Supabase project. These are the PUBLISHABLE credentials — they
// are meant to ship in client code; access is protected by login + row-level
// security, not by hiding the key. (Project: mttdiyovwuduyriwylfs.)
const SUPABASE_URL = "https://mttdiyovwuduyriwylfs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_aix5L9BO2ix7bzX3AvDCsw_1BOvkMBi";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // completes the email magic-link redirect
  },
});
