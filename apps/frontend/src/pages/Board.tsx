// Página principal: KANBAN de pedidos.
//
// Cinco colunas do fluxo (pendente, agendada, em_rota, entregue, nao_realizado)
// + aba de cancelados. Logística aplica transições; logística/almoxarifado fazem
// a separação (RF-2.2); vendedor vê tudo em modo leitura.
//
// O quadro é a lista de trabalho do dia: filtra por PERÍODO DE ENTRADA e por
// status do Órix no servidor, e busca (cliente, nº, cidade, bairro, produto)
// dentro do que já veio — por isso a busca só enxerga o período filtrado.

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Pedido, StatusLogistico } from '@pastobom/shared';
import { api, ApiError, type FiltrosPedidos } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { KanbanColumn } from '../components/KanbanColumn';
import { PedidoCard } from '../components/PedidoCard';
import {
  TransicaoModal,
  type TransicaoSubmit,
} from '../components/TransicaoModal';
import { SeparacaoModal } from '../components/SeparacaoModal';
import { ReverterModal } from '../components/ReverterModal';
import { NaoRealizadoModal } from '../components/NaoRealizadoModal';
import { COLUNAS_KANBAN, TODOS_STATUS } from '../components/status';

/** Os três status do Órix que chegam ao quadro (filtro server-side). */
const STATUS_ORIX_OPCOES: {
  codigo: string;
  rotulo: string;
  descricao: string;
}[] = [
  {
    codigo: '00041',
    rotulo: 'Aguardando entrega',
    descricao: 'Venda aguardando entrega para faturamento',
  },
  {
    codigo: '00045',
    rotulo: 'Entrega futura',
    descricao: 'Venda entrega futura (sem reserva estoque)',
  },
  {
    codigo: '00027',
    rotulo: 'Faturamento parcial',
    descricao: 'Venda aguardando faturamento (parcial)',
  },
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

/** Minúsculas e sem acento — a busca do quadro é digitada com pressa. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function Board(): React.ReactElement {
  const { podeEscrever, podeSeparar } = useAuth();
  const queryClient = useQueryClient();
  const [verCancelados, setVerCancelados] = useState(false);
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [erroModal, setErroModal] = useState<string | null>(null);
  const [separandoId, setSeparandoId] = useState<string | null>(null);
  const [erroSeparacao, setErroSeparacao] = useState<string | null>(null);
  const [alvoReverter, setAlvoReverter] = useState<Alvo | null>(null);
  const [erroReverter, setErroReverter] = useState<string | null>(null);
  const [alvoNaoRealizado, setAlvoNaoRealizado] = useState<Pedido | null>(null);
  const [erroNaoRealizado, setErroNaoRealizado] = useState<string | null>(null);

  // Filtros server-side (período de ENTRADA + status do Órix) e busca local.
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [statusOrix, setStatusOrix] = useState<string[]>([]);
  const [busca, setBusca] = useState('');

  const filtros = useMemo<FiltrosPedidos>(() => {
    const f: FiltrosPedidos = {};
    if (de) f.de = de;
    if (ate) f.ate = ate;
    if (statusOrix.length > 0) f.statusOrix = statusOrix;
    return f;
  }, [de, ate, statusOrix]);

  // A key carrega os filtros (sem isso o react-query devolveria a lista velha).
  // As invalidações continuam usando o PREFIXO ['pedidos'], que cobre esta key
  // e as das outras telas (Dashboard, Rotas, Motoristas).
  const pedidosQuery = useQuery({
    queryKey: ['pedidos', filtros],
    queryFn: ({ signal }) => api.listarPedidos(TODOS_STATUS, signal, filtros),
    refetchInterval: 60_000,
  });

  const invalidarPedidos = () =>
    queryClient.invalidateQueries({ queryKey: ['pedidos'] });

  const mutacao = useMutation({
    mutationFn: ({ id, body }: { id: string; body: TransicaoSubmit }) =>
      api.transicionar(id, body),
    onSuccess: () => {
      void invalidarPedidos();
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
      void invalidarPedidos();
      setErroSeparacao(null);
    },
    onError: (err) => {
      setErroSeparacao(mensagemDeErro(err, 'Falha ao atualizar a separação.'));
    },
  });

  const reverterMutacao = useMutation({
    mutationFn: ({ id, para }: { id: string; para: StatusLogistico }) =>
      api.reverter(id, para),
    onSuccess: () => {
      void invalidarPedidos();
      setAlvoReverter(null);
      setErroReverter(null);
    },
    onError: (err) => {
      setErroReverter(mensagemDeErro(err, 'Falha ao voltar o pedido.'));
    },
  });

  // em_rota -> nao_realizado. O motivo é obrigatório: se vier vazio o backend
  // devolve 422 `motivo_obrigatorio` e a mensagem aparece dentro do modal.
  const naoRealizadoMutacao = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      api.transicionar(id, { para: 'nao_realizado', motivo }),
    onSuccess: () => {
      void invalidarPedidos();
      setAlvoNaoRealizado(null);
      setErroNaoRealizado(null);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        setErroNaoRealizado(
          mensagemDeErro(err, 'Informe por que a entrega não foi realizada.'),
        );
        return;
      }
      setErroNaoRealizado(
        mensagemDeErro(err, 'Falha ao marcar a entrega como não realizada.'),
      );
    },
  });

  const pedidos = useMemo(() => pedidosQuery.data ?? [], [pedidosQuery.data]);

  // Busca client-side sobre o que já está carregado: cliente, nº do pedido,
  // cidade, bairro e produto (código ou nome de qualquer item).
  const pedidosVisiveis = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (termo === '') return pedidos;
    return pedidos.filter((p) => {
      const campos = [
        p.clienteNome,
        p.orixNumero,
        p.cidadeCliente,
        p.bairro ?? '',
      ];
      if (campos.some((campo) => normalizar(campo ?? '').includes(termo))) {
        return true;
      }
      return p.itens.some(
        (item) =>
          normalizar(item.produtoCodigo).includes(termo) ||
          normalizar(item.nomeProduto).includes(termo),
      );
    });
  }, [pedidos, busca]);

  // Clima das entregas futuras (agendada/em_rota com data) — busca em lote.
  const idsClima = useMemo(
    () =>
      pedidosVisiveis
        .filter(
          (p) =>
            p.dataAgendada &&
            (p.statusLogistico === 'agendada' ||
              p.statusLogistico === 'em_rota'),
        )
        .map((p) => p.id),
    [pedidosVisiveis],
  );
  const idsClimaKey = useMemo(
    () => idsClima.slice().sort().join(','),
    [idsClima],
  );
  const climaQuery = useQuery({
    queryKey: ['clima-lote', idsClimaKey],
    queryFn: ({ signal }) => api.climaLote(idsClima, signal),
    enabled: idsClima.length > 0,
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });
  const climaPorPedido = climaQuery.data ?? {};

  const porStatus = useMemo(() => {
    const mapa: Record<StatusLogistico, Pedido[]> = {
      pendente: [],
      agendada: [],
      em_rota: [],
      entregue: [],
      nao_realizado: [],
      cancelada: [],
    };
    for (const p of pedidosVisiveis) {
      mapa[p.statusLogistico].push(p);
    }
    return mapa;
  }, [pedidosVisiveis]);

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

  function abrirReverter(pedido: Pedido, para: StatusLogistico) {
    setErroReverter(null);
    setAlvoReverter({ pedido, para });
  }

  function abrirNaoRealizado(pedido: Pedido) {
    setErroNaoRealizado(null);
    setAlvoNaoRealizado(pedido);
  }

  function confirmar(args: TransicaoSubmit) {
    if (!alvo) return;
    mutacao.mutate({ id: alvo.pedido.id, body: args });
  }

  /** Liga/desliga um status do Órix mantendo a ordem canônica das opções
   *  (a queryKey não muda por causa da ordem dos cliques). */
  function alternarStatusOrix(codigo: string) {
    setStatusOrix((atual) =>
      STATUS_ORIX_OPCOES.map((o) => o.codigo).filter((c) =>
        c === codigo ? !atual.includes(c) : atual.includes(c),
      ),
    );
  }

  function limparFiltros() {
    setDe('');
    setAte('');
    setStatusOrix([]);
    setBusca('');
  }

  const temFiltros =
    de !== '' || ate !== '' || statusOrix.length > 0 || busca.trim() !== '';

  const totalAtivos =
    porStatus.pendente.length +
    porStatus.agendada.length +
    porStatus.em_rota.length +
    porStatus.entregue.length +
    porStatus.nao_realizado.length;

  const abaCls = (ativo: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
      ativo
        ? 'bg-mata text-creme-50 shadow-sm'
        : 'border border-linha bg-papel text-tinta-suave hover:border-mata/30 hover:text-mata'
    }`;

  const campoCls =
    'rounded-lg border border-linha bg-papel px-2 py-1 text-xs text-tinta outline-none transition focus:border-mata/40';

  return (
    <div className="flex h-full flex-col">
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

      {/* Barra de filtros: período de entrada + status do Órix (servidor) e a
          busca (local, sobre o que já veio). */}
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3 border-b border-linha bg-papel/70 px-4 py-3 sm:px-6">
        <div className="flex min-w-[240px] flex-1 flex-col">
          <label htmlFor="busca-pedidos" className="sr-only">
            Buscar pedidos
          </label>
          <input
            id="busca-pedidos"
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por cliente, nº do pedido, cidade, bairro ou produto…"
            className="w-full rounded-lg border border-linha bg-creme-50 px-3 py-1.5 text-sm text-tinta outline-none transition placeholder:text-pedra focus:border-mata/40 focus:bg-papel"
          />
          <span className="mt-1 text-[10px] text-pedra">
            A busca acontece dentro do período filtrado.
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-pedra">
            Entrada do pedido
          </span>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-tinta-suave">
            <label htmlFor="filtro-de" className="sr-only">
              Data de entrada — de
            </label>
            <input
              id="filtro-de"
              type="date"
              value={de}
              max={ate || undefined}
              onChange={(e) => setDe(e.target.value)}
              className={campoCls}
            />
            <span className="text-pedra">até</span>
            <label htmlFor="filtro-ate" className="sr-only">
              Data de entrada — até
            </label>
            <input
              id="filtro-ate"
              type="date"
              value={ate}
              min={de || undefined}
              onChange={(e) => setAte(e.target.value)}
              className={campoCls}
            />
          </div>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-pedra">
            Status no Órix
          </span>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {STATUS_ORIX_OPCOES.map((opcao) => {
              const ativo = statusOrix.includes(opcao.codigo);
              return (
                <button
                  key={opcao.codigo}
                  type="button"
                  onClick={() => alternarStatusOrix(opcao.codigo)}
                  aria-pressed={ativo}
                  title={`${opcao.codigo} — ${opcao.descricao}`}
                  className={`rounded-lg border px-2 py-1 text-xs font-semibold transition ${
                    ativo
                      ? 'border-mata/40 bg-folha-claro text-mata'
                      : 'border-linha bg-papel text-tinta-suave hover:border-mata/30 hover:text-mata'
                  }`}
                >
                  {opcao.rotulo}
                </button>
              );
            })}
          </div>
        </div>

        {temFiltros && (
          <button
            type="button"
            onClick={limparFiltros}
            className="self-center rounded-lg px-2.5 py-1.5 text-xs font-semibold text-tinta-suave transition hover:bg-creme-100 hover:text-tinta"
          >
            Limpar filtros
          </button>
        )}
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
                {temFiltros
                  ? 'Nenhum pedido cancelado com esses filtros.'
                  : 'Nenhum pedido cancelado.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {porStatus.cancelada.map((p) => (
                  <PedidoCard
                    key={p.id}
                    pedido={p}
                    podeEscrever={podeEscrever}
                    podeSeparar={false}
                    onTransicionar={abrirTransicao}
                    onSeparar={abrirSeparacao}
                    onReverter={abrirReverter}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          // Cinco colunas não cabem lado a lado em tela pequena: a faixa rola na
          // horizontal e cada coluna guarda sua largura mínima (KanbanColumn).
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
                onReverter={abrirReverter}
                onNaoRealizado={abrirNaoRealizado}
                climaPorPedido={climaPorPedido}
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

      {alvoReverter && (
        <ReverterModal
          pedido={alvoReverter.pedido}
          para={alvoReverter.para}
          enviando={reverterMutacao.isPending}
          erro={erroReverter}
          onConfirmar={() =>
            reverterMutacao.mutate({
              id: alvoReverter.pedido.id,
              para: alvoReverter.para,
            })
          }
          onCancelar={() => {
            if (!reverterMutacao.isPending) {
              setAlvoReverter(null);
              setErroReverter(null);
            }
          }}
        />
      )}

      {alvoNaoRealizado && (
        <NaoRealizadoModal
          pedido={alvoNaoRealizado}
          enviando={naoRealizadoMutacao.isPending}
          erro={erroNaoRealizado}
          onConfirmar={(motivo) =>
            naoRealizadoMutacao.mutate({ id: alvoNaoRealizado.id, motivo })
          }
          onCancelar={() => {
            if (!naoRealizadoMutacao.isPending) {
              setAlvoNaoRealizado(null);
              setErroNaoRealizado(null);
            }
          }}
        />
      )}
    </div>
  );
}
