// Coluna do kanban: cabeçalho com ponto de cor + contador, e a lista de cartões.

import React from 'react';
import type { Pedido, PrevisaoClima, StatusLogistico } from '@pastobom/shared';
import { PedidoCard } from './PedidoCard';
import { STATUS_META } from './status';

interface Props {
  status: StatusLogistico;
  pedidos: Pedido[];
  podeEscrever: boolean;
  podeSeparar: boolean;
  onTransicionar: (pedido: Pedido, para: StatusLogistico) => void;
  onSeparar: (pedido: Pedido) => void;
  /** Reverte o status uma etapa (voltar) — só logística. */
  onReverter?: (pedido: Pedido, para: StatusLogistico) => void;
  /** Marca a entrega como não realizada (cartões em rota) — só logística. */
  onNaoRealizado?: (pedido: Pedido) => void;
  /** Previsão por pedido (badge de clima no card). */
  climaPorPedido?: Record<string, PrevisaoClima | null>;
}

export function KanbanColumn({
  status,
  pedidos,
  podeEscrever,
  podeSeparar,
  onTransicionar,
  onSeparar,
  onReverter,
  onNaoRealizado,
  climaPorPedido,
}: Props): React.ReactElement {
  const meta = STATUS_META[status];

  return (
    <section className="flex min-w-[280px] max-w-[360px] flex-1 flex-col rounded-xl2 border border-linha/70 bg-creme-50/50">
      <header className="sticky top-0 z-10 rounded-t-xl2 bg-creme-50/95 px-4 pt-3.5 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${meta.faixa}`} />
            <h2 className="font-display text-[15px] font-semibold text-mata-escuro">
              {meta.rotulo}
            </h2>
          </div>
          <span className="rounded-full bg-papel px-2 py-0.5 text-xs font-semibold text-tinta-suave shadow-sm">
            {pedidos.length}
          </span>
        </div>
        <div
          className={`mt-2.5 h-[3px] w-full rounded-full ${meta.faixa} opacity-70`}
        />
      </header>

      <div className="scroll-suave flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {pedidos.length === 0 ? (
          <p className="px-1 py-10 text-center text-xs text-pedra">
            Nenhum pedido aqui.
          </p>
        ) : (
          pedidos.map((p) => (
            <PedidoCard
              key={p.id}
              pedido={p}
              podeEscrever={podeEscrever}
              podeSeparar={podeSeparar}
              onTransicionar={onTransicionar}
              onSeparar={onSeparar}
              onReverter={onReverter}
              onNaoRealizado={onNaoRealizado}
              clima={climaPorPedido?.[p.id]}
            />
          ))
        )}
      </div>
    </section>
  );
}
