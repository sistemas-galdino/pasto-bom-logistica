// Máquina de estados das transições logísticas.
// Fonte única da verdade: backend (services/transitions.ts) e frontend
// (Board.tsx) consultam APENAS este módulo.

import type { StatusLogistico } from './types/domain.js';

/**
 * Transições permitidas a partir de cada status.
 * Estados finais (`entregue`, `cancelada`) não admitem transições.
 *
 * `nao_realizado` é o desfecho ruim de uma saída: o caminhão foi e a entrega não
 * aconteceu (cliente ausente, porteira fechada, estrada intransitável). Não é
 * cancelamento — a venda continua de pé e a entrega precisa ser remarcada. Sai
 * de lá pela REVERSÃO para `pendente` (ver REVERSOES).
 */
export const TRANSICOES: Record<StatusLogistico, StatusLogistico[]> = {
  pendente: ['agendada', 'cancelada'],
  agendada: ['em_rota', 'cancelada'],
  em_rota: ['entregue', 'nao_realizado', 'cancelada'],
  entregue: [],
  nao_realizado: ['cancelada'],
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
 * lógica do botão de avançar.
 *   agendada      -> pendente  (desfaz o agendamento; ex.: choveu, caminhão quebrou)
 *   em_rota       -> agendada  (desfaz o despacho)
 *   cancelada     -> pendente  (restaura um cancelamento — "é só por causa de
 *                               clicar errado", Johnny na reunião de 25/06)
 *   nao_realizado -> pendente  (remarca a entrega que não deu certo)
 *
 * A volta de `nao_realizado` é para PENDENTE, e não para `agendada`, de propósito:
 * `reverterStatus` limpa data/período/motorista/caminhão, o que LIBERA a vaga de
 * peso daquele caminhão no slot. Se voltasse para `agendada`, uma carga que não
 * saiu continuaria ocupando a capacidade de um dia que já passou.
 *
 * `entregue` é o único estado realmente final.
 */
export const REVERSOES: Record<StatusLogistico, StatusLogistico[]> = {
  pendente: [],
  agendada: ['pendente'],
  em_rota: ['agendada'],
  entregue: [],
  nao_realizado: ['pendente'],
  cancelada: ['pendente'],
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
 *   pendente -> agendada      : 'agendamento'
 *   agendada -> em_rota       : 'em_rota'
 *   em_rota  -> entregue      : 'entregue'
 *   * -> cancelada            : null
 *   em_rota -> nao_realizado  : null  <- DE PROPÓSITO. O cliente NÃO é avisado de
 *                                        que a entrega falhou; quem fala com ele é
 *                                        a equipe, ao remarcar. Não adicione
 *                                        template aqui.
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
