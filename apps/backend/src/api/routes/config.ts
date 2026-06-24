// [AGENTE API] Rota de configuração pública para o frontend.
//
//   GET /api/config -> ConfigResponse { statusGatilho, templates }
//   GET /api/sync   -> SyncStatusResponse { ultimoSucesso, sucesso, pedidos }
//
// Os valores vêm de sync_state (chaves 'status_gatilho', 'templates', 'sync_status').

import type { FastifyInstance } from 'fastify';

import type { ConfigResponse, SyncStatusResponse } from '@pastobom/shared';

import { supabase } from '../../db/supabase.js';
import { log } from '../../log.js';

async function lerSyncState<T>(chave: string, fallback: T): Promise<T> {
  const { data, error } = await supabase
    .from('sync_state')
    .select('valor')
    .eq('chave', chave)
    .maybeSingle<{ valor: T }>();

  if (error) {
    log.warn(`[GET /config] falha ao ler sync_state '${chave}': ${error.message}`);
    return fallback;
  }
  return data?.valor ?? fallback;
}

export async function configRoutes(app: FastifyInstance): Promise<void> {
  // GET /config
  app.get('/config', async (_req, reply) => {
    const statusGatilho = await lerSyncState<string[]>('status_gatilho', []);
    const templates = await lerSyncState<Record<string, string>>(
      'templates',
      {},
    );

    const resposta: ConfigResponse = { statusGatilho, templates };
    return reply.send(resposta);
  });

  // GET /sync — última sincronização com o Órix (heartbeat do worker).
  app.get('/sync', async (_req, reply) => {
    const s = await lerSyncState<{
      ultimoSucesso?: string | null;
      sucesso?: boolean;
      pedidos?: number | null;
    }>('sync_status', {});

    const resposta: SyncStatusResponse = {
      ultimoSucesso: s.ultimoSucesso ?? null,
      sucesso: s.sucesso ?? false,
      pedidos: s.pedidos ?? null,
    };
    return reply.send(resposta);
  });
}
