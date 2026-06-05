// [AGENTE ORIX] Helpers de classificação de status Órix.
//
// Lê as listas configuráveis de status a partir da tabela sync_state
// (chaves 'status_gatilho', 'status_cancelado', 'status_concluido') e expõe
// funções de classificação éGatilho / éCancelado / éConcluido.
//
// As listas são cacheadas em memória por um curto período para evitar uma ida
// ao banco a cada classificação; use carregarStatusConfig(force) para forçar
// releitura.

import { supabase } from '../db/supabase.js';
import { log } from '../log.js';

export interface StatusConfig {
  gatilho: string[];
  cancelado: string[];
  concluido: string[];
}

// Defaults conforme o contrato (códigos reais do Órix). Usados como fallback
// caso a chave não exista em sync_state.
const PADRAO: StatusConfig = {
  gatilho: ['00041', '00045', '00027', '00028'],
  cancelado: ['00031'],
  concluido: ['00030'],
};

const TTL_CACHE_MS = 60_000;

let cache: StatusConfig | null = null;
let cacheEmMs = 0;

/** Lê uma chave de sync_state e retorna seu valor (jsonb) ou null. */
async function lerSyncState<T>(chave: string): Promise<T | null> {
  const { data, error } = await supabase
    .from('sync_state')
    .select('valor')
    .eq('chave', chave)
    .maybeSingle();

  if (error) {
    log.warn(`[orix/status] Erro ao ler sync_state "${chave}": ${error.message}`);
    return null;
  }
  if (!data) return null;
  return (data as { valor: T }).valor;
}

function normalizarLista(valor: unknown, fallback: string[]): string[] {
  if (Array.isArray(valor)) {
    return valor.map((v) => String(v));
  }
  return fallback;
}

/**
 * Carrega a configuração de status de sync_state (com cache de 60s).
 * Passe force=true para ignorar o cache e reler do banco.
 */
export async function carregarStatusConfig(
  force = false,
): Promise<StatusConfig> {
  if (!force && cache && Date.now() - cacheEmMs < TTL_CACHE_MS) {
    return cache;
  }

  const [gatilho, cancelado, concluido] = await Promise.all([
    lerSyncState<unknown>('status_gatilho'),
    lerSyncState<unknown>('status_cancelado'),
    lerSyncState<unknown>('status_concluido'),
  ]);

  cache = {
    gatilho: normalizarLista(gatilho, PADRAO.gatilho),
    cancelado: normalizarLista(cancelado, PADRAO.cancelado),
    concluido: normalizarLista(concluido, PADRAO.concluido),
  };
  cacheEmMs = Date.now();
  return cache;
}

/** Lê apenas a lista de status-gatilho de sync_state. */
export async function getStatusGatilho(): Promise<string[]> {
  return (await carregarStatusConfig()).gatilho;
}

/** Lê apenas a lista de status de cancelamento de sync_state. */
export async function getStatusCancelado(): Promise<string[]> {
  return (await carregarStatusConfig()).cancelado;
}

/** Lê apenas a lista de status de conclusão de sync_state. */
export async function getStatusConcluido(): Promise<string[]> {
  return (await carregarStatusConfig()).concluido;
}

/** Invalida o cache em memória das configurações de status. */
export function invalidarCacheStatus(): void {
  cache = null;
  cacheEmMs = 0;
}

// --------------------------------------------------------------------------
// Classificadores
// --------------------------------------------------------------------------

/** Verdadeiro se o código de status é um gatilho (pedido entra na logística). */
export async function éGatilho(statusOrix: string): Promise<boolean> {
  const { gatilho } = await carregarStatusConfig();
  return gatilho.includes(statusOrix);
}

/** Verdadeiro se o código de status indica cancelamento da ordem de venda. */
export async function éCancelado(statusOrix: string): Promise<boolean> {
  const { cancelado } = await carregarStatusConfig();
  return cancelado.includes(statusOrix);
}

/** Verdadeiro se o código de status indica venda concluída (faturada). */
export async function éConcluido(statusOrix: string): Promise<boolean> {
  const { concluido } = await carregarStatusConfig();
  return concluido.includes(statusOrix);
}

// Aliases ASCII para chamadores que prefiram evitar acentos nos identificadores.
export const ehGatilho = éGatilho;
export const ehCancelado = éCancelado;
export const ehConcluido = éConcluido;
