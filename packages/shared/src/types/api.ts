// Contrato REST compartilhado entre backend (implementa) e frontend (consome).
// As respostas de pedido usam o tipo `Pedido` de domain.ts.

import type { PeriodoEntrega, StatusLogistico } from './domain.js';

export interface TransicaoRequest {
  para: StatusLogistico;
  propriedadeCodigo?: string;
  dataAgendada?: string;
  /** Observação livre gravada na transição (ex.: nota do motorista na entrega). */
  observacao?: string;
  /**
   * Motorista responsável. Desde a reunião de 25/06 é escolhido já no
   * AGENDAMENTO (para==='agendada'), não mais só no despacho.
   */
  motoristaId?: string | null;
  /** Turno da entrega — obrigatório no agendamento. */
  periodo?: PeriodoEntrega;
  /** Caminhão da carga — obrigatório no agendamento, separado do motorista. */
  caminhaoId?: string | null;
}

/** Cadastro de um caminhão (a tela envia toneladas; a API guarda kg). */
export interface CriarCaminhaoRequest {
  nome: string;
  placa?: string | null;
  capacidadeKg: number;
}

export interface AtualizarCaminhaoRequest {
  nome?: string;
  placa?: string | null;
  capacidadeKg?: number;
  ativo?: boolean;
}

/**
 * Peso digitado pela equipe para um produto sem peso conhecido.
 * Fica salvo NO PRODUTO e vale para todos os pedidos seguintes.
 */
export interface DefinirPesoProdutoRequest {
  pesoKg: number;
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
