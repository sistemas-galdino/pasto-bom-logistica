// A legenda de cores do topo da agenda.
//
// Fica nesta pasta porque a agenda do caminhão (tela de Rota) mostra os mesmos
// cartões e precisa da mesma legenda — e uma legenda duplicada é uma legenda que
// um dia mente.

import React from 'react';
import { STATUS_META } from '../status';

/**
 * Legenda de cores da agenda (pedido da reunião de 16/07/2026): o vendedor bate
 * o olho e sabe se a entrega já saiu, sem abrir o cartão — "o cliente liga para
 * o vendedor para saber se tá entregando".
 *
 * As cores vêm de STATUS_META, as MESMAS dos cartões: mudar a paleta lá muda a
 * legenda junto, sem chance de a legenda mentir. Entregue não entra porque some
 * da agenda (a rota só devolve 'agendada' e 'em_rota').
 */
export function Legenda(): React.ReactElement {
  const itens: { status: 'agendada' | 'em_rota' }[] = [
    { status: 'agendada' },
    { status: 'em_rota' },
  ];

  return (
    <div className="flex items-center gap-3">
      {itens.map(({ status }) => (
        <span
          key={status}
          className="flex items-center gap-1.5 text-xs text-tinta-suave"
        >
          <span
            className={`h-2.5 w-2.5 rounded-full ${STATUS_META[status].faixa}`}
            aria-hidden="true"
          />
          {STATUS_META[status].rotulo}
        </span>
      ))}
      {/* A reserva não é um status de entrega — é o caminhão ocupado por outra
          coisa. Entra na legenda porque o tracejado do card precisa de nome. */}
      <span className="flex items-center gap-1.5 text-xs text-tinta-suave">
        <span
          className="h-2.5 w-2.5 rounded-full border border-dashed border-pedra"
          aria-hidden="true"
        />
        Reserva
      </span>
    </div>
  );
}
