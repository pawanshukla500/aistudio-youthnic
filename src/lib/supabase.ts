import { createClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { firebaseAuth } from "./firebase";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "Supabase client configuration is incomplete. Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
  );
}

/**
 * Firebase remains the identity/session source of truth. Supabase receives the
 * current Firebase ID token on every request and enforces organization access
 * with PostgreSQL RLS; no second browser auth session is created.
 */
const supabaseFunctionsUrl =
  import.meta.env.VITE_SUPABASE_FUNCTIONS_URL?.trim() ||
  "https://functions-production-b062.up.railway.app";

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  accessToken: async () => firebaseAuth.currentUser?.getIdToken(false) ?? null,
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

if (supabaseFunctionsUrl) {
  try {
    (supabase as unknown as { functionsUrl: URL }).functionsUrl = new URL(supabaseFunctionsUrl);
  } catch {
    // Keep standard gateway URL if parsing fails
  }
}
