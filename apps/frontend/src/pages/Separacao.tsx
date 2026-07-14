// Página de SEPARAÇÃO: a fila de trabalho do almoxarifado.
//
// Antes desta tela, quem separa precisava caçar card por card no quadro de
// entregas. Aqui a pergunta é uma só: "o que tem para separar HOJE?".
//
// Mostra exatamente o que está na aba Agenda — os pedidos com status
// 'agendada' —, filtrados por um dia e agrupados por PERÍODO (o domínio do
// sistema é slot = data × período; ver pages/Agenda.tsx).
//
// Dá para marcar item a item (igual ao SeparacaoModal) ou "dar OK" no pedido
// inteiro de uma vez, que é o caminho rápido do dia a dia.
//
// Fuso: as datas vêm como 'YYYY-MM-DD'. Toda conversão passa por isoDeData
// (Date local) — `new Date('YYYY-MM-DD')` viraria UTC e volta um dia.

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Check,
  MapPin,
  PackageCheck,
  Truck,
  User,
  Undo2,
} from 'lucide-react';
import type { Pedido, PeriodoEntrega } from '@pastobom/shared';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';

/** Grupos exibidos no dia. 'sem' cobre o pedido agendado sem turno definido. */
type ChaveGrupo = PeriodoEntrega | 'sem';

const GRUPOS: ChaveGrupo[] = ['manha', 'tarde', 'sem'];

const GRUPO_ROTULO: Record<ChaveGrupo, string> = {
  manha: 'Manhã',
  tarde: 'Tarde',
  sem: 'Sem período definido',
};

const GRUPO_BADGE: Record<ChaveGrupo, string> = {
  manha: 'bg-folha-claro text-mata',
  tarde: 'bg-trigo-claro text-trigo-escuro',
  sem: 'bg-creme-100 text-tinta-suave',
};

// --- datas (sempre locais; nunca `new Date('YYYY-MM-DD')`) -----------------

function isoDeData(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function hojeLocal(): Date {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
}

function addDias(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** 'YYYY-MM-DD' → "Terça-feira, 14 de julho". */
function rotuloDoDia(iso: string): string {
  const partes = iso.split('-').map(Number);
  const ano = partes[0];
  const mes = partes[1];
  const dia = partes[2];
  if (ano === undefined || mes === undefined || dia === undefined) return iso;
  const d = new Date(ano, mes - 1, dia);
  return capitalizar(
    d.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
    }),
  );
}

function formatarQtd(qtd: number): string {
  return qtd.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatarPeso(kg: number): string {
  return `${kg.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`;
}

/** Um pedido só está "pronto" quando tem itens e todos estão marcados. */
function estaSeparado(pedido: Pedido): boolean {
  return pedido.itens.length > 0 && pedido.itens.every((i) => i.separado);
}

// --- página -----------------------------------------------------------------

export default function Separacao(): React.ReactElement {
  const { podeSeparar } = useAuth();
  const queryClient = useQueryClient();

  const [dia, setDia] = useState<string>(() => isoDeData(hojeLocal()));
  const [erro, setErro] = useState<string | null>(null);

  const isoHoje = isoDeData(hojeLocal());
  const isoAmanha = isoDeData(addDias(hojeLocal(), 1));

  // QueryKey própria, mas sob o prefixo ['pedidos'] — as mutações invalidam o
  // prefixo, então o quadro de entregas também se atualiza junto.
  const pedidosQuery = useQuery({
    queryKey: ['pedidos', 'separacao'],
    queryFn: ({ signal }) => api.listarPedidos(['agendada'], signal),
  });

  function aoFalhar(e: unknown): void {
    setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
  }

  async function aoConcluir(): Promise<void> {
    setErro(null);
    await queryClient.invalidateQueries({ queryKey: ['pedidos'] });
  }

  const itemMut = useMutation({
    mutationFn: (v: { pedidoId: string; itemId: string; separado: boolean }) =>
      api.definirSeparacao(v.pedidoId, v.itemId, v.separado),
    onSuccess: aoConcluir,
    onError: aoFalhar,
  });

  const pedidoMut = useMutation({
    mutationFn: (v: { pedidoId: string; separado: boolean }) =>
      api.definirSeparacaoPedido(v.pedidoId, v.separado),
    onSuccess: aoConcluir,
    onError: aoFalhar,
  });

  const doDia = useMemo(
    () => (pedidosQuery.data ?? []).filter((p) => p.dataAgendada === dia),
    [pedidosQuery.data, dia],
  );

  const grupos = useMemo(() => {
    const mapa = new Map<ChaveGrupo, Pedido[]>();
    for (const p of doDia) {
      const chave: ChaveGrupo = p.periodo ?? 'sem';
      const lista = mapa.get(chave);
      if (lista) lista.push(p);
      else mapa.set(chave, [p]);
    }
    // Cliente primeiro: é assim que o almoxarifado procura na prateleira.
    for (const lista of mapa.values()) {
      lista.sort((a, b) => a.clienteNome.localeCompare(b.clienteNome, 'pt-BR'));
    }
    return mapa;
  }, [doDia]);

  const total = doDia.length;
  const prontos = doDia.filter(estaSeparado).length;

  /** Este pedido tem uma escrita em voo? (trava os botões do cartão) */
  function ocupado(pedidoId: string): boolean {
    return (
      (itemMut.isPending && itemMut.variables?.pedidoId === pedidoId) ||
      (pedidoMut.isPending && pedidoMut.variables?.pedidoId === pedidoId)
    );
  }

  const botaoDia = (ativo: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
      ativo
        ? 'bg-mata text-creme-50 shadow-sm'
        : 'border border-linha bg-papel text-tinta-suave hover:border-mata/30 hover:text-mata'
    }`;

  if (!podeSeparar) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-xl2 border border-trigo/30 bg-trigo-claro px-5 py-6 text-center">
          <PackageCheck
            className="mx-auto h-6 w-6 text-trigo-escuro"
            aria-hidden="true"
          />
          <h2 className="mt-3 font-display text-base font-semibold text-trigo-escuro">
            Sem permissão
          </h2>
          <p className="mt-1 text-sm text-trigo-escuro">
            A separação de mercadorias é feita pelo almoxarifado ou pela
            logística.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Barra do dia */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-linha bg-creme-50/70 px-4 py-2.5 backdrop-blur sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              aria-label="Dia da separação"
              className="rounded-lg border border-linha bg-papel px-2.5 py-1.5 text-xs font-semibold text-tinta outline-none transition focus:border-mata/40"
            />
            <button
              type="button"
              onClick={() => setDia(isoHoje)}
              className={botaoDia(dia === isoHoje)}
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => setDia(isoAmanha)}
              className={botaoDia(dia === isoAmanha)}
            >
              Amanhã
            </button>
          </div>

          <div className="flex items-baseline gap-2 text-sm">
            <h2 className="font-display text-base font-semibold text-mata-escuro">
              {rotuloDoDia(dia)}
            </h2>
            {pedidosQuery.isFetching && (
              <span className="text-xs text-pedra">atualizando…</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold">
          <span className="rounded-full bg-creme-100 px-2.5 py-1 text-tinta-suave">
            {total === 1 ? '1 pedido' : `${total} pedidos`}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 ${
              total > 0 && prontos === total
                ? 'bg-mata-claro text-mata-escuro'
                : 'bg-trigo-claro text-trigo-escuro'
            }`}
          >
            {prontos} separado{prontos === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <main className="flex-1 overflow-auto scroll-suave">
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
        ) : (
          <div className="mx-auto max-w-[1200px] animate-sobe space-y-5 p-4 sm:p-6">
            {erro && (
              <div
                role="alert"
                className="rounded-xl2 border border-terra/30 bg-terra-claro px-4 py-2.5 text-sm text-terra-escuro"
              >
                {erro}
              </div>
            )}

            {total === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl2 border border-dashed border-linha bg-papel/60 py-14 text-center">
                <CalendarDays
                  className="h-6 w-6 text-pedra"
                  aria-hidden="true"
                />
                <p className="font-display text-base font-semibold text-mata-escuro">
                  Nada para separar neste dia
                </p>
                <p className="max-w-sm text-sm text-tinta-suave">
                  Assim que a logística agendar uma entrega para{' '}
                  {rotuloDoDia(dia).toLowerCase()}, o pedido aparece aqui.
                </p>
              </div>
            ) : (
              GRUPOS.map((chave) => {
                const lista = grupos.get(chave) ?? [];
                if (lista.length === 0) return null;
                const prontosGrupo = lista.filter(estaSeparado).length;

                return (
                  <section key={chave}>
                    <div className="mb-2.5 flex items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${GRUPO_BADGE[chave]}`}
                      >
                        {GRUPO_ROTULO[chave]}
                      </span>
                      <span className="text-xs text-tinta-suave">
                        {prontosGrupo}/{lista.length} separados
                      </span>
                      <span className="h-px flex-1 bg-linha" />
                    </div>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      {lista.map((pedido) => (
                        <CartaoSeparacao
                          key={pedido.id}
                          pedido={pedido}
                          ocupado={ocupado(pedido.id)}
                          onToggleItem={(itemId, separado) => {
                            setErro(null);
                            itemMut.mutate({
                              pedidoId: pedido.id,
                              itemId,
                              separado,
                            });
                          }}
                          onDefinirPedido={(separado) => {
                            setErro(null);
                            pedidoMut.mutate({ pedidoId: pedido.id, separado });
                          }}
                        />
                      ))}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// --- cartão de um pedido ----------------------------------------------------

interface CartaoProps {
  pedido: Pedido;
  ocupado: boolean;
  onToggleItem: (itemId: string, separado: boolean) => void;
  onDefinirPedido: (separado: boolean) => void;
}

function CartaoSeparacao({
  pedido,
  ocupado,
  onToggleItem,
  onDefinirPedido,
}: CartaoProps): React.ReactElement {
  const tot = pedido.itens.length;
  const sep = pedido.itens.filter((i) => i.separado).length;
  const completa = estaSeparado(pedido);
  const pct = tot > 0 ? Math.round((sep / tot) * 100) : 0;

  const local = [pedido.bairro, pedido.cidadeCliente]
    .filter((p) => p && p.trim().length > 0)
    .join(' · ');

  return (
    <article
      className={`rounded-xl2 border bg-papel p-4 shadow-carta transition ${
        completa ? 'border-folha/50 ring-1 ring-folha/30' : 'border-linha'
      }`}
    >
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-[15px] font-semibold leading-tight text-tinta">
            {pedido.clienteNome || pedido.clienteCodigo || 'Cliente'}
          </h3>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-tinta-suave">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true" />
            <span className="truncate">{local || '—'}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded-md bg-creme-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-tinta-suave">
            nº {pedido.orixNumero || '—'}
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
              completa
                ? 'bg-mata-claro text-mata-escuro'
                : 'bg-trigo-claro text-trigo-escuro'
            }`}
          >
            {sep}/{tot}
          </span>
        </div>
      </div>

      {/* Motorista · caminhão · peso */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-linha/70 pt-2 text-xs text-tinta-suave">
        <span className="flex min-w-0 items-center gap-1">
          <User className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true" />
          <span className="truncate">
            {pedido.motoristaNome || 'Sem motorista'}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <Truck className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true" />
          <span className="truncate">{pedido.caminhaoNome || '—'}</span>
        </span>
        {pedido.pesoTotalKg !== null && (
          <span className="font-semibold text-mata-escuro">
            {formatarPeso(pedido.pesoTotalKg)}
          </span>
        )}
      </div>

      {/* Progresso */}
      <div className="mb-3 mt-3 h-2 w-full overflow-hidden rounded-full bg-creme-100">
        <div
          className={`h-full rounded-full transition-all ${
            completa ? 'bg-folha' : 'bg-trigo'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Itens */}
      <ul className="scroll-suave max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {tot === 0 ? (
          <li className="rounded-lg bg-creme-50 px-3 py-4 text-center text-sm text-tinta-suave">
            Este pedido não tem itens cadastrados.
          </li>
        ) : (
          pedido.itens.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => onToggleItem(item.id, !item.separado)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition disabled:opacity-60 ${
                  item.separado
                    ? 'border-folha/40 bg-folha-claro/60'
                    : 'border-linha bg-creme-50 hover:border-folha/40'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                    item.separado
                      ? 'border-mata bg-mata text-creme-50'
                      : 'border-pedra bg-papel text-transparent'
                  }`}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm font-medium ${
                      item.separado ? 'text-mata-escuro' : 'text-tinta'
                    }`}
                  >
                    {item.qtd > 0 && (
                      <span className="font-bold">
                        {formatarQtd(item.qtd)}×{' '}
                      </span>
                    )}
                    {item.nomeProduto || item.produtoCodigo || 'Item'}
                  </span>
                  {item.produtoCodigo && (
                    <span className="text-[11px] text-tinta-suave">
                      cód. {item.produtoCodigo}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>

      {/* Ação */}
      <div className="mt-3.5">
        {completa ? (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-mata-claro px-3 py-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-mata-escuro">
              <Check className="h-4 w-4" aria-hidden="true" />
              Separado
            </span>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => onDefinirPedido(false)}
              className="flex items-center gap-1.5 rounded-lg border border-mata/30 bg-papel px-3 py-1.5 text-xs font-semibold text-mata-escuro transition hover:border-mata/60 disabled:opacity-60"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              Desfazer
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={ocupado || tot === 0}
            onClick={() => onDefinirPedido(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-mata px-4 py-2.5 text-sm font-semibold text-creme-50 shadow-sm transition hover:bg-mata-escuro disabled:opacity-60"
          >
            <PackageCheck className="h-4 w-4" aria-hidden="true" />
            Dar OK na separação
          </button>
        )}
      </div>
    </article>
  );
}
