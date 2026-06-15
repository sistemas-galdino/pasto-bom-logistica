// Página de ROTAS: pedidos em rota agrupados por motorista (somente leitura).
//
// Reaproveita a query ['pedidos'] (mesma do quadro) e filtra client-side os
// pedidos em rota, agrupando por motorista. Cada grupo mostra o nº de pedidos
// e o valor total. Os cartões são exibidos sem ações (modo leitura).

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Pedido } from '@pastobom/shared';
import { api } from '../lib/api';
import { formatarMoeda } from '../lib/format';
import { PedidoCard } from '../components/PedidoCard';
import { TODOS_STATUS } from '../components/status';

interface GrupoRota {
  chave: string;
  pedidos: Pedido[];
  total: number;
}

export function Rotas(): React.ReactElement {
  const pedidosQuery = useQuery({
    queryKey: ['pedidos'],
    queryFn: ({ signal }) => api.listarPedidos(TODOS_STATUS, signal),
    refetchInterval: 60_000,
  });

  const grupos = useMemo<GrupoRota[]>(() => {
    const emRota = (pedidosQuery.data ?? []).filter(
      (p) => p.statusLogistico === 'em_rota',
    );
    const mapa = new Map<string, Pedido[]>();
    for (const p of emRota) {
      const chave = p.motoristaNome || 'Sem motorista';
      const lista = mapa.get(chave);
      if (lista) lista.push(p);
      else mapa.set(chave, [p]);
    }
    return Array.from(mapa, ([chave, pedidos]) => ({
      chave,
      pedidos,
      total: pedidos.reduce((s, p) => s + p.valorTotal, 0),
    })).sort((a, b) => {
      if (a.chave === 'Sem motorista') return 1;
      if (b.chave === 'Sem motorista') return -1;
      return a.chave.localeCompare(b.chave, 'pt-BR');
    });
  }, [pedidosQuery.data]);

  if (pedidosQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-tinta-suave">
        Carregando pedidos…
      </div>
    );
  }

  if (pedidosQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-tinta-suave">
        <p>
          {pedidosQuery.error instanceof Error
            ? pedidosQuery.error.message
            : 'Não foi possível carregar os pedidos.'}
        </p>
        <button
          type="button"
          onClick={() => void pedidosQuery.refetch()}
          className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave hover:border-mata/30 hover:text-mata"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scroll-suave">
      <div className="mx-auto max-w-7xl space-y-6 p-4 animate-sobe sm:p-6">
        {grupos.length === 0 ? (
          <p className="py-16 text-center text-sm text-tinta-suave">
            Nenhum pedido em rota no momento.
          </p>
        ) : (
          grupos.map((grupo) => (
            <section key={grupo.chave}>
              <div className="flex items-baseline justify-between gap-3 border-b border-linha pb-2">
                <h2 className="font-display text-lg font-semibold text-mata-escuro">
                  {grupo.chave}
                </h2>
                <span className="shrink-0 text-sm text-tinta-suave">
                  {grupo.pedidos.length === 1
                    ? '1 pedido'
                    : `${grupo.pedidos.length} pedidos`}{' '}
                  · {formatarMoeda(grupo.total)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {grupo.pedidos.map((p) => (
                  <PedidoCard
                    key={p.id}
                    pedido={p}
                    podeEscrever={false}
                    podeSeparar={false}
                    onTransicionar={() => {}}
                    onSeparar={() => {}}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
