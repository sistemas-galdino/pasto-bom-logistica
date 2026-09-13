// A COLUNA "AGENDADA" DO QUADRO — entregas e reservas na mesma pilha.
//
// POR QUE ISTO EXISTE
// ---------------------------------------------------------------------------
// Até 09/2026 a reserva de caminhão vivia numa faixa horizontal ACIMA das
// colunas do quadro. A Natália mostrou o problema na reunião de 27/08, de
// dentro da tela: "aí a gente economiza esse espaço, porque ontem travou o
// grid aqui, tá sem grid do lado, eu não consigo descer". A faixa come altura
// de todas as colunas o tempo todo para mostrar uma coisa que, na maioria dos
// dias, são uma ou duas reservas.
//
// Mudando a reserva para dentro da coluna Agendada aparece uma pergunta que a
// faixa não tinha: EM QUE ORDEM. Empilhar todas as reservas no topo é o que a
// faixa fazia — e dentro de uma coluna ordenada por data isso quebra a leitura:
// a reserva do mês que vem ficaria acima da entrega de amanhã, e quem desce a
// coluna procurando o dia 15 passaria por ela duas vezes.
//
// A ordem certa é a do CALENDÁRIO, que é como as duas coisas se parecem: as
// duas ocupam um caminhão num (dia, período). É a mesma ordem da agenda.

/** O mínimo que um cartão precisa ter para ser posto na fila do dia. */
export interface ItemAgendado {
  dataAgendada: string;
  /** Entrega legada pode não ter período; reserva sempre tem. */
  periodo: 'manha' | 'tarde' | null;
}

export type CartaoAgendada<E, R> =
  | { tipo: 'entrega'; entrega: E }
  | { tipo: 'reserva'; reserva: R };

/**
 * Peso de ordenação do período dentro do dia.
 *
 * `null` vai para o FIM do dia, e não para o começo: manhã → tarde é o plano
 * real daquele dia, e um cartão sem período não tem lugar dentro dele. Pondo-o
 * no fim, a leitura manhã→tarde continua inteira e o cartão ambíguo não empurra
 * para baixo o trabalho que tem hora marcada.
 */
function pesoPeriodo(periodo: 'manha' | 'tarde' | null): number {
  if (periodo === 'manha') return 0;
  if (periodo === 'tarde') return 1;
  return 2;
}

/**
 * Intercala entregas e reservas na ordem do calendário.
 *
 * DENTRO DO MESMO SLOT a reserva vem PRIMEIRO — mesma ordem da agenda
 * (`GrupoCaminhao`), e pela mesma razão: a reserva é o contexto do caminhão
 * naquele período. Ler "o caminhão está na oficina de manhã" depois das três
 * entregas daquela manhã é ler a explicação depois do fato.
 *
 * A ordenação é ESTÁVEL (é a garantia do `Array#sort` desde o ES2019) e compara
 * apenas dia, período e tipo. Empate preserva a ordem de entrada — o chamador
 * já entrega as listas ordenadas como quer, e reordenar de novo aqui seria uma
 * segunda opinião escondida sobre algo que não é desta função.
 */
export function ordenarCartoesAgendada<E extends ItemAgendado, R extends ItemAgendado>(
  entregas: readonly E[],
  reservas: readonly R[],
): CartaoAgendada<E, R>[] {
  const cartoes: CartaoAgendada<E, R>[] = [
    ...reservas.map((reserva) => ({ tipo: 'reserva' as const, reserva })),
    ...entregas.map((entrega) => ({ tipo: 'entrega' as const, entrega })),
  ];

  return cartoes.sort((a, b) => {
    const ia = a.tipo === 'entrega' ? a.entrega : a.reserva;
    const ib = b.tipo === 'entrega' ? b.entrega : b.reserva;

    const porData = ia.dataAgendada.localeCompare(ib.dataAgendada);
    if (porData !== 0) return porData;

    const porPeriodo = pesoPeriodo(ia.periodo) - pesoPeriodo(ib.periodo);
    if (porPeriodo !== 0) return porPeriodo;

    // Reserva antes de entrega no mesmo slot. Fora daqui, empate não se desfaz.
    if (a.tipo !== b.tipo) return a.tipo === 'reserva' ? -1 : 1;
    return 0;
  });
}
