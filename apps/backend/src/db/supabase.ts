// [FUNDAÇÃO] Cliente Supabase com SERVICE ROLE KEY (ignora RLS).
// Usado por worker, ingestão e rotas server-side.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

export const supabase: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
