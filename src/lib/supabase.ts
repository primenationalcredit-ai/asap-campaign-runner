import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side admin client. Uses the service-role key, bypasses RLS.
 * NEVER import this from a client component.
 */
let _admin: SupabaseClient | null = null;
export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase admin credentials missing. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars."
    );
  }
  _admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}
