// PESO NO AGENDAMENTO — quais produtos ainda impedem a viagem de ser marcada,
// e quais só precisam de uma conferida.
//
// Por que isto é uma regra pura, e não um `if` na tela (áudios da Natália,
// 12/08/2026)
// ---------------------------------------------------------------------------
// Foi exatamente um `if` espalhado que criou o bug que estamos consertando. A
// trava "não dá para agendar sem saber o peso" morava no backend E no
// TransicaoModal; quando o modal foi substituído (commit 7343f9a), a metade da
// tela se perdeu e ficou só a do servidor. Resultado: o botão "Agendar entrega"
// ficava habilitado, a pessoa clicava, e o sistema respondia com um erro que ela
// não tinha como resolver em lugar nenhum.
//
// Com a decisão aqui, tela e backend enxergam a mesma coisa por construção.
//
// AS DUAS SITUAÇÕES
//   1. SEM PESO — o produto não tem peso nenhum cadastrado. Bloqueia: sem peso
//      não dá para saber se a carga cabe no caminhão. A pessoa digita e segue.
//   2. PESO MANUAL — o peso veio da equipe, não do nome do produto. Pede
//      confirmação a cada agendamento, porque foi isso que a Natália pediu: a
//      soja "sempre vem com peso diferente", então o valor guardado é uma
//      sugestão, não uma verdade. Editar o campo já vale como confirmar.
//
// Peso vindo do nome do produto (origem 'auto') não entra em nenhuma das duas:
// "CALCARIO ... 50T" pesa o que está escrito, e pedir confirmação disso todo dia
// seria ruído que ensina a equipe a clicar sem ler.

import type { OrigemPeso } from './types/domain.js';

/** Um produto que vai (ou pode ir) nesta viagem, do ponto de vista do peso. */
export interface LinhaPeso {
  produtoCodigo: string;
  nomeProduto: string;
  /** Peso unitário no cadastro; null = nunca foi determinado. */
  pesoUnitKg: number | null;
  /** null quando não há peso cadastrado. */
  pesoOrigem: OrigemPeso | null;
}

export interface EntradaPesoAgendamento {
  /** Os produtos com saldo que estão na tela. */
  linhas: readonly LinhaPeso[];
  /** Quantidade digitada por produto — só quem vai na viagem entra na conta. */
  quantidades: ReadonlyMap<string, number>;
  /** Peso digitado agora, por produto (kg por unidade). */
  pesosInformados: ReadonlyMap<string, number>;
  /** Produtos cujo peso a pessoa confirmou explicitamente (checkbox). */
  confirmados: ReadonlySet<string>;
}

export interface SituacaoPesoProduto {
  produtoCodigo: string;
  nomeProduto: string;
  /** O peso que vale agora: o digitado, se houver; senão o do cadastro. */
  pesoUnitKg: number | null;
}

export interface ResultadoPesoAgendamento {
  /** Produtos sem peso nenhum — o botão fica travado enquanto houver algum. */
  faltando: SituacaoPesoProduto[];
  /** Produtos com peso manual ainda não confirmados nesta tela. */
  aConfirmar: SituacaoPesoProduto[];
  /** Nada falta e nada pende de confirmação. */
  podeAgendar: boolean;
  /**
   * Peso unitário final de cada produto que vai na viagem — é o que o backend
   * grava congelado em `entrega_itens.peso_unit_kg`.
   */
  pesosFinais: Map<string, number>;
}

/** Peso digitado só conta se for um número maior que zero. */
function pesoValido(valor: number | undefined): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0;
}

/**
 * Diz o que ainda impede o agendamento, do lado do peso.
 *
 * Só olha os produtos que REALMENTE vão nesta viagem (quantidade > 0). Um
 * produto sem peso que ficou com quantidade zero não trava nada — a pessoa
 * decidiu não levá-lo, e exigir o peso dele seria pedir um dado que não muda
 * decisão nenhuma.
 */
export function avaliarPesoAgendamento(
  entrada: EntradaPesoAgendamento,
): ResultadoPesoAgendamento {
  const { linhas, quantidades, pesosInformados, confirmados } = entrada;

  const faltando: SituacaoPesoProduto[] = [];
  const aConfirmar: SituacaoPesoProduto[] = [];
  const pesosFinais = new Map<string, number>();

  // Deduplica por CÓDIGO: o peso é do produto, não da linha do pedido. Se o
  // mesmo produto aparecer duas vezes, digita-se uma vez só.
  const vistos = new Set<string>();

  for (const linha of linhas) {
    const codigo = linha.produtoCodigo;
    if (!codigo || vistos.has(codigo)) continue;

    const qtd = quantidades.get(codigo) ?? 0;
    if (!Number.isFinite(qtd) || qtd <= 0) continue;

    vistos.add(codigo);

    const digitado = pesosInformados.get(codigo);
    const peso = pesoValido(digitado) ? digitado : linha.pesoUnitKg;

    const situacao: SituacaoPesoProduto = {
      produtoCodigo: codigo,
      nomeProduto: linha.nomeProduto,
      pesoUnitKg: peso,
    };

    if (peso === null || peso <= 0) {
      faltando.push(situacao);
      continue;
    }

    pesosFinais.set(codigo, peso);

    // Digitar um peso É confirmar: a pessoa acabou de olhar o número.
    const jaConfirmou = confirmados.has(codigo) || pesoValido(digitado);
    if (linha.pesoOrigem === 'manual' && !jaConfirmou) {
      aConfirmar.push(situacao);
    }
  }

  return {
    faltando,
    aConfirmar,
    podeAgendar: faltando.length === 0 && aConfirmar.length === 0,
    pesosFinais,
  };
}
