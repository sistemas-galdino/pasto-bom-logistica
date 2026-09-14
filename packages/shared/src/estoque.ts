// ESTOQUE — "você está mandando 100 e tem 40".
//
// Pedido da Natália na reunião de 27/08/2026, e ela foi explícita sobre a
// natureza dele: é AVISO, JAMAIS BLOQUEIO. Travar o agendamento por estoque
// pararia a operação num ERP que erra cadastro — e o mesmo raciocínio que tirou
// a tonelagem do caminho do agendamento vale aqui.
//
// A DISTINÇÃO QUE ESTA REGRA EXISTE PARA PROTEGER
// ---------------------------------------------------------------------------
// `null` é "NÃO SEI", e nunca "zero". Produto que nunca foi espelhado, ou cujo
// código não bate com o do Órix, NÃO gera alerta. Confundir os dois
// transformaria o primeiro dia de uso — com a tabela ainda vazia — num alerta
// em cada item da tela. E um aviso que grita em tudo ensina a equipe a
// ignorá-lo; depois disso, o aviso verdadeiro passa batido junto.
//
// (A conferência de 14/09/2026 contra a API mostrou que o caso é raro na
// prática: dos 632 produtos que a operação entrega, 100% estão no /Produtos. O
// tratamento existe para o produto novo, para o código que não casa e para o
// primeiro ciclo.)

export type NivelEstoque =
  /** Não espelhado ainda, ou quantidade ilegível. Não gera alerta. */
  | 'desconhecido'
  /** Tem o bastante para esta viagem. */
  | 'ok'
  /** Tem, mas menos do que está sendo mandado. */
  | 'insuficiente'
  /** O ERP está com saldo negativo neste produto. */
  | 'negativo';

export interface EntradaEstoque {
  /** O que o espelho diz que existe. null = não sei. */
  quantidadeEstoque: number | null | undefined;
  /** O que está sendo mandado nesta viagem. */
  quantidadePedida: number;
}

export interface ResultadoEstoque {
  nivel: NivelEstoque;
  /** Quanto falta para cobrir o pedido. 0 quando cobre ou não se sabe. */
  faltamUnidades: number;
  /** true para 'insuficiente' e 'negativo' — os dois casos que a tela mostra. */
  avisar: boolean;
}

/** Arredonda na 3ª casa, como `somar` em saldo.ts — ver o comentário abaixo. */
function arredondar(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Compara o que se quer mandar com o que o espelho diz que existe.
 *
 * QUANTIDADE PEDIDA ZERO NÃO AVISA: o item está na tela mas não vai nesta
 * viagem, e alertar sobre ele seria barulho sobre uma linha que a pessoa já
 * decidiu deixar de fora.
 *
 * ESTOQUE NEGATIVO AVISA SOZINHO, mesmo que a quantidade pedida caiba
 * "matematicamente". Saldo negativo no ERP é sinal de cadastro torto ou de
 * baixa que não aconteceu, e quem está agendando precisa saber antes de mandar
 * o caminhão — foi metade do pedido dela.
 *
 * ARREDONDAMENTO NA 3ª CASA, mesmo critério de `somar` em saldo.ts: a API
 * devolve coisas como -4,44e-16 (produto 08402, medido em 14/09/2026), e sem
 * isso um produto com estoque exatamente zero apareceria como negativo.
 */
export function avaliarEstoque(entrada: EntradaEstoque): ResultadoEstoque {
  const bruto = entrada.quantidadeEstoque;
  const nada: ResultadoEstoque = {
    nivel: 'desconhecido',
    faltamUnidades: 0,
    avisar: false,
  };

  if (bruto === null || bruto === undefined || !Number.isFinite(bruto)) {
    return nada;
  }

  const estoque = arredondar(bruto);
  const pedida = Number.isFinite(entrada.quantidadePedida)
    ? arredondar(entrada.quantidadePedida)
    : 0;

  if (estoque < 0) {
    return {
      nivel: 'negativo',
      faltamUnidades: pedida > 0 ? arredondar(pedida - estoque) : 0,
      avisar: true,
    };
  }

  if (pedida <= 0) return { nivel: 'ok', faltamUnidades: 0, avisar: false };

  if (pedida > estoque) {
    return {
      nivel: 'insuficiente',
      faltamUnidades: arredondar(pedida - estoque),
      avisar: true,
    };
  }

  return { nivel: 'ok', faltamUnidades: 0, avisar: false };
}

/**
 * Há quantas HORAS o espelho leu este número. null se a data não presta.
 *
 * O frescor entra no texto do aviso de propósito: "estoque 40" sem idade é um
 * palpite com cara de fato. Estoque é movimento — o espelho roda a cada 3 h, e
 * um número de ontem (servidor fora a noite toda) precisa se apresentar como
 * tal, senão o aviso vira falso alarme e perde a credibilidade que ele existe
 * para ter.
 *
 * Devolve HORAS, não texto: "há 2 h" é pt-BR e é a tela que escreve.
 */
export function horasDesde(
  atualizadoEm: string | null | undefined,
  agoraMs: number,
): number | null {
  if (!atualizadoEm) return null;
  const ms = Date.parse(atualizadoEm);
  if (Number.isNaN(ms)) return null;
  const horas = (agoraMs - ms) / 3_600_000;
  // Relógio torto (espelho "do futuro") não vira idade negativa na tela.
  return horas < 0 ? 0 : horas;
}
