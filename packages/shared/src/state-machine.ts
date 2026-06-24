// Máquina de estados das transições logísticas.
// Fonte única da verdade: backend (services/transitions.ts) e frontend
// (Board.tsx) consultam APENAS este módulo.

import type { StatusLogistico } from './types/domain.js';

/**
 * Transições permitidas a partir de cada status.
 * Estados finais (`entregue`, `cancelada`) não admitem transições.
 */
export const TRANSICOES: Record<StatusLogistico, StatusLogistico[]> = {
  pendente: ['agendada', 'cancelada'],
  agendada: ['em_rota', 'cancelada'],
  em_rota: ['entregue', 'cancelada'],
  entregue: [],
  cancelada: [],
};

/**
 * Indica se a transição `de` -> `para` é válida segundo TRANSICOES.
 */
export function podeTransicionar(
  de: StatusLogistico,
  para: StatusLogistico,
): boolean {
  return TRANSICOES[de].includes(para);
}

/**
 * Reversões permitidas (voltar UMA etapa) — exclusivas da logística e SEM
 * disparo de WhatsApp. Mapa separado de TRANSICOES para não interferir na
 * lógica do botão de avançar. Estados finais (entregue/cancelada) não voltam.
 *   agendada -> pendente  (desfaz o agendamento)
 *   em_rota  -> agendada  (desfaz o despacho)
 */
export const REVERSOES: Record<StatusLogistico, StatusLogistico[]> = {
  pendente: [],
  agendada: ['pendente'],
  em_rota: ['agendada'],
  entregue: [],
  cancelada: [],
};

/**
 * Indica se a reversão `de` -> `para` é permitida segundo REVERSOES.
 */
export function podeReverter(
  de: StatusLogistico,
  para: StatusLogistico,
): boolean {
  return REVERSOES[de].includes(para);
}

/**
 * Template de WhatsApp disparado por uma transição (ou null se nenhum).
 */
export type TemplateWhatsapp = 'agendamento' | 'em_rota' | 'entregue' | null;

/**
 * Retorna o template associado a uma transição válida:
 *   pendente -> agendada : 'agendamento'
 *   agendada -> em_rota  : 'em_rota'
 *   em_rota  -> entregue : 'entregue'
 *   * -> cancelada       : null
 * Qualquer transição inválida também retorna null.
 */
export function templateDaTransicao(
  de: StatusLogistico,
  para: StatusLogistico,
): TemplateWhatsapp {
  if (!podeTransicionar(de, para)) {
    return null;
  }
  if (de === 'pendente' && para === 'agendada') {
    return 'agendamento';
  }
  if (de === 'agendada' && para === 'em_rota') {
    return 'em_rota';
  }
  if (de === 'em_rota' && para === 'entregue') {
    return 'entregue';
  }
  return null;
}
