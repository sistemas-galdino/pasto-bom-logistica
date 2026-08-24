// Datas do calendário da UI — SEMPRE locais.
//
// A regra que este arquivo existe para proteger: as datas do domínio chegam como
// 'YYYY-MM-DD' e `new Date('YYYY-MM-DD')` as interpreta como UTC. No fuso do
// Brasil isso volta UM DIA — a entrega de segunda aparece no domingo. Toda
// conversão passa por `dataDeIso`/`isoDeData`, que constroem a data pelos
// componentes (ano, mês, dia) e ficam imunes a fuso.
//
// Por que aqui, e não em cada tela: estes helpers nasceram na Agenda e foram
// copiados byte a byte para a Separação e para a folha de impressão. Três copias
// da mesma armadilha de fuso é uma a mais do que cabe — na próxima correção,
// duas delas ficariam para trás.

/** 'YYYY-MM-DD' de uma Date local. */
export function isoDeData(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * Date LOCAL a partir de 'YYYY-MM-DD'.
 *
 * É a metade que impede o deslocamento de fuso; `new Date(iso)` no lugar disto é
 * o bug clássico desta tela.
 */
export function dataDeIso(iso: string): Date {
  const [ano, mes, dia] = iso.split('-').map((p) => Number(p));
  return new Date(ano ?? 1970, (mes ?? 1) - 1, dia ?? 1);
}

/** Hoje, zerado na meia-noite local (comparável com as datas da grade). */
export function hojeLocal(): Date {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
}

export function addDias(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Primeiro dia do mês deslocado em `n` meses. */
export function addMeses(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Domingo da semana de `d` — a grade do calendário começa no domingo. */
export function inicioDaSemana(d: Date): Date {
  return addDias(d, -d.getDay());
}

export function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
