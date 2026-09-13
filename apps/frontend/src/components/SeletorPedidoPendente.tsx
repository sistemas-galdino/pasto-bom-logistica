// ESCOLHER O PEDIDO depois de clicar numa vaga da agenda.
//
// O gesto que esta tela completa é o pedido da Natália (reunião de 27/08):
// clicar em "quinta de manhã, Cargo 816" e seguir dali até o agendamento, sem
// voltar ao Quadro. Ela entra entre a vaga e o modal de agendar, e por isso o
// cabeçalho repete o slot escolhido: quem clicou há três segundos ainda precisa
// ver que continua falando do mesmo dia.
//
// SEM ENDPOINT NOVO, e isso é decisão, não preguiça. "Pedido pendente" na
// operação NÃO é `status = pendente`: é SALDO > 0. Um endpoint por status
// devolveria pedidos já inteiramente comprometidos em viagens marcadas, e para
// não mentir ele teria de calcular saldo em lote no servidor — a SEGUNDA
// definição de "pendente com saldo" no sistema, com a garantia de divergir da
// primeira. Aqui reusamos `pedidosComSaldo`, a mesma do Quadro.
//
// A ARMADILHA DA QUERYKEY: ['pedidos', {}] é a MESMA chave do Quadro, cuja
// queryFn pede TRÊS status. Usar a mesma chave pedindo só ['pendente'] faria
// quem montasse primeiro vencer — e a aba "Descartados" do Quadro esvaziaria
// sozinha, sem erro nenhum. Regra: CHAVE IGUAL, FETCH IGUAL. O recorte é em
// memória, logo abaixo.
//
// GATILHO DE REVISÃO, escrito aqui para não se perder: se GET /pedidos passar
// de ~800 linhas (o PostgREST corta em 1000 EM SILÊNCIO) ou se este seletor
// demorar mais de 2 s para abrir, aí sim entra um `GET /api/pedidos/pendentes?q=`
// no molde de fornecedores.ts, com o saldo calculado no servidor e o Quadro
// migrado junto — nunca só este seletor.

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { casaBusca, normalizarBusca } from '@pastobom/shared';
import { api } from '../lib/api';
import { PedidoCard } from './PedidoCard';
import {
  agruparEntregasPorPedido,
  pedidosComSaldo,
  type PedidoComSaldo,
} from '../lib/saldo-pedidos';
import { formatarData } from '../lib/format';

/** Teto de cartões desenhados de uma vez. Acima disso, refinar é mais rápido. */
const MAX_CARTOES = 50;

export interface SeletorPedidoPendenteProps {
  /** O slot que a pessoa clicou, para o cabeçalho e para o modal seguinte. */
  data: string;
  periodo: 'manha' | 'tarde';
  nomeCaminhao: string;
  onEscolher: (escolhido: PedidoComSaldo) => void;
  onFechar: () => void;
}

const PERIODO_ROTULO = { manha: 'Manhã', tarde: 'Tarde' } as const;

export function SeletorPedidoPendente({
  data,
  periodo,
  nomeCaminhao,
  onEscolher,
  onFechar,
}: SeletorPedidoPendenteProps): React.ReactElement {
  const [busca, setBusca] = useState('');

  // CHAVE IGUAL, FETCH IGUAL — ver o cabeçalho. Os três status são os mesmos
  // que o Quadro pede, então as duas telas dividem o mesmo cache em vez de
  // brigarem por ele.
  const pedidosQuery = useQuery({
    queryKey: ['pedidos', {}],
    queryFn: ({ signal }) =>
      api.listarPedidos(['pendente', 'entregue', 'cancelada'], signal, {}),
  });

  const entregasQuery = useQuery({
    queryKey: ['entregas'],
    queryFn: ({ signal }) => api.listarEntregas({}, signal),
  });

  const pendentes = useMemo(() => {
    const pedidos = pedidosQuery.data ?? [];
    const entregas = entregasQuery.data ?? [];
    return pedidosComSaldo(pedidos, agruparEntregasPorPedido(entregas));
  }, [pedidosQuery.data, entregasQuery.data]);

  // Busca local, sem debounce: a lista já está em memória, e o atraso de um
  // debounce seria maior que o próprio filtro.
  const termo = normalizarBusca(busca);
  const filtrados = useMemo(
    () =>
      pendentes.filter(({ pedido }) =>
        casaBusca(termo, [
          pedido.clienteNome,
          pedido.orixNumero,
          pedido.cidadeCliente,
          pedido.bairro,
          ...pedido.itens.map((i) => i.nomeProduto),
          ...pedido.itens.map((i) => i.produtoCodigo),
        ]),
      ),
    [pendentes, termo],
  );

  const mostrados = filtrados.slice(0, MAX_CARTOES);
  const cortados = filtrados.length - mostrados.length;
  const carregando = pedidosQuery.isLoading || entregasQuery.isLoading;
  const erro = pedidosQuery.error ?? entregasQuery.error;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-tinta/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Escolher pedido para agendar"
    >
      <div className="animate-sobe my-6 w-full max-w-5xl rounded-xl2 border border-linha bg-papel shadow-carta">
        <header className="flex items-start justify-between gap-3 border-b border-linha px-5 py-3.5">
          <div>
            <h2 className="font-display text-lg font-semibold text-mata-escuro">
              Qual pedido vai nesta viagem?
            </h2>
            <p className="mt-0.5 text-xs text-tinta-suave">
              Agendar em {formatarData(data)} · {PERIODO_ROTULO[periodo]} ·{' '}
              {nomeCaminhao}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded-lg p-1 text-tinta-suave transition hover:bg-creme-50 hover:text-tinta"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="border-b border-linha px-5 py-3">
          <label className="flex items-center gap-2 rounded-lg border border-linha bg-creme-50/60 px-2.5 py-1.5">
            <Search className="h-4 w-4 shrink-0 text-pedra" aria-hidden="true" />
            <input
              // Autofoco: quem chegou aqui sabe o cliente que quer; digitar é
              // mais rápido do que caçar o cartão na grade.
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Cliente, nº da OV, cidade, bairro ou produto"
              className="w-full bg-transparent text-sm text-tinta outline-none placeholder:text-pedra"
            />
          </label>
        </div>

        <div className="scroll-suave max-h-[60vh] overflow-y-auto p-5">
          {carregando ? (
            <p className="py-10 text-center text-sm text-tinta-suave">
              Carregando pedidos…
            </p>
          ) : erro ? (
            <p className="py-10 text-center text-sm text-terra-escuro">
              {erro instanceof Error
                ? erro.message
                : 'Não foi possível carregar os pedidos.'}
            </p>
          ) : mostrados.length === 0 ? (
            <p className="py-10 text-center text-sm text-tinta-suave">
              {termo === ''
                ? 'Nenhum pedido pendente para agendar.'
                : 'Nenhum pedido pendente com esse termo.'}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mostrados.map((item) => (
                  <PedidoCard
                    key={item.pedido.id}
                    pedido={item.pedido}
                    saldo={item.saldo}
                    podeEscrever
                    onAgendar={() => onEscolher(item)}
                  />
                ))}
              </div>
              {cortados > 0 && (
                // Não fingir que coube: dizer quantos ficaram de fora é o que
                // impede alguém de concluir que "o pedido sumiu do sistema".
                <p className="mt-4 text-center text-xs text-pedra">
                  Mostrando {MAX_CARTOES} de {filtrados.length} pedidos — refine
                  a busca para achar o resto.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
