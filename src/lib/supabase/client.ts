import { createBrowserClient } from "@supabase/ssr";

/**
 * Creates a Supabase client for client-side components using @supabase/ssr.
 * Only uses public environment variables (URL and Anon key).
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required"
    );
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

