// Regra de RECONCILIAÇÃO: o que fazer com um pedido do painel quando o Órix
// diz que o status da ordem de venda mudou.
//
// Por que isso existe (reunião de 16/07/2026):
//   "Você consegue fazer uma rotina para que qualquer pedido que entrar como
//    cancelado suma daqui? Tá cancelado no Órix, mas ficar aparecendo aqui pro
//    Johnny não faz sentido."
//
// O polling normal só busca a janela a partir do cursor (hoje) e só nos status
// de GATILHO. Quer dizer: uma OV que vira cancelada some do resultado da busca
// e, por isso, NUNCA mais é relida — ficava presa no painel para sempre. A
// reconciliação varre os pedidos ABERTOS e confronta com o Órix.
//
// Aqui fica só a DECISÃO (função pura, testável). O acesso ao banco e à API do
// Órix mora em apps/backend/src/worker/reconciliar.ts.

import type { StatusLogistico } from './types/domain.js';

/** O que fazer com o pedido depois de comparar com o Órix. */
export type AcaoReconciliacao =
  /** Nada mudou — não toca no banco. */
  | 'nada'
  /** Só o status do Órix mudou: atualiza os campos informativos. */
  | 'atualizar_orix'
  /** A OV foi cancelada no Órix: sai da vista da logística. */
  | 'cancelar';

export interface EntradaReconciliacao {
  /** Status logístico atual no nosso banco. */
  statusLogistico: StatusLogistico;
  /** Código do status do Órix que está gravado hoje. */
  statusOrixAtual: string;
  /** Código do status do Órix que a API acabou de devolver. */
  statusOrixNovo: string;
  /** Nome do status gravado hoje. */
  statusOrixNomeAtual: string;
  /** Nome do status que a API acabou de devolver. */
  statusOrixNomeNovo: string;
}

/**
 * Status logísticos que já são um DESFECHO: não podem ser rebaixados por uma
 * leitura do Órix.
 *
 * 'entregue' é o caso que importa: a mercadoria já saiu e chegou ao cliente.
 * Se depois disso alguém cancelar a nota no Órix (acontece: erro de
 * faturamento), o cancelamento é um problema FISCAL — o caminhão não desentrega.
 * Apagar essa entrega do painel apagaria o histórico de um trabalho que foi
 * feito.
 *
 * 'cancelada' entra porque já está no destino: reconciliar de novo não muda nada.
 */
const DESFECHOS: readonly StatusLogistico[] = ['entregue', 'cancelada'];

/**
 * Decide o que fazer com um pedido a partir do status que o Órix devolveu.
 *
 * @param entrada          o antes (nosso banco) e o depois (Órix)
 * @param statusCancelado  códigos de cancelamento (config: sync_state, ex. ['00031'])
 */
export function decidirReconciliacao(
  entrada: EntradaReconciliacao,
  statusCancelado: readonly string[],
): AcaoReconciliacao {
  const {
    statusLogistico,
    statusOrixAtual,
    statusOrixNovo,
    statusOrixNomeAtual,
    statusOrixNomeNovo,
  } = entrada;

  // Sem código novo não há o que decidir (a API não devolveu status).
  if (statusOrixNovo === '') return 'nada';

  const mudouNoOrix =
    statusOrixNovo !== statusOrixAtual ||
    statusOrixNomeNovo !== statusOrixNomeAtual;

  // Cancelou no Órix e o pedido ainda está em aberto por aqui: tira da vista.
  if (
    statusCancelado.includes(statusOrixNovo) &&
    !DESFECHOS.includes(statusLogistico)
  ) {
    return 'cancelar';
  }

  // Note que NÃO existe o caminho de volta: se a OV deixar de estar cancelada
  // no Órix, o pedido não ressuscita sozinho. Restaurar é decisão humana — a
  // logística tem o "voltar" de cancelada -> pendente no quadro.
  return mudouNoOrix ? 'atualizar_orix' : 'nada';
}
