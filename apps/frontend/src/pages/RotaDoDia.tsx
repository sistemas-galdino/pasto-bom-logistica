// Página do MOTORISTA (Fase 3, RF-3.1/RF-3.2): a "rota do dia".
//
// Lista os pedidos em rota atribuídos ao motorista logado, com botão de
// navegação (Abrir no Maps) e a confirmação de entrega (com observação
// opcional). Mobile-first, no visual "Campo Claro". O backend é a fonte de
// verdade: a confirmação só vale para os próprios pedidos do motorista.

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Entrega, PeriodoEntrega, Reserva } from '@pastobom/shared';
import { api, ApiError } from '../lib/api';
import { Header } from '../components/Header';
import { ClimaResumo } from '../components/ClimaResumo';
import { formatarData, formatarMoeda, rotuloItens } from '../lib/format';
import { linkGoogleMaps } from '../lib/maps';

const ROTULO_PERIODO: Record<PeriodoEntrega, string> = {
  manha: 'manhã',
  tarde: 'tarde',
};

/**
 * Data de hoje em ISO local (yyyy-mm-dd). Não dá para usar toISOString(): ela
 * converte para UTC e, à noite no fuso do Brasil, já devolve o dia seguinte —
 * o motorista veria "amanhã" numa reserva que é dele hoje.
 */
function hojeISO(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Para onde o caminhão vai: fornecedor do Órix ou cidade digitada. */
function destinoDaReserva(r: Reserva): string {
  const partes = [r.fornecedorNome, r.cidade].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : 'Destino não informado';
}

function mensagemDeErro(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

/** Linha de endereço a partir do destino resolvido (ou do cliente). */
function enderecoDaEntrega(p: Entrega): string {
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
  const [confirmando, setConfirmando] = useState<Entrega | null>(null);
  const [observacao, setObservacao] = useState('');
  const [erroModal, setErroModal] = useState<string | null>(null);

  // A rota do motorista lista VIAGENS (Onda 2): se o mesmo pedido sair em dois
  // caminhões, cada motorista vê só a sua carga, com a quantidade dele.
  const rotaQuery = useQuery({
    queryKey: ['minhas-entregas'],
    queryFn: ({ signal }) => api.listarMinhasEntregas(signal),
    refetchInterval: 60_000,
  });

  // Reservas de caminhão (oficina, buscar adubo na fábrica) numa query SEPARADA
  // das entregas: o endpoint devolve Reserva[], que não tem cliente, itens nem
  // pedidoId — juntar as duas listas num array só quebraria o clima e o Maps.
  // A falha aqui é silenciosa de propósito (ver bloco de reservas no JSX): a
  // rota de entregas é a função principal da tela e não pode cair com ela.
  const reservasQuery = useQuery({
    queryKey: ['minhas-reservas'],
    queryFn: ({ signal }) => api.minhasReservas(signal),
    refetchInterval: 60_000,
  });

  const entregaMutacao = useMutation({
    mutationFn: ({ id, obs }: { id: string; obs: string }) =>
      api.transicionarEntrega(id, {
        para: 'entregue',
        observacao: obs || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['minhas-entregas'] });
      setConfirmando(null);
      setObservacao('');
      setErroModal(null);
    },
    onError: (err) => {
      setErroModal(mensagemDeErro(err, 'Falha ao confirmar a entrega.'));
    },
  });

  const entregas = rotaQuery.data ?? [];

  // Clima por parada da rota (entregas em rota têm data agendada).
  const idsClima = useMemo(
    () => entregas.map((e) => e.pedidoId),
    [entregas],
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

  function abrirConfirmacao(p: Entrega) {
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
            {entregas.length === 1
              ? '1 entrega'
              : `${entregas.length} entregas`}
          </span>
          {rotaQuery.isFetching && (
            <span className="text-xs text-pedra">atualizando…</span>
          )}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto scroll-suave">
        <div className="mx-auto max-w-xl px-4 py-5 sm:px-6">
          {/*
            Bloco das reservas ANTES da lista de entregas e FORA do encadeamento
            de estados dela: se a consulta de entregas falhar ou estiver
            carregando, o motorista ainda vê que o caminhão dele está reservado.
            Sem reserva (ou com erro na consulta) o bloco simplesmente não
            existe — nada de "nenhuma reserva" gastando tela de celular.
          */}
          <ReservasDoCaminhao reservas={reservasQuery.data ?? []} />

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
          ) : entregas.length === 0 ? (
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
              {entregas.map((p) => (
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
                    <span>{enderecoDaEntrega(p)}</span>
                  </p>

                  {climaPorPedido[p.pedidoId]?.disponivel && (
                    <div className="mt-1.5 pl-5">
                      <ClimaResumo variant="badge" previsao={climaPorPedido[p.pedidoId]} />
                    </div>
                  )}

                  <div className="mt-2 flex items-center justify-between text-xs text-tinta-suave">
                    <span>{rotuloItens(p.itens.length)}</span>
                    {p.pesoTotalKg !== null && (
                      <span className="font-display text-sm font-semibold text-mata-escuro">
                        {(p.pesoTotalKg / 1000).toLocaleString('pt-BR', {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}{' '}
                        t
                      </span>
                    )}
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

/**
 * Reservas do caminhão do motorista, SOMENTE LEITURA (decisão do David): ele
 * precisa saber que o caminhão vai para a oficina amanhã e nada além disso —
 * sem confirmar, editar ou cancelar. O visual é deliberadamente diferente do
 * card de entrega (tracejado, fundo creme, sem cor de status) para que ninguém
 * confunda "vou à oficina" com "tenho uma entrega".
 */
function ReservasDoCaminhao({
  reservas,
}: {
  reservas: Reserva[];
}): React.ReactElement | null {
  const hoje = hojeISO();
  if (reservas.length === 0) return null;

  return (
    <section className="mb-5" aria-label="Reservas do caminhão">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tinta-suave">
        Caminhão reservado
      </h3>
      <ul className="space-y-3">
        {reservas.map((r) => {
          const eHoje = r.dataAgendada === hoje;
          return (
            <li
              key={r.id}
              className="animate-sobe rounded-xl border-2 border-dashed border-pedra/70 bg-creme-100 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-display text-lg font-semibold leading-tight text-tinta">
                  {r.servico}
                </h4>
                {eHoje && (
                  <span className="shrink-0 rounded-md bg-tinta px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-creme-50">
                    Hoje
                  </span>
                )}
              </div>

              <p className="mt-1.5 text-base font-semibold text-tinta-suave">
                {eHoje ? 'Hoje' : formatarData(r.dataAgendada)} ·{' '}
                {ROTULO_PERIODO[r.periodo]}
              </p>

              <p className="mt-2 flex items-start gap-1.5 text-base text-tinta-suave">
                <IconePin />
                <span>{destinoDaReserva(r)}</span>
              </p>

              {r.produtos && (
                <p className="mt-2 text-sm text-tinta-suave">
                  Produtos: {r.produtos}
                </p>
              )}

              <p className="mt-3 border-t border-pedra/30 pt-2 text-sm text-tinta-suave">
                Caminhão:{' '}
                <span className="font-semibold text-tinta">
                  {r.caminhaoNome || '—'}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface ModalProps {
  pedido: Entrega;
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
