// A BORDA entre o intervalo (ISO, do shared) e o calendário desenhado (Date).
//
// `intervaloDaVisao` fala ISO nas duas pontas de propósito — é assim que o fuso
// não entra no cálculo. Mas as visões recebem `dias: Date[]`, porque quem
// desenha a célula precisa do dia da semana e do nome do mês. A conversão
// acontece AQUI, num lugar só, e sempre por `dataDeIso` (Date local), nunca por
// `new Date(iso)`, que seria UTC e voltaria um dia no Brasil.
//
// `tituloDoPeriodo` também mora aqui, e não no shared: "Setembro de 2026" é
// vocabulário de tela. O shared é regra compartilhada com o backend, e o
// backend não tem por que carregar rótulo em pt-BR.

import { intervaloDaVisao, type IntervaloAgenda } from '@pastobom/shared';
import { capitalizar, dataDeIso } from '../../lib/datas';
import type { Visao } from './slots';

export interface IntervaloDesenhavel extends IntervaloAgenda {
  /** Os mesmos `dias`, como Date local, para as visões desenharem. */
  diasData: Date[];
}

/** O intervalo da visão, pronto para a tela: ISO para as queries, Date para a grade. */
export function intervaloParaTela(
  visao: Visao,
  ancoraIso: string,
): IntervaloDesenhavel {
  const intervalo = intervaloDaVisao(visao, ancoraIso);
  return { ...intervalo, diasData: intervalo.dias.map(dataDeIso) };
}

/** O rótulo do período no cabeçalho: "Setembro de 2026", "13/09 – 19/09 de 2026". */
export function tituloDoPeriodo(
  visao: Visao,
  intervalo: IntervaloAgenda,
  ancoraIso: string,
): string {
  const ancora = dataDeIso(ancoraIso);
  if (visao === 'dia') {
    return capitalizar(
      ancora.toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }),
    );
  }
  if (visao === 'semana') {
    const curto = (iso: string) =>
      dataDeIso(iso).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      });
    return `${curto(intervalo.inicio)} – ${curto(intervalo.fim)} de ${dataDeIso(intervalo.fim).getFullYear()}`;
  }
  return capitalizar(
    ancora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  );
}
