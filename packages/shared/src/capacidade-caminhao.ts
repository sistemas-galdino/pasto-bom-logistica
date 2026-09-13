// CAPACIDADE DO CAMINHÃO — quanto o caminhão já leva num slot, e se passou.
//
// POR QUE ISTO VIROU REGRA PURA EM 09/2026
// ---------------------------------------------------------------------------
// Até 27/08/2026 a tonelagem RECUSAVA agendamento: `validarCargaDoAgendamento`
// lançava 422 `capacidade_excedida` e pronto — a comparação do servidor era a
// verdade, e o que a tela desenhava era enfeite. Na reunião daquele dia a
// Natália fechou o contrário com o consultor:
//
//   "o peso não tem problema. Você pode deixar ele mostrando em todos os
//    lugares, mostrando na agenda, mas que ele não seja um impeditivo de
//    agendamento, mas que ele sinalize para ele se aquele caminhão já tá lotado
//    ou não."
//
// Com isso a comparação deixa de ser trava e vira A INFORMAÇÃO — a única coisa
// que sobra para quem decide se manda o caminhão assim mesmo. E aí ela não pode
// mais estar escrita em três lugares diferentes.
//
// E ELAS JÁ DISCORDAVAM. Antes desta função havia três cópias:
//
//   components/agenda/GrupoCaminhao.tsx   `usadoKg >= capacidadeKg`  -> vermelho
//   components/agenda/Visoes.tsx          `usadoKg >= capacidadeKg`  -> vermelho
//   services/carga.ts                     `total    >  capacidadeKg` -> recusava
//
// Um caminhão fechado EXATAMENTE na capacidade aparecia vermelho na agenda e
// passava no servidor. Enquanto o vermelho era decoração, dava para conviver;
// virando o sinal que decide, não dá. Aqui a divergência se resolve a favor do
// servidor: fechar na capacidade é `cheio`, não `excedido`.

/**
 * Três níveis, e não dois, porque "fechou o caminhão" e "passou do caminhão"
 * pedem ações diferentes de quem lê: no primeiro caso não cabe mais nada, no
 * segundo alguém precisa conferir a carga antes de o caminhão sair.
 */
export type NivelCapacidade = 'folga' | 'cheio' | 'excedido';

export interface EntradaCapacidade {
  /** 0 ou não-finito = capacidade desconhecida (grupo sem caminhão na agenda). */
  capacidadeKg: number;
  /** O que já está marcado no slot: entregas + reservas. */
  usadoKg: number;
  /** O que se quer acrescentar agora. 0 na agenda, o peso da viagem no modal. */
  adicionalKg?: number;
}

export interface ResultadoCapacidade {
  capacidadeKg: number;
  usadoKg: number;
  totalKg: number;
  /** max(0, total − capacidade). Sempre 0 quando a capacidade é desconhecida. */
  excedenteKg: number;
  excedeu: boolean;
  nivel: NivelCapacidade;
  /**
   * 0..N para a barra; null quando a capacidade é desconhecida.
   *
   * NÃO é limitado a 100 de propósito: quem desenha a barra decide o clamp, e
   * quem escreve o texto precisa do número verdadeiro para poder dizer "125% da
   * capacidade". Limitar aqui esconderia o tamanho do estouro.
   */
  percentual: number | null;
}

/** Arredonda na 3ª casa, como `somar` em saldo.ts — ver o comentário abaixo. */
function arredondar(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function naoNegativo(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Avalia a carga de um caminhão num slot.
 *
 * ARREDONDAMENTO: a comparação acontece na 3ª casa decimal, mesmo critério de
 * `somar` em saldo.ts. Sem isso, 6999,9995 + 0,0006 "excede" 7000 por ponto
 * flutuante e o caminhão fica vermelho sem ter passado de nada — num sinal que
 * a equipe vai usar para decidir se o caminhão sai, isso queima a confiança na
 * cor inteira.
 *
 * CAPACIDADE DESCONHECIDA (0 ou NaN) não é "capacidade zero": é o caso de
 * `agenda.ts`, que monta a ocupação com `caminhao?.capacidadeKg ?? 0` quando o
 * caminhão saiu da frota depois do agendamento. Tratar como zero pintaria de
 * vermelho toda viagem antiga de caminhão desativado.
 */
export function avaliarCapacidade(
  entrada: EntradaCapacidade,
): ResultadoCapacidade {
  const capacidadeKg = naoNegativo(entrada.capacidadeKg);
  const usadoKg = naoNegativo(entrada.usadoKg);
  const adicionalKg = naoNegativo(entrada.adicionalKg ?? 0);
  const totalKg = arredondar(usadoKg + adicionalKg);

  if (capacidadeKg === 0) {
    return {
      capacidadeKg: 0,
      usadoKg,
      totalKg,
      excedenteKg: 0,
      excedeu: false,
      nivel: 'folga',
      percentual: null,
    };
  }

  const cap = arredondar(capacidadeKg);
  const excedeu = totalKg > cap;
  const nivel: NivelCapacidade = excedeu
    ? 'excedido'
    : totalKg === cap
      ? 'cheio'
      : 'folga';

  return {
    capacidadeKg: cap,
    usadoKg,
    totalKg,
    excedenteKg: excedeu ? arredondar(totalKg - cap) : 0,
    excedeu,
    nivel,
    percentual: arredondar((totalKg / cap) * 100),
  };
}
