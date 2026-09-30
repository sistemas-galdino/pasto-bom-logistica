// A tag com o número do pedido ("nº 0000000143"), que aparece em todo card de
// pedido e de viagem.
//
// Estava copiada literalmente em cinco arquivos — e uma das cópias já tinha
// divergido (a da Separação perdeu o shrink-0). Virou componente quando ganhou
// uma segunda cor: pintar uma cópia de amarelo e deixar as outras cinzas seria
// garantir que o mesmo pedido aparecesse de duas cores em duas telas.
//
// AMARELA quando o pedido já teve uma entrega parcial de verdade — o cliente
// recebeu menos do que foi carregado (Entrega.pedidoParcial). Pedido da Natália,
// 24/09/2026: "esses pedidos que por algum motivo ficarem parciais, você
// consegue colocar ele de cor amarela?". A divisão planejada no agendamento não
// acende: dividir é rotina, e a cor perderia o sentido.

import React from 'react';

interface Props {
  numero: string;
  /** O pedido teve entrega parcial de verdade. */
  parcial?: boolean;
  className?: string;
}

export function TagPedido({
  numero,
  parcial = false,
  className = '',
}: Props): React.ReactElement {
  const cor = parcial
    ? 'bg-trigo-claro text-trigo-escuro ring-1 ring-trigo/50'
    : 'bg-creme-100 text-tinta-suave';
  return (
    <span
      title={
        parcial
          ? 'Entrega parcial: o cliente já recebeu menos do que foi carregado numa viagem deste pedido.'
          : undefined
      }
      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${cor} ${className}`}
    >
      nº {numero || '—'}
      {parcial && <span className="sr-only"> — entrega parcial</span>}
    </span>
  );
}
