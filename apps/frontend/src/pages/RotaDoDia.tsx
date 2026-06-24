// Página do MOTORISTA (Fase 3, RF-3.1/RF-3.2): a "rota do dia".
//
// Lista os pedidos em rota atribuídos ao motorista logado, com botão de
// navegação (Abrir no Maps) e a confirmação de entrega (com observação
// opcional). Mobile-first, no visual "Campo Claro". O backend é a fonte de
// verdade: a confirmação só vale para os próprios pedidos do motorista.

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Pedido } from '@pastobom/shared';
import { api, ApiError } from '../lib/api';
import { Header } from '../components/Header';
import { ClimaResumo } from '../components/ClimaResumo';
import { formatarMoeda, rotuloItens } from '../lib/format';
import { linkGoogleMaps } from '../lib/maps';

function mensagemDeErro(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

/** Linha de endereço a partir do destino resolvido (ou do cliente). */
function enderecoDoPedido(p: Pedido): string {
  const d = p.destino;
  const partes = [d?.endereco, d?.cidade, d?.uf].filter(Boolean);
  if (partes.length > 0) return partes.join(', ');
  if (p.propriedadeCodigo) {
    return [`Propriedade ${p.propriedadeCodigo}`, p.cidadeCliente]
      .filter(Boolean)
      .join(' · ');
  }
  return p.cidadeCliente || 'Endereço não informado';
}

function IconePin(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      className="mt-0.5 h-4 w-4 shrink-0 text-mata"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M8 1.5a4 4 0 0 0-4 4c0 2.8 4 8 4 8s4-5.2 4-8a4 4 0 0 0-4-4Zm0 5.6a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2Z"
      />
    </svg>
  );
}

function IconeMapa(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        d="M6 2.5 2 4v9.5l4-1.5 4 1.5 4-1.5V4l-4 1.5L6 2.5Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        d="M6 2.5v9.5M10 5.5V15"
      />
    </svg>
  );
}

export function RotaDoDia(): React.ReactElement {
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState<Pedido | null>(null);
  const [observacao, setObservacao] = useState('');
  const [erroModal, setErroModal] = useState<string | null>(null);

  const rotaQuery = useQuery({
    queryKey: ['minha-rota'],
    queryFn: ({ signal }) => api.listarMinhaRota(signal),
    refetchInterval: 60_000,
  });

  const entregaMutacao = useMutation({
    mutationFn: ({ id, obs }: { id: string; obs: string }) =>
      api.transicionar(id, { para: 'entregue', observacao: obs || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['minha-rota'] });
      setConfirmando(null);
      setObservacao('');
      setErroModal(null);
    },
    onError: (err) => {
      setErroModal(mensagemDeErro(err, 'Falha ao confirmar a entrega.'));
    },
  });

  const pedidos = rotaQuery.data ?? [];

  // Clima por parada da rota (entregas em rota têm data agendada).
  const idsClima = useMemo(
    () => pedidos.filter((p) => p.dataAgendada).map((p) => p.id),
    [pedidos],
  );
  const idsClimaKey = useMemo(
    () => idsClima.slice().sort().join(','),
    [idsClima],
  );
  const climaQuery = useQuery({
    queryKey: ['clima-rota', idsClimaKey],
    queryFn: ({ signal }) => api.climaLote(idsClima, signal),
    enabled: idsClima.length > 0,
    staleTime: 30 * 60 * 1000,
  });
  const climaPorPedido = climaQuery.data ?? {};

  function abrirConfirmacao(p: Pedido) {
    setObservacao('');
    setErroModal(null);
    setConfirmando(p);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <div className="flex items-center justify-between gap-3 border-b border-linha bg-creme-50/70 px-4 py-2.5 backdrop-blur sm:px-6">
        <div className="flex items-baseline gap-2 text-sm">
          <h2 className="font-display text-base font-semibold text-mata-escuro">
            Rota do dia
          </h2>
          <span className="text-pedra">·</span>
          <span className="text-tinta-suave">
            {pedidos.length === 1
              ? '1 entrega'
              : `${pedidos.length} entregas`}
          </span>
          {rotaQuery.isFetching && (
            <span className="text-xs text-pedra">atualizando…</span>
          )}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto scroll-suave">
        <div className="mx-auto max-w-xl px-4 py-5 sm:px-6">
          {rotaQuery.isLoading ? (
            <p className="py-16 text-center text-sm text-tinta-suave">
              Carregando suas entregas…
            </p>
          ) : rotaQuery.isError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-sm text-tinta-suave">
              <p>
                {rotaQuery.error instanceof Error
                  ? rotaQuery.error.message
                  : 'Não foi possível carregar a rota.'}
              </p>
              <button
                type="button"
                onClick={() => void rotaQuery.refetch()}
                className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave hover:border-mata/30 hover:text-mata"
              >
                Tentar novamente
              </button>
            </div>
          ) : pedidos.length === 0 ? (
            <div className="py-20 text-center">
              <p className="font-display text-lg text-mata-escuro">
                Nenhuma entrega para hoje.
              </p>
              <p className="mt-1 text-sm text-tinta-suave">
                Quando a logística despachar um pedido para você, ele aparece aqui.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {pedidos.map((p) => (
                <li
                  key={p.id}
                  className="animate-sobe rounded-xl border border-linha bg-papel p-4 shadow-carta"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-base font-semibold leading-tight text-tinta">
                      {p.clienteNome || p.clienteCodigo || 'Cliente'}
                    </h3>
                    <span className="shrink-0 rounded-md bg-creme-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-tinta-suave">
                      nº {p.orixNumero || '—'}
                    </span>
                  </div>

                  <p className="mt-2 flex items-start gap-1.5 text-sm text-tinta-suave">
                    <IconePin />
                    <span>{enderecoDoPedido(p)}</span>
                  </p>

                  {climaPorPedido[p.id]?.disponivel && (
                    <div className="mt-1.5 pl-5">
                      <ClimaResumo variant="badge" previsao={climaPorPedido[p.id]} />
                    </div>
                  )}

                  <div className="mt-2 flex items-center justify-between text-xs text-tinta-suave">
                    <span>{rotuloItens(p.itens.length)}</span>
                    <span className="font-display text-sm font-semibold text-mata-escuro">
                      {formatarMoeda(p.valorTotal)}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 border-t border-linha/70 pt-3 sm:flex-row">
                    <a
                      href={linkGoogleMaps(p)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-mata/30 bg-creme-50 px-3 py-2.5 text-sm font-semibold text-mata transition hover:bg-folha-claro sm:flex-1"
                    >
                      <IconeMapa />
                      Abrir no Maps
                    </a>
                    <button
                      type="button"
                      onClick={() => abrirConfirmacao(p)}
                      className="rounded-lg bg-mata px-3 py-2.5 text-sm font-bold text-creme-50 transition hover:bg-mata-escuro sm:flex-1"
                    >
                      Confirmar entrega
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {confirmando && (
        <ConfirmarEntregaModal
          pedido={confirmando}
          observacao={observacao}
          enviando={entregaMutacao.isPending}
          erro={erroModal}
          onObservacao={setObservacao}
          onConfirmar={() =>
            entregaMutacao.mutate({ id: confirmando.id, obs: observacao })
          }
          onCancelar={() => {
            if (!entregaMutacao.isPending) {
              setConfirmando(null);
              setObservacao('');
              setErroModal(null);
            }
          }}
        />
      )}
    </div>
  );
}

interface ModalProps {
  pedido: Pedido;
  observacao: string;
  enviando: boolean;
  erro: string | null;
  onObservacao: (v: string) => void;
  onConfirmar: () => void;
  onCancelar: () => void;
}

function ConfirmarEntregaModal({
  pedido,
  observacao,
  enviando,
  erro,
  onObservacao,
  onConfirmar,
  onCancelar,
}: ModalProps): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar entrega"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCancelar();
      }}
    >
      <div className="w-full max-w-md animate-sobe rounded-xl2 bg-papel p-5 shadow-flutua">
        <h2 className="font-display text-lg font-semibold text-mata-escuro">
          Confirmar entrega
        </h2>
        <p className="mt-0.5 text-sm text-tinta-suave">
          Pedido nº {pedido.orixNumero || '—'} —{' '}
          {pedido.clienteNome || pedido.clienteCodigo}
        </p>

        <p className="mt-4 rounded-lg bg-mata-claro px-3 py-2.5 text-sm text-mata-escuro">
          Ao confirmar, o pedido é marcado como <strong>entregue</strong> e o
          cliente recebe um WhatsApp de confirmação.
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave">
            Observação (opcional)
          </span>
          <textarea
            value={observacao}
            onChange={(e) => onObservacao(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Ex.: recebido por João; deixado no galpão…"
            className="w-full resize-none rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition focus:border-folha focus:bg-papel focus:ring-2 focus:ring-folha/25"
          />
        </label>

        {erro && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-sm text-terra-escuro"
          >
            {erro}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={enviando}
            className="rounded-lg border border-linha px-4 py-2 text-sm font-semibold text-tinta-suave transition hover:bg-creme-50 disabled:opacity-60"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={enviando}
            className="rounded-lg bg-mata px-4 py-2 text-sm font-bold text-creme-50 transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando ? 'Confirmando…' : 'Confirmar entrega'}
          </button>
        </div>
      </div>
    </div>
  );
}
