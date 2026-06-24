// Contrato REST compartilhado entre backend (implementa) e frontend (consome).
// As respostas de pedido usam o tipo `Pedido` de domain.ts.

import type { StatusLogistico } from './domain.js';

export interface TransicaoRequest {
  para: StatusLogistico;
  propriedadeCodigo?: string;
  dataAgendada?: string;
  /** Observação livre gravada na transição (ex.: nota do motorista na entrega). */
  observacao?: string;
  /** Atribuição de motorista no despacho (logística, para==='em_rota'). */
  motoristaId?: string | null;
}

export interface ConfigResponse {
  statusGatilho: string[];
  templates: Record<string, string>;
}

/** Reversão de status (voltar uma etapa) — `para` deve casar com REVERSOES[de]. */
export interface ReverterRequest {
  para: StatusLogistico;
}

export interface SyncStatusResponse {
  /** ISO do último tick de poll BEM-SUCEDIDO (null antes da 1ª sincronização). */
  ultimoSucesso: string | null;
  /** A última tentativa de poll teve sucesso? (false => Órix instável/fora do ar). */
  sucesso: boolean;
  /** Pedidos processados no último tick (null se nunca sincronizou). */
  pedidos: number | null;
}

export interface ListaPedidosQuery {
  status?: StatusLogistico[];
}
