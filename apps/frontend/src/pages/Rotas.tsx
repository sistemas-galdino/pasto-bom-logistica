// Página de ROTAS: pedidos em rota agrupados por motorista (somente leitura).
//
// Reaproveita a query ['pedidos'] (mesma do quadro) e filtra client-side os
// pedidos em rota, agrupando por motorista. Cada grupo mostra o nº de pedidos
// e o valor total. Os cartões são exibidos sem ações (modo leitura).
//
// No topo há um filtro por motorista (pílulas) derivado da própria lista — os
// motoristas que aparecem são só os que TÊM pedido em rota agora, então não há
// chamada extra de API.

// A ORDEM DAS PARADAS (item 11 da Natália) aparece aqui SOMENTE LEITURA: quem
// informa é o motorista, na Rota do dia, porque é ele que acabou de descarregar
// e conhece a estrada. Esta tela é o outro lado do pedido — a logística ver, ao
// ligar para o cliente, em que posição da rota ele está.

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ordenarParadas } from '@pastobom/shared';
import type { Entrega } from '@pastobom/shared';
import { api } from '../lib/api';
import { EntregaCard } from '../components/EntregaCard';
import { TODOS_STATUS } from '../components/status';

interface GrupoRota {
  chave: string;
  pedidos: Entrega[];
  total: number;
}

export function Rotas(): React.ReactElement {
  // null = "Todos os motoristas". Guarda a CHAVE do grupo (nome do motorista
  // ou 'Sem motorista'), a mesma usada no agrupamento.
  const [motoristaSelecionado, setMotoristaSelecionado] = useState<
    string | null
  >(null);

  // Rotas lista VIAGENS em rota: o mesmo pedido em dois caminhões aparece nas
  // duas rotas, cada uma com a sua parte da carga.
  const pedidosQuery = useQuery({
    queryKey: ['entregas', 'em-rota'],
    queryFn: ({ signal }) =>
      api.listarEntregas({ status: ['em_rota'] }, signal),
    refetchInterval: 60_000,
  });

  const grupos = useMemo<GrupoRota[]>(() => {
    const emRota = pedidosQuery.data ?? [];
    const mapa = new Map<string, Entrega[]>();
    for (const p of emRota) {
      const chave = p.motoristaNome || 'Sem motorista';
      const lista = mapa.get(chave);
      if (lista) lista.push(p);
      else mapa.set(chave, [p]);
    }
    return Array.from(mapa, ([chave, pedidos]) => ({
      chave,
      // Mesma função da tela do motorista: a logística lê a rota na sequência
      // que ELE informou, não em ordem de banco — senão as duas telas
      // divergiriam e a pergunta "onde ele está?" teria duas respostas.
      pedidos: ordenarParadas(pedidos),
      // Peso, não dinheiro: a viagem carrega parte do pedido, e o que importa
      // para quem olha a rota é quanto o caminhão está levando.
      total: pedidos.reduce((s, p) => s + (p.pesoTotalKg ?? 0), 0),
    })).sort((a, b) => {
      if (a.chave === 'Sem motorista') return 1;
      if (b.chave === 'Sem motorista') return -1;
      return a.chave.localeCompare(b.chave, 'pt-BR');
    });
  }, [pedidosQuery.data]);

  const totalEmRota = useMemo(
    () => grupos.reduce((s, g) => s + g.pedidos.length, 0),
    [grupos],
  );

  // Filtro EFETIVO: se o motorista escolhido sumiu da rota (terminou as
  // entregas, por exemplo), cai de volta para "Todos" em vez de mostrar uma
  // tela vazia. Derivado na renderização para não piscar vazio antes do efeito.
  const filtroAtivo =
    motoristaSelecionado !== null &&
    grupos.some((g) => g.chave === motoristaSelecionado)
      ? motoristaSelecionado
      : null;

  // Sincroniza o estado com o filtro efetivo, senão o motorista voltaria a ser
  // filtrado sozinho caso reaparecesse num refetch posterior.
  useEffect(() => {
    if (motoristaSelecionado !== null && filtroAtivo === null) {
      setMotoristaSelecionado(null);
    }
  }, [motoristaSelecionado, filtroAtivo]);

  const gruposVisiveis = useMemo(
    () =>
      filtroAtivo === null
        ? grupos
        : grupos.filter((g) => g.chave === filtroAtivo),
    [grupos, filtroAtivo],
  );

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
          <>
            <div
              role="group"
              aria-label="Filtrar por motorista"
              className="flex flex-wrap items-center gap-2"
            >
              <button
                type="button"
                onClick={() => setMotoristaSelecionado(null)}
                aria-pressed={filtroAtivo === null}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  filtroAtivo === null
                    ? 'border-mata bg-mata text-creme shadow-carta'
                    : 'border-linha bg-papel text-tinta-suave hover:border-mata/30 hover:text-mata'
                }`}
              >
                Todos os motoristas ({totalEmRota})
              </button>
              {grupos.map((grupo) => {
                const ativo = filtroAtivo === grupo.chave;
                return (
                  <button
                    key={grupo.chave}
                    type="button"
                    onClick={() => setMotoristaSelecionado(grupo.chave)}
                    aria-pressed={ativo}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      ativo
                        ? 'border-mata bg-mata text-creme shadow-carta'
                        : 'border-linha bg-papel text-tinta-suave hover:border-mata/30 hover:text-mata'
                    }`}
                  >
                    {grupo.chave} ({grupo.pedidos.length})
                  </button>
                );
              })}
            </div>

            {gruposVisiveis.map((grupo) => {
              // Nenhuma parada sequenciada: o recado vai UMA vez, no cabeçalho,
              // e os cartões não repetem "sem sequência" n vezes. Rota mista
              // (algumas informadas) é o oposto: aí cada cartão precisa dizer
              // se está na fila ou não.
              const semSequencia = grupo.pedidos.every(
                (p) => p.ordemRota === null,
              );
              return (
                <section key={grupo.chave}>
                  <div className="flex items-baseline justify-between gap-3 border-b border-linha pb-2">
                    <h2 className="font-display text-lg font-semibold text-mata-escuro">
                      {grupo.chave}
                    </h2>
                    <span className="shrink-0 text-sm text-tinta-suave">
                      {grupo.pedidos.length === 1
                        ? '1 entrega'
                        : `${grupo.pedidos.length} entregas`}{' '}
                      ·{' '}
                      {(grupo.total / 1000).toLocaleString('pt-BR', {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}{' '}
                      t
                    </span>
                  </div>
                  {/*
                  Aviso neutro no cabeçalho do grupo quando NINGUÉM sequenciou:
                  não é falha nem pendência da logística — é só o motorista que
                  ainda não informou.
                */}
                  {semSequencia && (
                    <p className="mt-2 text-xs text-pedra">
                      Sem sequência definida — o motorista ainda não informou a
                      ordem das paradas.
                    </p>
                  )}

                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {grupo.pedidos.map((p) => (
                      <div key={p.id} className="flex flex-col">
                        {/*
                        A posição vem ACIMA do cartão em vez de dentro dele: o
                        EntregaCard é compartilhado com o quadro e com a agenda,
                        onde "parada 2" não significa nada.
                      */}
                        {!semSequencia && (
                          <div className="mb-1.5 flex items-center gap-2">
                            {p.ordemRota !== null ? (
                              <>
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-mata font-display text-xs font-bold text-creme-50">
                                  {p.ordemRota}
                                </span>
                                <span className="text-xs font-semibold text-tinta-suave">
                                  {p.ordemRota}ª parada
                                </span>
                              </>
                            ) : (
                              <span className="text-xs text-pedra">
                                Sem sequência definida
                              </span>
                            )}
                          </div>
                        )}
                        <EntregaCard
                          entrega={p}
                          podeEscrever={false}
                          podeSeparar={false}
                          onTransicionar={() => {}}
                          onSeparar={() => {}}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
