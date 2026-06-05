// Contrato REST compartilhado entre backend (implementa) e frontend (consome).
// As respostas de pedido usam o tipo `Pedido` de domain.ts.

import type { StatusLogistico } from './domain.js';

export interface TransicaoRequest {
  para: StatusLogistico;
  propriedadeCodigo?: string;
  dataAgendada?: string;
}

export interface ConfigResponse {
  statusGatilho: string[];
  templates: Record<string, string>;
}

export interface ListaPedidosQuery {
  status?: StatusLogistico[];
}
