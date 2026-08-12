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
import { deveVarrer } from '@pastobom/shared';
import {
  pollOnce,
  registrarSincronizacao,
  varreduraProfundaOnce,
} from './poll.js';
import { reconciliarOnce } from './reconciliar.js';
import { supabase } from '../db/supabase.js';
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
 * Lê o heartbeat da varredura profunda. Em erro de leitura devolve null, o que
 * faz a varredura rodar: perder uma varredura é pior que rodar uma a mais (a
 * ingestão é idempotente).
 */
async function lerVarreduraProfunda(): Promise<{
  ultimoSucesso?: string | null;
} | null> {
  const { data, error } = await supabase
    .from('sync_state')
    .select('valor')
    .eq('chave', 'varredura_profunda')
    .maybeSingle();
  if (error) {
    log.warn(
      `[scheduler] Falha ao ler o estado da varredura profunda: ${error.message}`,
    );
    return null;
  }
  return (data?.valor as { ultimoSucesso?: string | null } | undefined) ?? null;
}

/**
 * Verificação horária da varredura profunda: roda só se faz mais de
 * VARREDURA_INTERVALO_HORAS que não roda com sucesso.
 *
 * Por que por intervalo, e não em horário fixo: nem o Órix nem o servidor ficam
 * de pé de madrugada. Um cron noturno dispararia, abortaria na primeira
 * sub-janela e só tentaria de novo no dia seguinte, no mesmo horário ruim — a
 * varredura nunca completaria, e em silêncio. Com intervalo, a primeira
 * oportunidade depois do prazo serve, seja qual for a janela em que o Órix está
 * no ar.
 *
 * Tentar de hora em hora com o Órix fora é barato: o circuit-breaker aborta na
 * primeira sub-janela que falhar, então custa ~1 chamada, não 23.
 *
 * Lock próprio: a varredura leva minutos e não pode empilhar. E ela NÃO derruba
 * o tick rápido — o poll de 5 min segue independente.
 */
async function tickVarredura(): Promise<void> {
  if (varrendo) {
    log.warn(
      '[scheduler] Varredura profunda anterior ainda em execução; pulando este ciclo.',
    );
    return;
  }

  const estado = await lerVarreduraProfunda();
  if (
    !deveVarrer({
      ultimoSucesso: estado?.ultimoSucesso ?? null,
      agora: new Date().toISOString(),
      horasIntervalo: env.VARREDURA_INTERVALO_HORAS,
    })
  ) {
    // debug, não info: esta verificação roda de hora em hora e na maioria das
    // vezes não faz nada — em info, afogaria o log do worker.
    log.debug(
      `[scheduler] Varredura profunda ainda no prazo (último sucesso: ` +
        `${estado?.ultimoSucesso ?? 'nunca'}); pulando.`,
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
  const cronVarredura = env.VARREDURA_CHECK_CRON;
  if (!cron.validate(cronVarredura)) {
    log.error(
      `[scheduler] VARREDURA_CHECK_CRON inválido ("${cronVarredura}"); varredura ` +
        'profunda NÃO iniciada. Pedido antigo que entrar no gatilho não aparecerá no quadro.',
    );
    return;
  }

  tarefaVarredura = cron.schedule(cronVarredura, () => {
    void tickVarredura();
  });

  log.info(
    `[scheduler] Varredura profunda ativa (verifica com cron="${cronVarredura}", ` +
      `roda a cada ${env.VARREDURA_INTERVALO_HORAS}h).`,
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
