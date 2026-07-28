// Máquina de estados da ENTREGA (uma viagem).
//
// Substitui, para o fluxo do dia a dia, a máquina do PEDIDO (state-machine.ts),
// que a partir da Onda 2 responde só pela situação da ordem de venda.
//
// A diferença que mais importa em relação ao modelo antigo:
//
//   ANTES  nao_realizado era um estado do PEDIDO, e saía de lá por uma reversão
//          manual ("Reagendar") que devolvia o pedido para pendente.
//   AGORA  nao_realizado é TERMINAL na entrega. A viagem morreu e fica no
//          histórico. O saldo volta para o pedido sozinho, porque uma entrega
//          nao_realizado deixa de consumir saldo (ver saldo.ts). Remarcar é
//          criar uma entrega NOVA.
//
// Ganho concreto: some a reversão que existia só para devolver a vaga do
// caminhão, e passa a existir registro de CADA tentativa. No modelo antigo, um
// pedido que falhou duas vezes guardava só o motivo da última.

import type { StatusEntrega } from './types/domain.js';

/**
 * Transições para frente.
 *
 * `cancelada` é o "desfazer o agendamento": a carga volta para a fila e a vaga
 * de peso do caminhão é liberada. Só vale antes de a viagem começar — depois de
 * em_rota, o desfecho é entregue ou nao_realizado.
 */
export const TRANSICOES_ENTREGA: Record<StatusEntrega, StatusEntrega[]> = {
  agendada: ['em_rota', 'cancelada'],
  em_rota: ['entregue', 'nao_realizado'],
  entregue: [],
  nao_realizado: [],
  cancelada: [],
};

export function podeTransicionarEntrega(
  de: StatusEntrega,
  para: StatusEntrega,
): boolean {
  return TRANSICOES_ENTREGA[de].includes(para);
}

/**
 * Reversões (voltar UMA etapa) — só logística, e NUNCA disparam WhatsApp.
 *
 * `em_rota -> agendada` desfaz um despacho feito por engano. Só isso: de
 * `entregue` não se volta (o cliente recebeu), e de `nao_realizado` também não
 * — a viagem falhou de fato, e o caminho é agendar outra.
 */
export const REVERSOES_ENTREGA: Record<StatusEntrega, StatusEntrega[]> = {
  agendada: [],
  em_rota: ['agendada'],
  entregue: [],
  nao_realizado: [],
  cancelada: [],
};

export function podeReverterEntrega(
  de: StatusEntrega,
  para: StatusEntrega,
): boolean {
  return REVERSOES_ENTREGA[de].includes(para);
}

/**
 * Template de WhatsApp de uma transição de entrega.
 *
 *   (criação da entrega)   -> 'agendamento'   (disparado ao agendar, não aqui)
 *   agendada -> em_rota    -> 'em_rota'
 *   em_rota  -> entregue   -> 'entregue' ou 'entregue_parcial'
 *   em_rota  -> nao_realizado -> null  <- DE PROPÓSITO
 *
 * O cliente NÃO é avisado de que a entrega falhou: quem fala com ele é a
 * equipe, ao remarcar. Não adicione template aqui.
 *
 * @param sobraSaldo  true quando ainda resta mercadoria no pedido depois desta
 *                    viagem. Dizer "seu pedido foi entregue com sucesso" quando
 *                    foram 100 de 180 é mentira — e o cliente reclama.
 */
export function templateDaTransicaoEntrega(
  de: StatusEntrega,
  para: StatusEntrega,
  sobraSaldo = false,
): TemplateEntrega {
  if (!podeTransicionarEntrega(de, para)) return null;
  if (de === 'agendada' && para === 'em_rota') return 'em_rota';
  if (de === 'em_rota' && para === 'entregue') {
    return sobraSaldo ? 'entregue_parcial' : 'entregue';
  }
  return null;
}

/**
 * Templates que uma entrega pode disparar.
 *
 * 'entregue_parcial' nasce DESLIGADO: o texto ainda não foi aprovado pela
 * Natália. Enquanto a chave não existir em sync_state.templates, o envio é
 * pulado com um aviso no log e nada é mandado ao cliente — que é o
 * comportamento seguro (ver services/transitions.ts, dispararWhatsapp).
 */
export type TemplateEntrega =
  | 'agendamento'
  | 'em_rota'
  | 'entregue'
  | 'entregue_parcial'
  | null;

/** Rótulos em português dos status de entrega (backend em mensagens de erro). */
export const ROTULO_STATUS_ENTREGA: Record<StatusEntrega, string> = {
  agendada: 'Agendada',
  em_rota: 'Em rota',
  entregue: 'Entregue',
  nao_realizado: 'Não realizado',
  cancelada: 'Cancelada',
};
