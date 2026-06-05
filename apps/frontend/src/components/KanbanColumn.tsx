// Coluna do kanban: cabeçalho com faixa de cor + contador, e a lista de cartões.

import React from 'react';
import type { Pedido, StatusLogistico } from '@pastobom/shared';
import { PedidoCard } from './PedidoCard';
import { STATUS_META } from './status';

interface Props {
  status: StatusLogistico;
  pedidos: Pedido[];
  podeEscrever: boolean;
  onTransicionar: (pedido: Pedido, para: StatusLogistico) => void;
}

export function KanbanColumn({
  status,
  pedidos,
  podeEscrever,
  onTransicionar,
}: Props): React.ReactElement {
  const meta = STATUS_META[status];

  return (
    <section className="flex min-w-[260px] flex-1 flex-col rounded-2xl bg-slate-100/70">
      <header className="sticky top-0 z-10 rounded-t-2xl bg-slate-100/95 px-3 pt-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${meta.faixa}`} />
            <h2 className="text-sm font-semibold text-slate-700">
              {meta.rotulo}
            </h2>
          </div>
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500">
            {pedidos.length}
          </span>
        </div>
        <div className={`mt-2 h-0.5 w-full rounded-full ${meta.faixa}`} />
      </header>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3">
        {pedidos.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-slate-400">
            Nenhum pedido.
          </p>
        ) : (
          pedidos.map((p) => (
            <PedidoCard
              key={p.id}
              pedido={p}
              podeEscrever={podeEscrever}
              onTransicionar={onTransicionar}
            />
          ))
        )}
      </div>
    </section>
  );
}
