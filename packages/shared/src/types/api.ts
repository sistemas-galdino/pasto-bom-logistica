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

export interface ListaPedidosQuery {
  status?: StatusLogistico[];
}
