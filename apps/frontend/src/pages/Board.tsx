// Página principal: KANBAN de pedidos.
//
// Quatro colunas do fluxo (pendente, agendada, em_rota, entregue) + alternância
// para ver os pedidos cancelados. Logística aplica transições via modal;
// vendedor vê tudo em modo leitura (sem botões de ação).

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Pedido, StatusLogistico } from '@pastobom/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { Header } from '../components/Header';
import { KanbanColumn } from '../components/KanbanColumn';
import { PedidoCard } from '../components/PedidoCard';
import {
  TransicaoModal,
  type TransicaoSubmit,
} from '../components/TransicaoModal';
import { COLUNAS_KANBAN } from '../components/status';

const TODOS_STATUS: StatusLogistico[] = [
  'pendente',
  'agendada',
  'em_rota',
  'entregue',
  'cancelada',
];

interface Alvo {
  pedido: Pedido;
  para: StatusLogistico;
}

export function Board(): React.ReactElement {
  const { podeEscrever } = useAuth();
  const queryClient = useQueryClient();
  const [verCancelados, setVerCancelados] = useState(false);
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [erroModal, setErroModal] = useState<string | null>(null);

  const pedidosQuery = useQuery({
    queryKey: ['pedidos'],
    // Sem filtro: o backend devolve não-finalizados; pedimos todos os status
    // para conseguirmos montar também as colunas "entregue" e "cancelada".
    queryFn: ({ signal }) => api.listarPedidos(TODOS_STATUS, signal),
    refetchInterval: 60_000,
  });

  const mutacao = useMutation({
    mutationFn: ({ id, body }: { id: string; body: TransicaoSubmit }) =>
      api.transicionar(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      setAlvo(null);
      setErroModal(null);
    },
    onError: (err) => {
      setErroModal(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Falha ao aplicar a transição.',
      );
    },
  });

  const pedidos = useMemo(
    () => pedidosQuery.data ?? [],
    [pedidosQuery.data],
  );

  const porStatus = useMemo(() => {
    const mapa: Record<StatusLogistico, Pedido[]> = {
      pendente: [],
      agendada: [],
      em_rota: [],
      entregue: [],
      cancelada: [],
    };
    for (const p of pedidos) {
      mapa[p.statusLogistico].push(p);
    }
    return mapa;
  }, [pedidos]);

  function abrirTransicao(pedido: Pedido, para: StatusLogistico) {
    setErroModal(null);
    setAlvo({ pedido, para });
  }

  function confirmar(args: TransicaoSubmit) {
    if (!alvo) return;
    mutacao.mutate({ id: alvo.pedido.id, body: args });
  }

  const totalAtivos =
    porStatus.pendente.length +
    porStatus.agendada.length +
    porStatus.em_rota.length +
    porStatus.entregue.length;

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <Header />

      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-2 text-sm">
          <h2 className="font-semibold text-slate-700">Quadro de pedidos</h2>
          <span className="text-slate-400">·</span>
          <span className="text-slate-500">
            {verCancelados
              ? `${porStatus.cancelada.length} cancelados`
              : `${totalAtivos} no fluxo`}
          </span>
          {pedidosQuery.isFetching && (
            <span className="text-xs text-slate-400">atualizando…</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setVerCancelados(false)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              !verCancelados
                ? 'bg-slate-800 text-white'
                : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Fluxo
          </button>
          <button
            type="button"
            onClick={() => setVerCancelados(true)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              verCancelados
                ? 'bg-slate-800 text-white'
                : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Cancelados ({porStatus.cancelada.length})
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-hidden">
        {pedidosQuery.isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Carregando pedidos…
          </div>
        ) : pedidosQuery.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-500">
            <p>
              {pedidosQuery.error instanceof Error
                ? pedidosQuery.error.message
                : 'Não foi possível carregar os pedidos.'}
            </p>
            <button
              type="button"
              onClick={() => void pedidosQuery.refetch()}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white"
            >
              Tentar novamente
            </button>
          </div>
        ) : verCancelados ? (
          <div className="h-full overflow-y-auto p-4 sm:p-6">
            {porStatus.cancelada.length === 0 ? (
              <p className="text-center text-sm text-slate-400">
                Nenhum pedido cancelado.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {porStatus.cancelada.map((p) => (
                  <PedidoCard
                    key={p.id}
                    pedido={p}
                    podeEscrever={false}
                    onTransicionar={abrirTransicao}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full gap-3 overflow-x-auto p-4 sm:p-6">
            {COLUNAS_KANBAN.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                pedidos={porStatus[status]}
                podeEscrever={podeEscrever}
                onTransicionar={abrirTransicao}
              />
            ))}
          </div>
        )}
      </main>

      {alvo && (
        <TransicaoModal
          pedido={alvo.pedido}
          para={alvo.para}
          enviando={mutacao.isPending}
          erro={erroModal}
          onCancelar={() => {
            if (!mutacao.isPending) {
              setAlvo(null);
              setErroModal(null);
            }
          }}
          onConfirmar={confirmar}
        />
      )}
    </div>
  );
}
