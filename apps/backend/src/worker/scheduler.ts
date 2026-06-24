// [AGENTE WORKER] Agendador do polling com node-cron.
//
// - start(): registra o cron com a expressão POLL_CRON (default "*/5 * * * *")
//   e dispara pollOnce() a cada tick.
// - Reexporta pollOnce para uso manual (CLI/integração/teste).
//
// Garantias de robustez:
//  - pollOnce() já trata falhas da Órix internamente (circuit-breaker), mas o
//    agendador ainda envolve a chamada em try/catch para que NENHUM erro
//    inesperado derrube o processo.
//  - Lock simples evita sobreposição de ticks (se um tick demorar mais que o
//    intervalo do cron, o próximo é ignorado até o atual terminar).

import cron from 'node-cron';
import { pollOnce, registrarSincronizacao } from './poll.js';
import { env } from '../config/env.js';
import { log } from '../log.js';

// Reexport para uso manual.
export { pollOnce } from './poll.js';

let tarefa: cron.ScheduledTask | null = null;
let executando = false;

/** Executa um tick protegido (sem nunca lançar / derrubar o processo). */
async function tickProtegido(): Promise<void> {
  if (executando) {
    log.warn('[scheduler] Tick anterior ainda em execução; pulando este ciclo.');
    return;
  }
  executando = true;
  try {
    const resultado = await pollOnce();
    await registrarSincronizacao(resultado);
  } catch (err) {
    // pollOnce não deveria lançar, mas garantimos a contenção aqui.
    log.error('[scheduler] Erro inesperado no tick de polling (contido):', err);
    // Registra a falha no heartbeat (sem deixar um erro aqui derrubar o tick).
    await registrarSincronizacao({
      ok: false,
      janelas: 0,
      itens: 0,
      pedidos: 0,
    }).catch(() => {});
  } finally {
    executando = false;
  }
}

/**
 * Inicia o agendador. Idempotente: se já houver tarefa registrada, não duplica.
 */
export function start(): void {
  const expressao = env.POLL_CRON;

  if (!cron.validate(expressao)) {
    log.error(
      `[scheduler] POLL_CRON inválido ("${expressao}"); agendador NÃO iniciado.`,
    );
    return;
  }

  if (tarefa) {
    log.warn('[scheduler] start() chamado novamente; agendador já ativo.');
    return;
  }

  tarefa = cron.schedule(expressao, () => {
    void tickProtegido();
  });

  log.info(`[scheduler] Agendador de polling ativo (cron="${expressao}").`);
}

/** Para o agendador (útil para testes / shutdown gracioso). */
export function stop(): void {
  if (tarefa) {
    tarefa.stop();
    tarefa = null;
    log.info('[scheduler] Agendador de polling parado.');
  }
}
