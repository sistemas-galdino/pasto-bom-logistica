// Máquina de estados do PEDIDO (a ordem de venda).
//
// ATENÇÃO — mudou de escopo na Onda 2. O ciclo da VIAGEM (agendar, despachar,
// entregar, não realizar) migrou para a ENTREGA e vive em
// entrega-state-machine.ts. Aqui ficou só a situação da ORDEM DE VENDA:
//
//   pendente  = em aberto (o quadro decide se mostra pelo SALDO, não por aqui)
//   entregue  = saldo zerado e nenhuma viagem em aberto
//   cancelada = cancelada no Órix, ou descartada pela logística
//
// Os valores 'agendada', 'em_rota' e 'nao_realizado' continuam no enum do banco
// (o Postgres não remove valor de enum sem recriar o tipo) e no tipo, mas NÃO
// são mais usados no pedido — são estados de viagem. Por isso aparecem abaixo
// com transições vazias: nenhum pedido deveria estar neles depois da migração
// 0014, e se algum estiver, ele fica parado em vez de andar por um caminho que
// não existe mais.

import type { StatusLogistico } from './types/domain.js';

/**
 * Transições permitidas a partir de cada status do PEDIDO.
 *
 * Sobrou uma só: descartar um pedido que não é entrega ("Descartar (não é
 * entrega)" no quadro). O caminho de volta está em REVERSOES.
 *
 * `entregue` não é destino de transição manual: quem coloca o pedido lá é o
 * serviço de entregas, quando o saldo zera e não há viagem em aberto.
 */
export const TRANSICOES: Record<StatusLogistico, StatusLogistico[]> = {
  pendente: ['cancelada'],
  entregue: [],
  cancelada: [],
  // Legado da Onda 1 — estados de viagem, hoje em entregas.status.
  agendada: [],
  em_rota: [],
  nao_realizado: [],
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
 * Reversões permitidas — exclusivas da logística e SEM disparo de WhatsApp.
 *
 *   cancelada -> pendente  (restaura um descarte — "é só por causa de clicar
 *                           errado", Johnny na reunião de 25/06)
 *
 * As reversões de viagem (desfazer despacho, remarcar o que não deu certo)
 * migraram para REVERSOES_ENTREGA. Em especial: "remarcar" deixou de ser uma
 * reversão. Uma entrega que falhou fica no histórico e o saldo volta sozinho
 * para o pedido — remarcar é agendar uma entrega NOVA.
 */
export const REVERSOES: Record<StatusLogistico, StatusLogistico[]> = {
  pendente: [],
  entregue: [],
  cancelada: ['pendente'],
  // Legado — ver comentário no topo.
  agendada: [],
  em_rota: [],
  nao_realizado: [],
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
 * Template de WhatsApp de uma transição do PEDIDO.
 *
 * Hoje é SEMPRE null, e isso é o correto: a única transição que sobrou no
 * pedido é o descarte (-> cancelada), que nunca avisou ninguém. Todas as
 * mensagens ao cliente nascem de uma VIAGEM e vivem em
 * templateDaTransicaoEntrega.
 *
 * A função continua existindo porque `aplicarTransicao` a consulta antes de
 * disparar qualquer coisa — é a garantia, no código, de que descartar um pedido
 * não manda mensagem para o cliente.
 */
export function templateDaTransicao(
  de: StatusLogistico,
  para: StatusLogistico,
): TemplateWhatsapp {
  if (!podeTransicionar(de, para)) {
    return null;
  }
  return null;
}
