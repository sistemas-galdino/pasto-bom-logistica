// Entrega PARCIAL declarada na conclusão — documento "parte 3" da Natália e
// reunião de 24/09/2026 (migração 0025).
//
// Ao marcar a viagem como entregue, quem conclui diz quanto de cada produto o
// cliente de fato recebeu. O caso que motivou: levou 40, o cliente aceitou 20.
// Havendo diferença, pergunta-se se o cliente quer o restante — mas essa
// pergunta é da tela e do serviço. Aqui mora só a conta, porque ela roda em três
// lugares (o servidor, o formulário do Quadro e o do motorista) e três cópias da
// mesma conta divergem.
//
// Puro: sem relógio, sem banco, sem I/O.

/** Um produto como saiu no caminhão (é `EntregaItem`, sem o que não importa). */
export interface ItemCarregado {
  produtoCodigo: string;
  nomeProduto: string;
  /** O que foi carregado nesta viagem. */
  qtd: number;
}

export interface RestanteItem {
  produtoCodigo: string;
  nomeProduto: string;
  /** Carregado − entregue: o que voltou no caminhão. */
  qtd: number;
}

export interface ErroConclusao {
  produtoCodigo: string;
  mensagem: string;
}

export interface AvaliacaoConclusao {
  /** Algum produto foi entregue em quantidade menor do que a carregada. */
  divergiu: boolean;
  /** Quanto foi entregue de CADA produto da viagem, já normalizado. */
  entregues: Record<string, number>;
  /** O que voltou, só dos produtos que voltaram. Vazio quando bateu. */
  restante: RestanteItem[];
  /** Não vazio = a declaração não pode ser gravada. */
  erros: ErroConclusao[];
}

/**
 * Arredonda na 3ª casa, como `somar` em saldo.ts. Quantidade é fracionária
 * (0,5 t), e sem isso 0,1 + 0,2 inventaria uma divergência num pedido que bateu.
 */
function arred(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Confere a declaração de uma conclusão e calcula o restante.
 *
 * Produto que não aparece em `declarado` (ou vem null) vale o carregado: o caso
 * comum é bater, e ninguém deve precisar informar nada quando nada deu errado.
 *
 * Recusa — com a mensagem pronta para a tela:
 *   - quantidade negativa ou que não é número;
 *   - MAIS do que foi carregado (é erro de digitação, não um caso de uso);
 *   - produto que não está nesta viagem.
 */
export function avaliarConclusao(
  itens: readonly ItemCarregado[],
  declarado: Readonly<Record<string, number | null | undefined>> = {},
): AvaliacaoConclusao {
  const erros: ErroConclusao[] = [];
  const entregues: Record<string, number> = {};
  const restante: RestanteItem[] = [];
  const codigos = new Set(itens.map((i) => i.produtoCodigo));

  for (const codigo of Object.keys(declarado)) {
    if (!codigos.has(codigo)) {
      erros.push({
        produtoCodigo: codigo,
        mensagem: `O produto ${codigo} não está nesta viagem.`,
      });
    }
  }

  for (const item of itens) {
    const carregado = arred(item.qtd);
    const bruto = declarado[item.produtoCodigo];
    const nome = item.nomeProduto || item.produtoCodigo;

    if (bruto === null || bruto === undefined) {
      entregues[item.produtoCodigo] = carregado;
      continue;
    }
    if (typeof bruto !== 'number' || !Number.isFinite(bruto) || bruto < 0) {
      erros.push({
        produtoCodigo: item.produtoCodigo,
        mensagem: `Informe quanto de ${nome} o cliente recebeu (0 se nada).`,
      });
      continue;
    }
    const entregue = arred(bruto);
    if (entregue > carregado) {
      erros.push({
        produtoCodigo: item.produtoCodigo,
        mensagem: `${nome}: foram carregados ${carregado}, não dá para entregar ${entregue}.`,
      });
      continue;
    }
    entregues[item.produtoCodigo] = entregue;
    const volta = arred(carregado - entregue);
    if (volta > 0) {
      restante.push({ produtoCodigo: item.produtoCodigo, nomeProduto: item.nomeProduto, qtd: volta });
    }
  }

  return {
    divergiu: erros.length === 0 && restante.length > 0,
    entregues,
    restante: erros.length === 0 ? restante : [],
    erros,
  };
}

/**
 * A viagem entregou menos do que levou? Um pedido com alguma viagem assim é um
 * pedido PARCIAL, e é o que acende a tag AMARELA do número dele (ver
 * `Entrega.pedidoParcial`).
 *
 * Só a divergência declarada conta. O pedido dividido de propósito no
 * agendamento (duas viagens planejadas) NÃO é parcial aqui: dividir é rotina, e
 * se metade do quadro ficasse amarela a cor deixaria de significar alguma coisa
 * — decisão de 24/09/2026.
 */
export function temDivergencia(
  itens: readonly { qtd: number; qtdEntregue: number | null }[],
): boolean {
  return itens.some(
    (i) => i.qtdEntregue !== null && arred(i.qtdEntregue) < arred(i.qtd),
  );
}
