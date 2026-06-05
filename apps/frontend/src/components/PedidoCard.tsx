// Cartão de pedido no kanban: cliente, cidade, valor, nº de itens e propriedade.
// Quando o usuário pode escrever (logística), exibe a ação de transição.

import React from 'react';
import type { Pedido, StatusLogistico } from '@pastobom/shared';
import { TRANSICOES } from '@pastobom/shared';
import { formatarMoeda, formatarData, rotuloItens } from '../lib/format';
import { STATUS_META } from './status';

interface Props {
  pedido: Pedido;
  podeEscrever: boolean;
  onTransicionar: (pedido: Pedido, para: StatusLogistico) => void;
}

export function PedidoCard({
  pedido,
  podeEscrever,
  onTransicionar,
}: Props): React.ReactElement {
  // A ação primária é o avanço natural do fluxo (1ª transição não-cancelada).
  const transicoes = TRANSICOES[pedido.statusLogistico];
  const avanco = transicoes.find((t) => t !== 'cancelada') ?? null;
  const podeCancelar = transicoes.includes('cancelada');

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300 hover:shadow">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-tight text-slate-800">
          {pedido.clienteNome || pedido.clienteCodigo || 'Cliente'}
        </h3>
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
          nº {pedido.orixNumero || '—'}
        </span>
      </div>

      <p className="mt-0.5 text-xs text-slate-500">
        {pedido.cidadeCliente || '—'}
      </p>

      <div className="mt-2 flex items-end justify-between">
        <span className="text-base font-semibold text-slate-800">
          {formatarMoeda(pedido.valorTotal)}
        </span>
        <span className="text-xs text-slate-500">
          {rotuloItens(pedido.itens.length)}
        </span>
      </div>

      <dl className="mt-2 space-y-0.5 text-xs text-slate-500">
        <div className="flex justify-between gap-2">
          <dt>Propriedade</dt>
          <dd className="truncate text-right text-slate-600">
            {pedido.propriedadeCodigo ?? '—'}
          </dd>
        </div>
        {pedido.dataAgendada && (
          <div className="flex justify-between gap-2">
            <dt>Agendada</dt>
            <dd className="text-right text-slate-600">
              {formatarData(pedido.dataAgendada)}
            </dd>
          </div>
        )}
        {pedido.statusLogistico === 'entregue' && pedido.dataEntregue && (
          <div className="flex justify-between gap-2">
            <dt>Entregue</dt>
            <dd className="text-right text-slate-600">
              {formatarData(pedido.dataEntregue)}
            </dd>
          </div>
        )}
      </dl>

      {podeEscrever && (avanco || podeCancelar) && (
        <div className="mt-3 flex gap-2 border-t border-slate-100 pt-2.5">
          {avanco && (
            <button
              type="button"
              onClick={() => onTransicionar(pedido, avanco)}
              className="flex-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
            >
              {STATUS_META[pedido.statusLogistico].acao}
            </button>
          )}
          {podeCancelar && (
            <button
              type="button"
              onClick={() => onTransicionar(pedido, 'cancelada')}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              Cancelar
            </button>
          )}
        </div>
      )}
    </article>
  );
}
