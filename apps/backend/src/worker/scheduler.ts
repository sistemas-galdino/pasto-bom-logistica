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
import {
  pollOnce,
  registrarSincronizacao,
  varreduraProfundaOnce,
} from './poll.js';
import { reconciliarOnce } from './reconciliar.js';
import { env } from '../config/env.js';
import { log } from '../log.js';

// Reexport para uso manual.
export { pollOnce, varreduraProfundaOnce } from './poll.js';
export { reconciliarOnce } from './reconciliar.js';

let tarefa: cron.ScheduledTask | null = null;
let executando = false;

let tarefaReconciliacao: cron.ScheduledTask | null = null;
let reconciliando = false;

let tarefaVarredura: cron.ScheduledTask | null = null;
let varrendo = false;

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
 * Ciclo de reconciliação protegido. Tem o próprio lock: um ciclo longo não pode
 * empilhar com o seguinte, e ele NÃO compartilha o lock do poll — são rotinas
 * independentes e podem se sobrepor sem problema (uma lê, a outra escreve em
 * pedidos distintos; ambas são idempotentes).
 */
async function tickReconciliacao(): Promise<void> {
  if (reconciliando) {
    log.warn(
      '[scheduler] Reconciliação anterior ainda em execução; pulando este ciclo.',
    );
    return;
  }
  reconciliando = true;
  try {
    await reconciliarOnce();
  } catch (err) {
    log.error('[scheduler] Erro inesperado na reconciliação (contido):', err);
  } finally {
    reconciliando = false;
  }
}

/**
 * Varredura profunda protegida. Lock próprio: são ~23 chamadas à Órix e pode
 * demorar minutos; sobrepor duas seria bater no servidor à toa.
 *
 * Ela NÃO pode derrubar o tick rápido: falha aqui é logada e tentada de novo no
 * dia seguinte, enquanto o poll de 5 min segue independente.
 */
async function tickVarredura(): Promise<void> {
  if (varrendo) {
    log.warn(
      '[scheduler] Varredura profunda anterior ainda em execução; pulando este ciclo.',
    );
    return;
  }
  varrendo = true;
  try {
    const resultado = await varreduraProfundaOnce();
    await registrarSincronizacao(resultado, 'varredura_profunda');
  } catch (err) {
    log.error('[scheduler] Erro inesperado na varredura profunda (contido):', err);
    await registrarSincronizacao(
      { ok: false, janelas: 0, itens: 0, pedidos: 0 },
      'varredura_profunda',
    ).catch(() => {});
  } finally {
    varrendo = false;
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

  // --- Reconciliação (independente do poll) ---
  const cronReconciliar = env.RECONCILIAR_CRON;
  if (!cron.validate(cronReconciliar)) {
    log.error(
      `[scheduler] RECONCILIAR_CRON inválido ("${cronReconciliar}"); ` +
        'reconciliação NÃO iniciada. Pedidos cancelados no Órix continuarão no painel.',
    );
    return;
  }

  tarefaReconciliacao = cron.schedule(cronReconciliar, () => {
    void tickReconciliacao();
  });

  log.info(
    `[scheduler] Reconciliação com o Órix ativa (cron="${cronReconciliar}").`,
  );

  // --- Varredura profunda (independente das outras duas) ---
  const cronVarredura = env.VARREDURA_CRON;
  if (!cron.validate(cronVarredura)) {
    log.error(
      `[scheduler] VARREDURA_CRON inválido ("${cronVarredura}"); varredura ` +
        'profunda NÃO iniciada. Pedido antigo que entrar no gatilho não aparecerá no quadro.',
    );
    return;
  }

  tarefaVarredura = cron.schedule(cronVarredura, () => {
    void tickVarredura();
  });

  log.info(
    `[scheduler] Varredura profunda ativa (cron="${cronVarredura}").`,
  );
}

/** Para o agendador (útil para testes / shutdown gracioso). */
export function stop(): void {
  if (tarefa) {
    tarefa.stop();
    tarefa = null;
    log.info('[scheduler] Agendador de polling parado.');
  }
  if (tarefaReconciliacao) {
    tarefaReconciliacao.stop();
    tarefaReconciliacao = null;
    log.info('[scheduler] Reconciliação parada.');
  }
  if (tarefaVarredura) {
    tarefaVarredura.stop();
    tarefaVarredura = null;
    log.info('[scheduler] Varredura profunda parada.');
  }
}
