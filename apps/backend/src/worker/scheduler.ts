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
import {
  registrarSincronizacaoFornecedores,
  sincronizarFornecedoresOnce,
  CHAVE_SYNC as CHAVE_SYNC_FORNECEDORES,
} from './fornecedores.js';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { log } from '../log.js';

// Reexport para uso manual.
export { pollOnce, varreduraProfundaOnce } from './poll.js';
export { reconciliarOnce } from './reconciliar.js';
export { sincronizarFornecedoresOnce } from './fornecedores.js';

let tarefa: cron.ScheduledTask | null = null;
let executando = false;

let tarefaReconciliacao: cron.ScheduledTask | null = null;
let reconciliando = false;

let tarefaVarredura: cron.ScheduledTask | null = null;
let varrendo = false;

let tarefaFornecedores: cron.ScheduledTask | null = null;
let espelhandoFornecedores = false;

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
 * Lê o heartbeat do espelho de fornecedores. Em erro de leitura devolve null, o
 * que faz o espelho rodar: o upsert é idempotente, e o contrário seria deixar o
 * autocomplete envelhecer por causa de uma leitura que falhou.
 */
async function lerEstadoFornecedores(): Promise<{
  ultimoSucesso?: string | null;
} | null> {
  const { data, error } = await supabase
    .from('sync_state')
    .select('valor')
    .eq('chave', CHAVE_SYNC_FORNECEDORES)
    .maybeSingle();
  if (error) {
    log.warn(
      `[scheduler] Falha ao ler o estado do espelho de fornecedores: ${error.message}`,
    );
    return null;
  }
  return (data?.valor as { ultimoSucesso?: string | null } | undefined) ?? null;
}

/**
 * Verificação horária do espelho de fornecedores: roda só se faz mais de
 * FORNECEDORES_INTERVALO_HORAS que não espelha COM SUCESSO.
 *
 * Reaproveita deveVarrer() de propósito — a decisão é literalmente a mesma da
 * varredura profunda ("faz tempo demais desde o último sucesso?") e o mesmo
 * motivo de não usar horário fixo vale aqui: o Órix não fica de pé de
 * madrugada, e são 18 páginas para dar certo em sequência. Com verificação
 * horária, a primeira oportunidade depois do prazo serve.
 *
 * Lock próprio: 18 páginas × até 30 s de timeout passam de uma hora no pior
 * caso, e dois ciclos simultâneos gravariam a mesma coisa duas vezes.
 */
async function tickFornecedores(): Promise<void> {
  if (espelhandoFornecedores) {
    log.warn(
      '[scheduler] Espelho de fornecedores anterior ainda em execução; pulando este ciclo.',
    );
    return;
  }

  const estado = await lerEstadoFornecedores();
  if (
    !deveVarrer({
      ultimoSucesso: estado?.ultimoSucesso ?? null,
      agora: new Date().toISOString(),
      horasIntervalo: env.FORNECEDORES_INTERVALO_HORAS,
    })
  ) {
    // debug e não info, pela mesma razão da varredura: roda de hora em hora e
    // quase sempre não faz nada.
    log.debug(
      `[scheduler] Espelho de fornecedores ainda no prazo (último sucesso: ` +
        `${estado?.ultimoSucesso ?? 'nunca'}); pulando.`,
    );
    return;
  }

  espelhandoFornecedores = true;
  try {
    const resultado = await sincronizarFornecedoresOnce();
    await registrarSincronizacaoFornecedores(resultado);
  } catch (err) {
    log.error(
      '[scheduler] Erro inesperado no espelho de fornecedores (contido):',
      err,
    );
    // Heartbeat de falha: não avança `ultimoSucesso`, então a próxima hora
    // tenta de novo.
    await registrarSincronizacaoFornecedores({
      ok: false,
      paginasTotal: 0,
      paginasLidas: 0,
      registros: 0,
      gravados: 0,
      semCodigo: 0,
    }).catch(() => {});
  } finally {
    espelhandoFornecedores = false;
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

  // --- Espelho de fornecedores (migração 0021) ---
  //
  // POR QUE ESTE BLOCO ESTÁ AQUI EM CIMA, E NÃO NO FIM DA FUNÇÃO:
  // os blocos abaixo (reconciliação e varredura) fazem `return` quando o cron
  // deles é inválido — e um `return` no meio de start() impede TODAS as tarefas
  // seguintes de subirem. Um RECONCILIAR_CRON digitado errado no Easypanel
  // derrubaria o espelho de fornecedores em silêncio, e o autocomplete da
  // reserva ficaria congelado sem ninguém entender por quê.
  //
  // Duas medidas, nos dois sentidos:
  //  1) registramos ANTES desses returns, para que o erro de cron alheio não
  //     leve esta tarefa junto (a guarda de idempotência `if (tarefa)` já
  //     passou, então não há risco de registrar duas vezes);
  //  2) o erro aqui só LOGA — nunca `return` —, para que um
  //     FORNECEDORES_CRON inválido não derrube a reconciliação nem a varredura.
  //
  // A ordem de log muda (fornecedores aparece antes), o comportamento não.
  const cronFornecedores = env.FORNECEDORES_CRON;
  if (!cron.validate(cronFornecedores)) {
    log.error(
      `[scheduler] FORNECEDORES_CRON inválido ("${cronFornecedores}"); espelho de ` +
        'fornecedores NÃO iniciado. O autocomplete da reserva de caminhão vai ' +
        'continuar servindo o cadastro que já está no banco (nada é apagado), ' +
        'mas sem receber fornecedor novo do Órix.',
    );
  } else {
    tarefaFornecedores = cron.schedule(cronFornecedores, () => {
      void tickFornecedores();
    });
    log.info(
      `[scheduler] Espelho de fornecedores ativo (verifica com cron=` +
        `"${cronFornecedores}", roda a cada ${env.FORNECEDORES_INTERVALO_HORAS}h).`,
    );
  }

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
  if (tarefaFornecedores) {
    tarefaFornecedores.stop();
    tarefaFornecedores = null;
    log.info('[scheduler] Espelho de fornecedores parado.');
  }
}
