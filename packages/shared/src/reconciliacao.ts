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

// ---------------------------------------------------------------------------
// AUSÊNCIA: o pedido que sumiu da resposta do Órix
// ---------------------------------------------------------------------------
//
// Por que isso existe (áudio da Natália, 05/08/2026):
//   "aparecer o que foi concluído também não é para ficar aparecendo aí mais"
//
// A reconciliação consulta o Órix nos status de GATILHO + CANCELADO. O pedido
// que é FATURADO sai do gatilho (vira 00030) e some da resposta — e o código
// antigo simplesmente o ignorava, deixando-o preso na coluna Pendente para
// sempre. Eram 52 pedidos parados há mais de um mês.
//
// A correção NÃO precisa consultar o 00030 (seria toda venda faturada do
// período, dezenas de milhares de linhas contra um servidor que já cai
// sozinho). A ausência já é o sinal: se a data do pedido está dentro da janela
// que foi consultada e ele não voltou, ele não está nem em gatilho nem
// cancelado. Só sobra ter saído por baixo.
//
// A ausência é um sinal INDIRETO, então nunca age na primeira vez: marca a
// data, e só descarta depois de uma carência. Quem chama cuida do freio de
// volume (resposta anormalmente vazia do Órix não pode virar limpeza em massa).

/** O que fazer com um pedido que NÃO veio na resposta do Órix. */
export type AcaoAusencia =
  /** Não mexe: protegido por alguma guarda, ou a carência ainda não venceu. */
  | 'nada'
  /** Primeira ausência observada: grava o carimbo e espera a carência. */
  | 'marcar_ausente'
  /** Ausente tempo suficiente: sai do quadro (vai para Descartados). */
  | 'descartar';

export interface EntradaAusencia {
  /** Status logístico atual no nosso banco. */
  statusLogistico: StatusLogistico;
  /** Data do pedido (yyyy-mm-dd). Nula quando o Órix não informou. */
  dataPedido: string | null;
  /** Início da janela realmente consultada no Órix (yyyy-mm-dd). */
  janelaInicial: string;
  /** Fim da janela realmente consultada no Órix (yyyy-mm-dd). */
  janelaFinal: string;
  /** O pedido tem entrega 'agendada' ou 'em_rota'? */
  temEntregaAtiva: boolean;
  /** Quando a ausência foi observada pela primeira vez (ISO), ou null. */
  ausenteDesde: string | null;
  /** Agora (ISO) — injetado para o teste ser determinístico. */
  agora: string;
}

/**
 * Decide o que fazer com um pedido em aberto que não apareceu na resposta do
 * Órix.
 *
 * @param entrada        estado do pedido e da janela que foi consultada
 * @param horasCarencia  quanto tempo de ausência antes de descartar (0 = já)
 */
export function decidirAusencia(
  entrada: EntradaAusencia,
  horasCarencia: number,
): AcaoAusencia {
  const {
    statusLogistico,
    dataPedido,
    janelaInicial,
    janelaFinal,
    temEntregaAtiva,
    ausenteDesde,
    agora,
  } = entrada;

  // Mesma garantia da reconciliação: desfecho não se rebaixa por leitura.
  if (DESFECHOS.includes(statusLogistico)) return 'nada';

  // Sem data não dá para afirmar que o pedido estava na janela consultada.
  // Ausência de um pedido que nunca foi perguntado não prova nada.
  if (!dataPedido) return 'nada';

  // Fora da janela: a varredura tem teto (MAX_DIAS_RETROATIVOS). Um pedido
  // anterior ao corte "some" da resposta porque não foi perguntado — não
  // porque saiu do gatilho. Descartar aqui seria apagar pedido por engano.
  if (dataPedido < janelaInicial || dataPedido > janelaFinal) return 'nada';

  // A carga já está no caminhão do Johnny. Mesmo que o Órix já tenha faturado,
  // não se arranca do quadro uma viagem em andamento: quem encerra é a equipe,
  // dando baixa. O pedido é reavaliado quando a entrega terminar.
  if (temEntregaAtiva) return 'nada';

  // Primeira vez: só carimba, e a decisão fica para o próximo ciclo.
  //
  // Exceção: carência zero é o script one-shot, rodado à mão depois de um
  // --dry conferido por gente. Ali a espera não protege ninguém — quem decidiu
  // já olhou a lista.
  if (!ausenteDesde) {
    return horasCarencia <= 0 ? 'descartar' : 'marcar_ausente';
  }

  const decorridoMs = Date.parse(agora) - Date.parse(ausenteDesde);
  if (Number.isNaN(decorridoMs)) return 'nada';

  return decorridoMs >= horasCarencia * 3_600_000 ? 'descartar' : 'nada';
}
