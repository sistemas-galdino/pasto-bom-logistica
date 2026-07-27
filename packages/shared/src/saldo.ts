// SALDO — o que de um pedido ainda não foi para nenhuma viagem.
//
// É a peça central do modelo de entregas (Onda 2). A coluna "Pendente" do
// quadro mostra saldo; o agendamento propõe o saldo como quantidade padrão; e a
// devolução do saldo quando uma entrega falha acontece AQUI, por consequência
// da regra — não por um comando em algum lugar.
//
// A REGRA
//   saldo(produto) = Σ qtd do pedido − Σ qtd das entregas que CONSOMEM saldo
//
// Consomem saldo: agendada, em_rota, entregue.
//   - agendada / em_rota: a mercadoria está reservada para uma viagem.
//   - entregue: já saiu de vez.
// NÃO consomem: nao_realizado, cancelada.
//   - nao_realizado: o caminhão voltou com a carga. Ela está de novo disponível.
//   - cancelada: o agendamento foi desfeito.
//
// Repare no que isso dispensa: não existe rotina de "devolver o saldo". Quando
// uma entrega vira nao_realizado, ela simplesmente para de contar, e o saldo
// reaparece na fila. Um caminho a menos para esquecer de percorrer.

import type { StatusEntrega, SaldoItem } from './types/domain.js';

/** Status de entrega que seguram mercadoria (e portanto consomem saldo). */
export const STATUS_QUE_CONSOMEM_SALDO: readonly StatusEntrega[] = [
  'agendada',
  'em_rota',
  'entregue',
];

/** A entrega neste status tira mercadoria do saldo do pedido? */
export function consomeSaldo(status: StatusEntrega): boolean {
  return STATUS_QUE_CONSOMEM_SALDO.includes(status);
}

/** Uma linha de item do PEDIDO (o que o Órix diz que foi vendido). */
export interface LinhaItemPedido {
  produtoCodigo: string;
  nomeProduto: string;
  qtd: number;
  pesoUnitKg?: number | null;
}

/** Uma linha de item de uma ENTREGA já existente do mesmo pedido. */
export interface LinhaItemEntrega {
  produtoCodigo: string;
  qtd: number;
  /** Status da entrega dona desta linha — é ele que decide se conta. */
  statusEntrega: StatusEntrega;
}

/** Soma tolerante a lixo numérico (a API do Órix já mandou string com vírgula). */
function somar(a: number, b: number): number {
  const x = Number.isFinite(a) ? a : 0;
  const y = Number.isFinite(b) ? b : 0;
  // Arredonda na 3ª casa: quantidades são fracionárias (0,5 t) e a soma de
  // ponto flutuante deixaria 79.99999999999999 no lugar de 80.
  return Math.round((x + y) * 1000) / 1000;
}

/**
 * Calcula o saldo de cada produto de um pedido.
 *
 * Agrega por CÓDIGO DE PRODUTO, não por linha: há pedidos que trazem o mesmo
 * produto em duas linhas, e para a entrega o que importa é "quantos sacos de
 * adubo ainda faltam", não em qual linha eles estavam.
 *
 * Devolve uma linha por produto do pedido, na ordem em que apareceram —
 * INCLUSIVE as zeradas, porque a tela precisa saber que aquele produto existe e
 * já foi todo entregue (senão o item some do cartão sem explicação).
 */
export function calcularSaldo(
  itensDoPedido: readonly LinhaItemPedido[],
  itensDasEntregas: readonly LinhaItemEntrega[],
): SaldoItem[] {
  // 1) Total vendido por produto, preservando a ordem de aparição.
  const ordem: string[] = [];
  const totais = new Map<string, { nome: string; qtd: number; peso: number | null }>();

  for (const item of itensDoPedido) {
    const codigo = item.produtoCodigo;
    if (!codigo) continue;
    const atual = totais.get(codigo);
    if (atual) {
      atual.qtd = somar(atual.qtd, item.qtd);
      // Peso: o primeiro conhecido vale (é o mesmo produto).
      if (atual.peso === null && item.pesoUnitKg != null) atual.peso = item.pesoUnitKg;
    } else {
      ordem.push(codigo);
      totais.set(codigo, {
        nome: item.nomeProduto,
        qtd: Number.isFinite(item.qtd) ? item.qtd : 0,
        peso: item.pesoUnitKg ?? null,
      });
    }
  }

  // 2) Comprometido por produto (só as entregas que consomem saldo).
  const comprometido = new Map<string, number>();
  for (const linha of itensDasEntregas) {
    if (!consomeSaldo(linha.statusEntrega)) continue;
    const codigo = linha.produtoCodigo;
    if (!codigo) continue;
    comprometido.set(codigo, somar(comprometido.get(codigo) ?? 0, linha.qtd));
  }

  // 3) Saldo.
  return ordem.map((codigo) => {
    const total = totais.get(codigo) as { nome: string; qtd: number; peso: number | null };
    const usado = comprometido.get(codigo) ?? 0;
    // Nunca negativo: se o Órix reduzir a quantidade de um pedido que já saiu
    // (acontece — a faturista corrige a OV), o saldo é zero, não uma dívida.
    const saldo = Math.max(0, somar(total.qtd, -usado));
    return {
      produtoCodigo: codigo,
      nomeProduto: total.nome,
      qtdPedido: total.qtd,
      qtdComprometida: usado,
      qtdSaldo: saldo,
      pesoUnitKg: total.peso,
    };
  });
}

/** O pedido ainda tem alguma coisa para entregar? (é o filtro da coluna Pendente) */
export function temSaldo(saldo: readonly SaldoItem[]): boolean {
  return saldo.some((s) => s.qtdSaldo > 0);
}

/** Só os produtos que ainda têm o que entregar (o que o agendamento oferece). */
export function apenasComSaldo(saldo: readonly SaldoItem[]): SaldoItem[] {
  return saldo.filter((s) => s.qtdSaldo > 0);
}

/**
 * Peso total de um conjunto de quantidades, em kg.
 * `null` se ALGUM produto envolvido não tem peso cadastrado — sem isso não dá
 * para saber se a carga cabe no caminhão, e o agendamento trava pedindo o peso.
 */
export function pesoDaCarga(
  linhas: readonly { qtd: number; pesoUnitKg: number | null }[],
): number | null {
  let total = 0;
  for (const linha of linhas) {
    if (linha.pesoUnitKg === null) return null;
    total += linha.pesoUnitKg * linha.qtd;
  }
  return Math.round(total * 1000) / 1000;
}

/**
 * Valida as quantidades que a pessoa digitou no agendamento contra o saldo.
 * Devolve a lista de problemas em português, pronta para a tela — vazia = ok.
 */
export function validarQuantidades(
  saldo: readonly SaldoItem[],
  quantidades: ReadonlyMap<string, number>,
): string[] {
  const erros: string[] = [];
  let algumaPositiva = false;

  for (const [codigo, qtd] of quantidades) {
    const item = saldo.find((s) => s.produtoCodigo === codigo);
    if (!item) {
      erros.push(`Produto ${codigo} não faz parte deste pedido.`);
      continue;
    }
    if (!Number.isFinite(qtd) || qtd < 0) {
      erros.push(`Quantidade inválida em ${item.nomeProduto}.`);
      continue;
    }
    // Marcado ANTES da checagem de saldo: quem digitou 81 num saldo de 80 está
    // tentando mandar alguma coisa. Só o erro do excesso importa — acrescentar
    // "informe pelo menos um produto" mandaria a pessoa procurar problema onde
    // não tem.
    if (qtd > 0) algumaPositiva = true;

    if (qtd > item.qtdSaldo) {
      erros.push(
        `${item.nomeProduto}: restam ${item.qtdSaldo} e você pediu ${qtd}.`,
      );
    }
  }

  if (!algumaPositiva) {
    erros.push('Informe a quantidade de pelo menos um produto para esta entrega.');
  }
  return erros;
}
