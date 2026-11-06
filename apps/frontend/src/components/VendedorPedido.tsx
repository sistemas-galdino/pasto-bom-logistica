// Quem vendeu o pedido — pedido da Natália (06/11/2026). Uma linha só, com o
// mesmo desenho no card do pedido, no card da viagem e nas janelas de agendar e
// de detalhe, para a equipe saber a quem perguntar sobre aquela venda.

import React from 'react';
import { BadgeDollarSign } from 'lucide-react';
import { nomeProprio } from '../lib/format';

interface Props {
  nome: string | null | undefined;
  className?: string;
}

export function VendedorPedido({ nome, className = '' }: Props): React.ReactElement | null {
  const limpo = nome?.trim();
  if (!limpo) return null;
  return (
    <p className={`flex items-center gap-1 text-xs text-tinta-suave ${className}`}>
      <BadgeDollarSign className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true" />
      <span className="text-pedra">Vendedor:</span>
      <span className="truncate font-semibold text-tinta">{nomeProprio(limpo)}</span>
    </p>
  );
}
