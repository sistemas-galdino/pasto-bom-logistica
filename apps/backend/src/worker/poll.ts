// [AGENTE WORKER] Tick de polling da Órix.
//
// A cada tick (pollOnce):
//  1) lê status_gatilho de sync_state;
//  2) calcula a janela [cursor.last_to ou (hoje - 30d)] -> hoje;
//  3) divide em sub-janelas <= 16 dias (chunking — a API retorna tudo de uma
//     vez por janela, então o controle de volume é por intervalo de data);
//  4) para cada sub-janela chama orix.getPedidos({ ..., status: gatilho }) e
//     passa o resultado para ingest();
//  5) atualiza poll_cursor (last_to = hoje) ao final.
//
// Circuit-breaker: se a Órix falhar, logamos e ABORTAMOS o tick sem derrubar o
// processo (não atualizamos o cursor, para reprocessar a janela no próximo tick;
// a ingestão é idempotente, então reprocessar é seguro).

import { OrixClient } from '../orix/client.js';
import { ingest } from './ingest.js';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { log } from '../log.js';

// Sub-janela máxima permitida pela Órix (volume controlado por data, não paginação).
const MAX_DIAS_JANELA = 16;
// Janela inicial padrão quando ainda não há cursor (hoje - 30 dias).
const DIAS_FALLBACK = 30;

/** Status de gatilho default caso sync_state não tenha sido semeado. */
const STATUS_GATILHO_DEFAULT = ['00041', '00045', '00027', '00028'];

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
 * Calcula a janela total a partir do cursor.
 * - início: cursor.last_to (se existir) senão (hoje - 30d);
 * - fim: hoje.
 */
async function calcularJanela(hoje: Date): Promise<JanelaDatas> {
  const cursor = await lerSyncState<{ last_to: string | null }>('poll_cursor');
  let inicio: Date | null = null;

  if (cursor && cursor.last_to) {
    inicio = parseISO(cursor.last_to);
  }
  if (!inicio) {
    inicio = adicionarDias(hoje, -DIAS_FALLBACK);
  }
  // Garante que início não passe do fim.
  if (inicio.getTime() > hoje.getTime()) {
    inicio = hoje;
  }

  return { dataInicial: formatarISO(inicio), dataFinal: formatarISO(hoje) };
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

  const statusGatilho = await lerStatusGatilho();
  const hoje = parseISO(formatarISO(new Date())) as Date; // normaliza p/ meia-noite UTC
  const janelaTotal = await calcularJanela(hoje);
  const subJanelas = dividirEmSubJanelas(
    janelaTotal.dataInicial,
    janelaTotal.dataFinal,
  );

  log.info(
    `[poll] Janela total ${janelaTotal.dataInicial} -> ${janelaTotal.dataFinal} ` +
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
      // CIRCUIT-BREAKER: Órix falhou. Aborta o tick SEM atualizar o cursor
      // (próximo tick reprocessa; ingestão é idempotente) e sem derrubar o processo.
      const motivo = err instanceof Error ? err.message : String(err);
      log.error(
        `[poll] Órix falhou na sub-janela ${janela.dataInicial}->${janela.dataFinal}; ` +
          `abortando tick sem atualizar cursor. Motivo: ${motivo}`,
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
      `[poll] Sub-janela ${janela.dataInicial}->${janela.dataFinal}: ${qtde} item(ns).`,
    );

    if (qtde > 0) {
      try {
        const res = await ingest(itens, orix);
        totalPedidos += res.pedidosProcessados;
        log.info(
          `[poll] Ingestão: ${res.pedidosProcessados} pedido(s) ` +
            `(${res.inseridos} novo(s), ${res.atualizados} atualizado(s), ` +
            `${res.itensGravados} item(ns), ${res.erros} erro(s)).`,
        );
      } catch (err) {
        // Falha de ingestão (banco) — não atualizamos o cursor; reprocessa depois.
        const motivo = err instanceof Error ? err.message : String(err);
        log.error(
          `[poll] Falha na ingestão da sub-janela ${janela.dataInicial}->${janela.dataFinal}; ` +
            `abortando tick sem atualizar cursor. Motivo: ${motivo}`,
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

  // Sucesso: avança o cursor até o fim da janela (hoje).
  await atualizarCursor(janelaTotal.dataFinal);

  const ms = Date.now() - inicioTick;
  log.info(
    `[poll] Tick concluído em ${ms}ms: ${totalItens} item(ns), ` +
      `${totalPedidos} pedido(s). Cursor avançado para ${janelaTotal.dataFinal}.`,
  );

  return {
    ok: true,
    janelas: subJanelas.length,
    itens: totalItens,
    pedidos: totalPedidos,
  };
}
