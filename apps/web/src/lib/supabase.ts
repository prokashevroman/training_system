import type { Database } from "@training/db-types";
import { createClient } from "@supabase/supabase-js";

/**
 * The browser Supabase client.
 *
 * Only the anon key is ever used here. Every table is protected by RLS, so
 * this client can read and write exactly the signed-in user's own rows and
 * nothing else — the service-role key exists only in the workbook importer,
 * which runs on a trusted machine.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill it in — `supabase status` prints both.",
  );
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
