// [FUNDAÇÃO] Cliente Supabase do frontend (chave ANON, a partir de VITE_*).

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Aviso em dev — o app monta, mas Auth não funcionará sem env.
  // eslint-disable-next-line no-console
  console.warn(
    '[lib/supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ausentes. ' +
      'Configure apps/frontend/.env.',
  );
}

export const supabase = createClient(url ?? '', anonKey ?? '');
