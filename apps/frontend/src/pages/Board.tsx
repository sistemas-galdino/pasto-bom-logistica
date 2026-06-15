// Página principal: KANBAN de pedidos.
//
// Quatro colunas do fluxo (pendente, agendada, em_rota, entregue) + aba de
// cancelados. Logística aplica transições; logística/almoxarifado fazem a
// separação (RF-2.2); vendedor vê tudo em modo leitura.

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
import { SeparacaoModal } from '../components/SeparacaoModal';
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

function mensagemDeErro(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function Board(): React.ReactElement {
  const { podeEscrever, podeSeparar } = useAuth();
  const queryClient = useQueryClient();
  const [verCancelados, setVerCancelados] = useState(false);
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [erroModal, setErroModal] = useState<string | null>(null);
  const [separandoId, setSeparandoId] = useState<string | null>(null);
  const [erroSeparacao, setErroSeparacao] = useState<string | null>(null);

  const pedidosQuery = useQuery({
    queryKey: ['pedidos'],
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
      setErroModal(mensagemDeErro(err, 'Falha ao aplicar a transição.'));
    },
  });

  const separacaoMutacao = useMutation({
    mutationFn: ({
      pedidoId,
      itemId,
      separado,
    }: {
      pedidoId: string;
      itemId: string;
      separado: boolean;
    }) => api.definirSeparacao(pedidoId, itemId, separado),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      setErroSeparacao(null);
    },
    onError: (err) => {
      setErroSeparacao(mensagemDeErro(err, 'Falha ao atualizar a separação.'));
    },
  });

  const pedidos = useMemo(() => pedidosQuery.data ?? [], [pedidosQuery.data]);

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

  const pedidoSeparacao = useMemo(
    () => pedidos.find((p) => p.id === separandoId) ?? null,
    [pedidos, separandoId],
  );

  function abrirTransicao(pedido: Pedido, para: StatusLogistico) {
    setErroModal(null);
    setAlvo({ pedido, para });
  }

  function abrirSeparacao(pedido: Pedido) {
    setErroSeparacao(null);
    setSeparandoId(pedido.id);
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

  const abaCls = (ativo: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
      ativo
        ? 'bg-mata text-creme-50 shadow-sm'
        : 'border border-linha bg-papel text-tinta-suave hover:border-mata/30 hover:text-mata'
    }`;

  return (
    <div className="flex h-screen flex-col">
      <Header />

      <div className="flex items-center justify-between gap-3 border-b border-linha bg-creme-50/70 px-4 py-2.5 backdrop-blur sm:px-6">
        <div className="flex items-baseline gap-2 text-sm">
          <h2 className="font-display text-base font-semibold text-mata-escuro">
            Quadro de pedidos
          </h2>
          <span className="text-pedra">·</span>
          <span className="text-tinta-suave">
            {verCancelados
              ? `${porStatus.cancelada.length} cancelados`
              : `${totalAtivos} no fluxo`}
          </span>
          {pedidosQuery.isFetching && (
            <span className="text-xs text-pedra">atualizando…</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setVerCancelados(false)}
            className={abaCls(!verCancelados)}
          >
            Fluxo
          </button>
          <button
            type="button"
            onClick={() => setVerCancelados(true)}
            className={abaCls(verCancelados)}
          >
            Cancelados ({porStatus.cancelada.length})
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-hidden">
        {pedidosQuery.isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-tinta-suave">
            Carregando pedidos…
          </div>
        ) : pedidosQuery.isError ? (
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
        ) : verCancelados ? (
          <div className="scroll-suave h-full overflow-y-auto p-4 sm:p-6">
            {porStatus.cancelada.length === 0 ? (
              <p className="text-center text-sm text-pedra">
                Nenhum pedido cancelado.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {porStatus.cancelada.map((p) => (
                  <PedidoCard
                    key={p.id}
                    pedido={p}
                    podeEscrever={false}
                    podeSeparar={false}
                    onTransicionar={abrirTransicao}
                    onSeparar={abrirSeparacao}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="scroll-suave flex h-full gap-3 overflow-x-auto p-4 sm:p-6">
            {COLUNAS_KANBAN.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                pedidos={porStatus[status]}
                podeEscrever={podeEscrever}
                podeSeparar={podeSeparar}
                onTransicionar={abrirTransicao}
                onSeparar={abrirSeparacao}
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

      {pedidoSeparacao && (
        <SeparacaoModal
          pedido={pedidoSeparacao}
          enviando={separacaoMutacao.isPending}
          erro={erroSeparacao}
          onToggle={(itemId, separado) =>
            separacaoMutacao.mutate({
              pedidoId: pedidoSeparacao.id,
              itemId,
              separado,
            })
          }
          onFechar={() => {
            if (!separacaoMutacao.isPending) {
              setSeparandoId(null);
              setErroSeparacao(null);
            }
          }}
        />
      )}
    </div>
  );
}
