// Vocabulário do SLOT, compartilhado pelos componentes de calendário.
//
// O domínio da agenda é SLOT = (data + período manhã/tarde), e tanto as visões
// (mês/semana/dia) quanto a página que as monta precisam falar dessa mesma
// chave. Como as visões varrem os dias por conta própria (o mês monta 5 ou 6
// semanas de células), não dá para receber o slot já resolvido por prop: elas
// precisam da função. Ela mora aqui, e a página importa DAQUI — assim existe uma
// única definição de chave, e não duas que podem divergir em silêncio.

import type {
  PeriodoEntrega,
  RotaCidadeNoSlot,
  VisaoAgenda,
} from '@pastobom/shared';

/**
 * Visões do calendário.
 *
 * ALIAS do tipo do shared, e não uma segunda união escrita à mão: quem calcula
 * o intervalo de cada visão é `intervaloDaVisao` (packages/shared), e duas
 * uniões com os mesmos três valores só existem para, um dia, discordarem.
 */
export type Visao = VisaoAgenda;

export const PERIODOS: PeriodoEntrega[] = ['manha', 'tarde'];

export const PERIODO_ROTULO: Record<PeriodoEntrega, string> = {
  manha: 'Manhã',
  tarde: 'Tarde',
};

export function chaveSlot(data: string, periodo: PeriodoEntrega): string {
  return `${data}|${periodo}`;
}

/**
 * Ocorrências de rota de cidade indexadas pela MESMA chave de slot.
 *
 * Mora aqui, ao lado de `chaveSlot`, porque este é o único arquivo que conhece
 * o formato da chave — montá-la à mão numa página faria a segunda definição, e
 * duas definições de chave divergem sem produzir erro: só somem os chips.
 *
 * Um slot pode ter mais de uma cidade (duas cidades de manhã é uso normal),
 * então o valor é lista.
 */
export function indexarRotasPorSlot(
  rotas: readonly RotaCidadeNoSlot[],
): Map<string, RotaCidadeNoSlot[]> {
  const mapa = new Map<string, RotaCidadeNoSlot[]>();
  for (const r of rotas) {
    const chave = chaveSlot(r.data, r.periodo);
    const lista = mapa.get(chave);
    if (lista) lista.push(r);
    else mapa.set(chave, [r]);
  }
  return mapa;
}

/** As rotas de um DIA inteiro (manhã + tarde), para a visão de Mês. */
export function rotasDoDia(
  porSlot: Map<string, RotaCidadeNoSlot[]>,
  data: string,
): RotaCidadeNoSlot[] {
  return [
    ...(porSlot.get(chaveSlot(data, 'manha')) ?? []),
    ...(porSlot.get(chaveSlot(data, 'tarde')) ?? []),
  ];
}
