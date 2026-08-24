// Vocabulário do SLOT, compartilhado pelos componentes de calendário.
//
// O domínio da agenda é SLOT = (data + período manhã/tarde), e tanto as visões
// (mês/semana/dia) quanto a página que as monta precisam falar dessa mesma
// chave. Como as visões varrem os dias por conta própria (o mês monta 5 ou 6
// semanas de células), não dá para receber o slot já resolvido por prop: elas
// precisam da função. Ela mora aqui, e a página importa DAQUI — assim existe uma
// única definição de chave, e não duas que podem divergir em silêncio.

import type { PeriodoEntrega } from '@pastobom/shared';

/** Visões do calendário. */
export type Visao = 'mes' | 'semana' | 'dia';

export const PERIODOS: PeriodoEntrega[] = ['manha', 'tarde'];

export const PERIODO_ROTULO: Record<PeriodoEntrega, string> = {
  manha: 'Manhã',
  tarde: 'Tarde',
};

export function chaveSlot(data: string, periodo: PeriodoEntrega): string {
  return `${data}|${periodo}`;
}
