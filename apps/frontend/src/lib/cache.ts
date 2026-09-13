// INVALIDAÇÃO depois de mexer na agenda.
//
// Agendar, reagendar, reservar ou pôr em rota muda quatro coisas que são
// buscadas por chaves diferentes: o pedido (o saldo dele diminuiu), as entregas
// (o quadro), a agenda (o calendário e a ocupação do caminhão) e as reservas (o
// caminhão ficou tomado, ou deixou de ficar).
//
// Isto nasceu como `invalidarTudo` dentro do Quadro. Com a tela de Agendamento
// (09/2026) agendando também, a lista passou a existir em dois lugares — e o
// jeito de essa duplicação falhar é o pior: esquecer UMA chave não dá erro
// nenhum, só deixa o calendário mostrando a carga esperando no galpão depois de
// ela já ter saído.

import type { QueryClient } from '@tanstack/react-query';

/** Derruba tudo o que um agendamento (ou uma reserva) muda. Por PREFIXO. */
export function invalidarAgendamento(queryClient: QueryClient): void {
  for (const chave of ['pedidos', 'entregas', 'agenda', 'reservas']) {
    void queryClient.invalidateQueries({ queryKey: [chave] });
  }
}
