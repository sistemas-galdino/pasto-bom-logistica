// Bootstrap do backend: sobe a API e inicia o agendador (worker).
//
// NOTA DE FUNDAÇÃO: este arquivo já referencia os módulos que serão
// implementados pelos agentes WORKER (worker/scheduler.ts) e API
// (api/server.ts). Os imports/chamadas estão prontos para quando esses
// módulos existirem com as assinaturas combinadas:
//   - worker/scheduler.ts -> export function start(): void
//   - api/server.ts       -> export function buildServer(): FastifyInstance
//                            (ou export async function startServer(): Promise<void>)

import { env } from './config/env.js';
import { log } from './log.js';
import { start as startScheduler } from './worker/scheduler.js';
import { startServer } from './api/server.js';

async function main(): Promise<void> {
  log.info('Iniciando backend Pasto Bom...');

  // Aviso de modo teste de WhatsApp (todos os envios redirecionados).
  if (env.WHATSAPP_NUMERO_TESTE) {
    log.warn(
      `[whatsapp] MODO TESTE ativo: todos os envios serão redirecionados para ${env.WHATSAPP_NUMERO_TESTE}.`,
    );
  }

  // 1) Agendador do worker (poll Órix conforme POLL_CRON).
  startScheduler();
  log.info(`Agendador iniciado (POLL_CRON="${env.POLL_CRON}").`);

  // 2) API HTTP (Fastify) na porta configurada.
  await startServer();
  log.info(`API ouvindo na porta ${env.API_PORT}.`);
}

main().catch((err) => {
  log.error('Falha fatal no bootstrap do backend:', err);
  process.exit(1);
});
