// [AGENTE WORKER] Polling da Órix, em DUAS VELOCIDADES.
//
// pollOnce() — tick rápido, a cada 5 min. Janela curta: dos últimos
// DIAS_REVISITA dias (ou de onde o cursor parou, o que for mais antigo) até
// hoje. Serve para o pedido novo aparecer no quadro em minutos.
//
// varreduraProfundaOnce() — 1x/dia. Janela de DIAS_VARREDURA_PROFUNDA dias.
// Serve para pegar o pedido ANTIGO que só agora entrou no gatilho.
//
// POR QUE DUAS (investigação de 11/08/2026)
// ----------------------------------------
// A API só filtra por DATA DO PEDIDO — não existe "alterado desde". E o pedido
// NÃO nasce no gatilho: ele vira 00027 "Parcial" dias depois, quando sai o
// faturamento parcial. O código antigo perguntava "[cursor, hoje]" e, no fim de
// cada tick, gravava o cursor como hoje — ou seja, a próxima pergunta era
// "pedidos de hoje". Quando o pedido de 4 dias atrás entrava no gatilho, a
// janela já tinha passado pela data dele, e ninguém perguntava de novo: ele
// nunca entrava no sistema.
//
// Não era caso de borda. Em 11/08 faltavam 24 dos 135 pedidos elegíveis, e os
// 6 mais recentes eram TODOS 00027 — o status que chega atrasado. Um deles com
// 55 dias entre a data do pedido e a entrada no gatilho. Daí a varredura
// profunda ser de um ano, e não de uma semana.
//
// A reconciliação não cobre isso: ela varre 365 dias, mas só atualiza pedido
// que JÁ existe no banco. Quem nunca entrou, nunca entra.
//
// Circuit-breaker: se a Órix falhar, logamos e ABORTAMOS a varredura sem
// derrubar o processo (não atualizamos o cursor, para reprocessar depois; a
// ingestão é idempotente, então reprocessar é seguro).

import { OrixClient } from '../orix/client.js';
import { inicioJanelaPoll } from '@pastobom/shared';
import { ingest } from './ingest.js';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { log } from '../log.js';

// Sub-janela máxima permitida pela Órix (volume controlado por data, não paginação).
const MAX_DIAS_JANELA = 16;
// Janela inicial padrão quando ainda não há cursor (hoje - 30 dias).
const DIAS_FALLBACK = 30;
// Piso do tick rápido: sempre reperguntar os últimos N dias, mesmo com o cursor
// em hoje. Cobre a virada de status do dia anterior sem custo (1 chamada).
const DIAS_REVISITA = 2;
// Alcance da varredura profunda. Um ano porque o atraso entre a data do pedido
// e a entrada no gatilho chega a meses (medido: 55 dias no pior caso de 11/08).
export const DIAS_VARREDURA_PROFUNDA = 365;

/** Status de gatilho default caso sync_state não tenha sido semeado.
 *  O 00028 ("aguardando faturamento 2") saiu na reunião de 25/06/2026. */
const STATUS_GATILHO_DEFAULT = ['00041', '00045', '00027'];

interface JanelaDatas {
  dataInicial: string; // yyyy-mm-dd
  dataFinal: string; // yyyy-mm-dd
}

/** Formata um Date (UTC) como yyyy-mm-dd. */
function formatarISO(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Faz parse de yyyy-mm-dd para um Date em UTC (meia-noite). */
function parseISO(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
}

function adicionarDias(d: Date, dias: number): Date {
  const novo = new Date(d.getTime());
  novo.setUTCDate(novo.getUTCDate() + dias);
  return novo;
}

/** Lê um valor de sync_state pela chave; retorna null se ausente/erro. */
async function lerSyncState<T>(chave: string): Promise<T | null> {
  const { data, error } = await supabase
    .from('sync_state')
    .select('valor')
    .eq('chave', chave)
    .maybeSingle();
  if (error) {
    log.warn(`[poll] Falha ao ler sync_state '${chave}': ${error.message}`);
    return null;
  }
  if (!data) return null;
  return data.valor as T;
}

/** Lê os status_gatilho de sync_state (com fallback para os defaults). */
async function lerStatusGatilho(): Promise<string[]> {
  const valor = await lerSyncState<unknown>('status_gatilho');
  if (Array.isArray(valor) && valor.length > 0) {
    return valor.map((v) => String(v));
  }
  log.warn(
    '[poll] status_gatilho ausente/vazio em sync_state; usando defaults do contrato.',
  );
  return STATUS_GATILHO_DEFAULT;
}

/**
 * Calcula a janela do TICK RÁPIDO.
 * - início: o MAIS ANTIGO entre o cursor e (hoje - DIAS_REVISITA);
 * - fim: hoje.
 *
 * O cursor sozinho não basta: como ele vira "hoje" a cada tick, a janela
 * encolhia para um único dia e o pedido que entrava no gatilho depois da sua
 * própria data nunca era perguntado de novo. O piso de DIAS_REVISITA garante
 * uma segunda olhada barata; o cursor continua servindo de rede para queda
 * longa (se o worker ficou 5 dias fora, a janela cobre os 5).
 */
async function calcularJanela(hoje: Date): Promise<JanelaDatas> {
  const cursor = await lerSyncState<{ last_to: string | null }>('poll_cursor');
  const dataFinal = formatarISO(hoje);

  // A decisão em si é regra pura e testada em @pastobom/shared.
  const dataInicial = inicioJanelaPoll({
    cursorLastTo: cursor?.last_to ?? null,
    hoje: dataFinal,
    diasRevisita: DIAS_REVISITA,
    diasFallback: DIAS_FALLBACK,
  });

  return { dataInicial, dataFinal };
}

/** Divide [inicio, fim] em sub-janelas de no máximo MAX_DIAS_JANELA dias. */
export function dividirEmSubJanelas(
  dataInicial: string,
  dataFinal: string,
  maxDias: number = MAX_DIAS_JANELA,
): JanelaDatas[] {
  const inicio = parseISO(dataInicial);
  const fim = parseISO(dataFinal);
  if (!inicio || !fim || inicio.getTime() > fim.getTime()) {
    return [{ dataInicial, dataFinal }];
  }

  const janelas: JanelaDatas[] = [];
  let cursor = inicio;
  // passo = maxDias - 1 dias adicionados => intervalo inclusivo de maxDias dias.
  const passo = Math.max(1, maxDias - 1);

  while (cursor.getTime() <= fim.getTime()) {
    let chunkFim = adicionarDias(cursor, passo);
    if (chunkFim.getTime() > fim.getTime()) chunkFim = fim;
    janelas.push({
      dataInicial: formatarISO(cursor),
      dataFinal: formatarISO(chunkFim),
    });
    cursor = adicionarDias(chunkFim, 1);
  }

  return janelas;
}

/** Atualiza poll_cursor.last_to. */
async function atualizarCursor(lastTo: string): Promise<void> {
  const { error } = await supabase.from('sync_state').upsert(
    {
      chave: 'poll_cursor',
      valor: { last_to: lastTo },
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'chave' },
  );
  if (error) {
    log.warn(`[poll] Falha ao atualizar poll_cursor: ${error.message}`);
  }
}

/** Cria uma instância do cliente Órix a partir das envs. */
function criarClienteOrix(): OrixClient {
  return new OrixClient({
    baseUrl: env.ORIX_BASE_URL,
    login: env.ORIX_LOGIN,
    senha: env.ORIX_SENHA,
  });
}

export interface ResultadoPoll {
  ok: boolean;
  janelas: number;
  itens: number;
  pedidos: number;
  motivoAbort?: string;
}

/**
 * Executa UM tick de polling. Não lança em caso de falha da Órix:
 * loga, aborta o tick e retorna { ok:false } (circuit-breaker brando).
 */
export async function pollOnce(): Promise<ResultadoPoll> {
  const inicioTick = Date.now();
  log.info('[poll] Iniciando tick de polling da Órix...');

  const hoje = parseISO(formatarISO(new Date())) as Date; // normaliza p/ meia-noite UTC
  const janelaTotal = await calcularJanela(hoje);
  const resultado = await varrerJanela(janelaTotal, 'poll');

  if (!resultado.ok) return resultado;

  // Sucesso: avança o cursor até o fim da janela (hoje).
  await atualizarCursor(janelaTotal.dataFinal);

  const ms = Date.now() - inicioTick;
  log.info(
    `[poll] Tick concluído em ${ms}ms: ${resultado.itens} item(ns), ` +
      `${resultado.pedidos} pedido(s). Cursor avançado para ${janelaTotal.dataFinal}.`,
  );

  return resultado;
}

/**
 * VARREDURA PROFUNDA: um ano de pedidos, nos status de gatilho.
 *
 * É o que traz o pedido antigo que só agora entrou no gatilho — o buraco que o
 * tick rápido não tem como cobrir, porque a API só filtra por data do pedido.
 * Custa ~23 chamadas (365 / 16), então roda 1x/dia, de madrugada.
 *
 * NÃO mexe no poll_cursor: o cursor é do tick rápido, e uma falha aqui não pode
 * fazer o tick rápido reprocessar um ano.
 */
export async function varreduraProfundaOnce(): Promise<ResultadoPoll> {
  const inicio = Date.now();
  const hoje = parseISO(formatarISO(new Date())) as Date;
  const janela: JanelaDatas = {
    dataInicial: formatarISO(adicionarDias(hoje, -DIAS_VARREDURA_PROFUNDA)),
    dataFinal: formatarISO(hoje),
  };

  log.info(
    `[varredura] Iniciando varredura profunda (${DIAS_VARREDURA_PROFUNDA} dias)...`,
  );
  const resultado = await varrerJanela(janela, 'varredura');

  const ms = Date.now() - inicio;
  log.info(
    `[varredura] ${resultado.ok ? 'Concluída' : 'ABORTADA'} em ${ms}ms: ` +
      `${resultado.itens} item(ns), ${resultado.pedidos} pedido(s).`,
  );

  return resultado;
}

/**
 * Percorre uma janela em sub-janelas de <= MAX_DIAS_JANELA dias, buscando na
 * Órix e ingerindo. Compartilhada pelo tick rápido e pela varredura profunda —
 * a diferença entre os dois é só o tamanho da janela e o que se faz depois.
 *
 * Não lança: em falha, loga, aborta e devolve { ok:false }.
 */
async function varrerJanela(
  janelaTotal: JanelaDatas,
  rotulo: 'poll' | 'varredura',
): Promise<ResultadoPoll> {
  const statusGatilho = await lerStatusGatilho();
  const subJanelas = dividirEmSubJanelas(
    janelaTotal.dataInicial,
    janelaTotal.dataFinal,
  );

  log.info(
    `[${rotulo}] Janela total ${janelaTotal.dataInicial} -> ${janelaTotal.dataFinal} ` +
      `(${subJanelas.length} sub-janela(s) <= ${MAX_DIAS_JANELA}d), ` +
      `status_gatilho=[${statusGatilho.join(',')}]`,
  );

  const orix = criarClienteOrix();
  const empresas = [env.ORIX_EMPRESA];

  let totalItens = 0;
  let totalPedidos = 0;

  for (const janela of subJanelas) {
    let itens;
    try {
      itens = await orix.getPedidos({
        dataInicial: janela.dataInicial,
        dataFinal: janela.dataFinal,
        status: statusGatilho,
        somenteVendas: false,
        empresas,
      });
    } catch (err) {
      // CIRCUIT-BREAKER: Órix falhou. Aborta a varredura SEM atualizar o cursor
      // (a próxima reprocessa; ingestão é idempotente) e sem derrubar o processo.
      const motivo = err instanceof Error ? err.message : String(err);
      log.error(
        `[${rotulo}] Órix falhou na sub-janela ${janela.dataInicial}->${janela.dataFinal}; ` +
          `abortando sem atualizar cursor. Motivo: ${motivo}`,
      );
      return {
        ok: false,
        janelas: subJanelas.length,
        itens: totalItens,
        pedidos: totalPedidos,
        motivoAbort: motivo,
      };
    }

    const qtde = itens?.length ?? 0;
    totalItens += qtde;
    log.info(
      `[${rotulo}] Sub-janela ${janela.dataInicial}->${janela.dataFinal}: ${qtde} item(ns).`,
    );

    if (qtde > 0) {
      try {
        const res = await ingest(itens, orix);
        totalPedidos += res.pedidosProcessados;
        log.info(
          `[${rotulo}] Ingestão: ${res.pedidosProcessados} pedido(s) ` +
            `(${res.inseridos} novo(s), ${res.atualizados} atualizado(s), ` +
            `${res.readmitidos} readmitido(s), ` +
            `${res.itensGravados} item(ns), ${res.erros} erro(s)).`,
        );
      } catch (err) {
        // Falha de ingestão (banco) — não atualizamos o cursor; reprocessa depois.
        const motivo = err instanceof Error ? err.message : String(err);
        log.error(
          `[${rotulo}] Falha na ingestão da sub-janela ${janela.dataInicial}->${janela.dataFinal}; ` +
            `abortando sem atualizar cursor. Motivo: ${motivo}`,
        );
        return {
          ok: false,
          janelas: subJanelas.length,
          itens: totalItens,
          pedidos: totalPedidos,
          motivoAbort: motivo,
        };
      }
    }
  }

  return {
    ok: true,
    janelas: subJanelas.length,
    itens: totalItens,
    pedidos: totalPedidos,
  };
}

/**
 * Grava um "heartbeat" de sincronização em sync_state, chamado ao fim de TODO
 * tick (sucesso ou falha contida). Preserva o timestamp do último tick
 * BEM-SUCEDIDO (ultimoSucesso) quando a tentativa atual falha, para que a UI
 * mostre "atualizado há X" baseado no último sucesso real.
 * Read-modify-write é seguro: há um único worker e o scheduler não sobrepõe ticks.
 *
 * A varredura profunda grava numa chave separada ('varredura_profunda') de
 * propósito: a UI lê 'sync_status' para dizer há quanto tempo o quadro está
 * atualizado, e isso é o tick rápido. Misturar as duas faria uma varredura
 * noturna bem-sucedida mascarar um poll quebrado a manhã inteira.
 */
export async function registrarSincronizacao(
  resultado: ResultadoPoll,
  chave: 'sync_status' | 'varredura_profunda' = 'sync_status',
): Promise<void> {
  const agora = new Date().toISOString();
  const anterior = await lerSyncState<{ ultimoSucesso?: string | null }>(chave);
  const valor = {
    ultimoSucesso: resultado.ok ? agora : (anterior?.ultimoSucesso ?? null),
    ultimoTick: agora,
    sucesso: resultado.ok,
    pedidos: resultado.pedidos,
  };
  const { error } = await supabase
    .from('sync_state')
    .upsert({ chave, valor, atualizado_em: agora }, { onConflict: 'chave' });
  if (error) {
    log.warn(`[poll] Falha ao gravar ${chave}: ${error.message}`);
  }
}
