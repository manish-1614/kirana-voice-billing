/**
 * Kirana Voice Billing — Server-Side Supabase Client (Service Role)
 * 
 * Bypasses RLS to execute trusted database writes from server.ts and tool handlers.
 * Never exposed to the browser bundle.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function isServerSupabaseConfigured(): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return Boolean(
    supabaseUrl &&
    serviceRoleKey &&
    !supabaseUrl.includes('your-project-ref') &&
    !serviceRoleKey.includes('your-service-role-key')
  );
}

let serverClientInstance: SupabaseClient | null = null;

export function getServerSupabase(): SupabaseClient | null {
  if (!isServerSupabaseConfigured()) {
    return null;
  }
  if (!serverClientInstance) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    serverClientInstance = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return serverClientInstance;
}
