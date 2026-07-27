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
  /**
   * Naturezas de OPERAÇÃO que viram entrega. Filtro ortogonal ao status: diz o
   * QUE é a operação (venda, remessa, faturamento, locação), enquanto o status
   * diz em que ETAPA ela está.
   *   '00001' VENDA
   *   '00012' VENDA ORIGINADA DE FAT P/ ENTREGA FUTURA  (a remessa: a carga sai)
   * Ficam de fora, entre outras, a '00011' (SIMPLES FATURAMENTO — só a nota
   * fiscal, nada sai; é o par da 12 e duplicaria a entrega no painel) e a
   * '00049' (REMESSA EM GARANTIA — a oficina).
   */
  naturezaPermitida: string[];
  /**
   * Códigos de PRODUTO que representam prestação de serviço. Um pedido que
   * contém qualquer um deles não é entrega — é o fluxo da OFICINA.
   *
   * Como a Natália explicou na reunião de 16/07/2026: um mesmo pedido tem peças
   * e prestação de serviço; faturam-se as peças, o serviço fica para depois (a
   * nota de serviço vai para a prefeitura) e a OV cai em 00027 (parcial). O
   * pedido então aparecia na fila do Johnny sem nunca ter havido entrega.
   *
   * A checagem é por CÓDIGO, não por nome: nome muda, código não.
   *   '11930' PRESTAÇÃO DE SERVICO - MAQUINAS E PECAS GERAL  (a oficina)
   *   '11931' PRESTAÇÃO DE SERVICO - VETERINARIO
   *
   * Evidência (sondagem de 27/07/2026 sobre os 337 pedidos do banco):
   *   00027 parcial ....... 125 COM serviço, 9 sem
   *   00041 aguardando .....  0 COM serviço, 93 sem
   *   00045 entrega futura .  0 COM serviço, 42 sem
   * Linha de serviço nunca aparece num status de entrega de verdade — e os 9
   * parciais sem serviço são entregas legítimas (ração, semente, adubo).
   */
  produtosServico: string[];
}

// Defaults conforme o contrato (códigos reais do Órix). Usados como fallback
// caso a chave não exista em sync_state. O 00028 ("Venda aguardando faturamento
// 2") saiu do gatilho na reunião de 25/06/2026.
const PADRAO: StatusConfig = {
  gatilho: ['00041', '00045', '00027'],
  cancelado: ['00031'],
  concluido: ['00030'],
  naturezaPermitida: ['00001', '00012'],
  produtosServico: ['11930', '11931'],
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

  const [gatilho, cancelado, concluido, natureza, servico] = await Promise.all([
    lerSyncState<unknown>('status_gatilho'),
    lerSyncState<unknown>('status_cancelado'),
    lerSyncState<unknown>('status_concluido'),
    lerSyncState<unknown>('natureza_permitida'),
    lerSyncState<unknown>('produtos_servico'),
  ]);

  cache = {
    gatilho: normalizarLista(gatilho, PADRAO.gatilho),
    cancelado: normalizarLista(cancelado, PADRAO.cancelado),
    concluido: normalizarLista(concluido, PADRAO.concluido),
    naturezaPermitida: normalizarLista(natureza, PADRAO.naturezaPermitida),
    produtosServico: normalizarLista(servico, PADRAO.produtosServico),
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

/** Lê apenas a lista de naturezas de operação que viram entrega. */
export async function getNaturezaPermitida(): Promise<string[]> {
  return (await carregarStatusConfig()).naturezaPermitida;
}

/** Lê os códigos de produto que são prestação de serviço (fluxo da oficina). */
export async function getProdutosServico(): Promise<string[]> {
  return (await carregarStatusConfig()).produtosServico;
}

/**
 * Verdadeiro se o pedido tem ALGUMA linha de prestação de serviço — ou seja,
 * se ele é do fluxo da oficina e não deve ocupar a fila da logística.
 *
 * A comparação tolera zero-padding: o cadastro de produto do Órix devolve
 * '11930', mas nada garante que continue assim em todo endpoint.
 */
export function temProdutoServico(
  codigosDoPedido: readonly string[],
  produtosServico: readonly string[],
): boolean {
  const alvo = new Set(produtosServico.map((c) => c.replace(/^0+/, '')));
  return codigosDoPedido.some((c) =>
    alvo.has(String(c).trim().replace(/^0+/, '')),
  );
}

/**
 * Verdadeiro se a natureza da operação vira entrega ('00001' ou '00012').
 * O código vem zero-padded da API — normalizamos para tolerar '11' e 11.
 */
export async function naturezaEntra(natureza: unknown): Promise<boolean> {
  const { naturezaPermitida } = await carregarStatusConfig();
  return naturezaPermitida.includes(normalizarNatureza(natureza));
}

/** '11' | 11 | '00011' -> '00011'. Vazio/nulo -> ''. */
export function normalizarNatureza(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const bruto = String(valor).trim();
  if (bruto === '') return '';
  return /^\d+$/.test(bruto) ? bruto.padStart(5, '0') : bruto;
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
