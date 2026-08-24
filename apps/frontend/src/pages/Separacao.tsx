// Página de SEPARAÇÃO: a fila de trabalho do almoxarifado.
//
// Antes desta tela, quem separa precisava caçar card por card no quadro de
// entregas. Aqui a pergunta é uma só: "o que tem para separar HOJE?".
//
// Mostra exatamente o que está na aba Agenda — as VIAGENS agendadas —,
// filtradas por um dia e agrupadas por PERÍODO (o domínio do sistema é
// slot = data × período; ver pages/Agenda.tsx).
//
// Onda 2: a conferência é POR VIAGEM. Se o mesmo pedido sai em dois caminhões,
// são dois cartões e duas conferências independentes — que é como a carga é
// realmente montada no pátio.
//
// Duas escolhas vieram da reunião de 16/07/2026:
//   - FILTRO POR CAMINHÃO: quem carrega o 1620 quer ver só a carga do 1620.
//   - ATRASADOS: pedido agendado para um dia que já passou não some da fila.
//     Antes ele só aparecia se alguém adivinhasse a data no seletor.
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
  Printer,
  Truck,
  User,
  Undo2,
} from 'lucide-react';
import type { Entrega, PeriodoEntrega } from '@pastobom/shared';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';

/**
 * Grupos exibidos. 'sem' cobre o pedido agendado sem turno definido; 'atrasado'
 * é o grupo único da visão de atrasados — ali o turno não ajuda (são vários
 * dias), o que importa é a data de cada pedido, que vai no próprio cartão.
 */
type ChaveGrupo = PeriodoEntrega | 'sem' | 'atrasado';

const GRUPOS: ChaveGrupo[] = ['atrasado', 'manha', 'tarde', 'sem'];

const GRUPO_ROTULO: Record<ChaveGrupo, string> = {
  manha: 'Manhã',
  tarde: 'Tarde',
  sem: 'Sem período definido',
  atrasado: 'Atrasados',
};

const GRUPO_BADGE: Record<ChaveGrupo, string> = {
  manha: 'bg-folha-claro text-mata',
  tarde: 'bg-trigo-claro text-trigo-escuro',
  sem: 'bg-creme-100 text-tinta-suave',
  atrasado: 'bg-brasa-claro text-brasa-escuro',
};

/** O que a tela está mostrando: um dia específico ou a fila de atrasados. */
type Selecao = { tipo: 'dia'; iso: string } | { tipo: 'atrasados' };

/** Chave de agrupamento por caminhão (o pedido pode ainda não ter um). */
const SEM_CAMINHAO = 'Sem caminhão';

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

/** 'YYYY-MM-DD' → "13/07" (só o essencial: o cartão é apertado). */
function formatarDataCurta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso;
}

function formatarQtd(qtd: number): string {
  return qtd.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatarPeso(kg: number): string {
  return `${kg.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`;
}

/** Uma viagem só está "pronta" quando tem itens e todos estão marcados. */
function estaSeparado(entrega: Entrega): boolean {
  return entrega.itens.length > 0 && entrega.itens.every((i) => i.separado);
}

// --- página -----------------------------------------------------------------

export default function Separacao(): React.ReactElement {
  const { podeSeparar } = useAuth();
  const queryClient = useQueryClient();

  const [selecao, setSelecao] = useState<Selecao>(() => ({
    tipo: 'dia',
    iso: isoDeData(hojeLocal()),
  }));
  // null = "Todos os caminhões". Guarda o NOME do caminhão (ou SEM_CAMINHAO).
  const [caminhao, setCaminhao] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const isoHoje = isoDeData(hojeLocal());
  const isoAmanha = isoDeData(addDias(hojeLocal(), 1));

  // QueryKey própria, mas sob o prefixo ['pedidos'] — as mutações invalidam o
  // prefixo, então o quadro de entregas também se atualiza junto.
  const pedidosQuery = useQuery({
    queryKey: ['entregas', 'separacao'],
    queryFn: ({ signal }) =>
      api.listarEntregas({ status: ['agendada'] }, signal),
  });

  function aoFalhar(e: unknown): void {
    setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
  }

  async function aoConcluir(): Promise<void> {
    setErro(null);
    // Invalida os dois: a separação muda a viagem e libera o "pôr em rota" no
    // quadro, que lista entregas e pedidos lado a lado.
    await queryClient.invalidateQueries({ queryKey: ['entregas'] });
    await queryClient.invalidateQueries({ queryKey: ['pedidos'] });
  }

  const itemMut = useMutation({
    mutationFn: (v: { pedidoId: string; itemId: string; separado: boolean }) =>
      api.definirSeparacaoItemEntrega(v.pedidoId, v.itemId, v.separado),
    onSuccess: aoConcluir,
    onError: aoFalhar,
  });

  const pedidoMut = useMutation({
    mutationFn: (v: { pedidoId: string; separado: boolean }) =>
      api.definirSeparacaoEntrega(v.pedidoId, v.separado),
    onSuccess: aoConcluir,
    onError: aoFalhar,
  });

  // O que a seleção atual traz, ANTES do filtro de caminhão (é desta lista que
  // saem as pílulas de caminhão — senão o filtro esconderia as próprias opções).
  const daSelecao = useMemo(() => {
    const todos = pedidosQuery.data ?? [];
    if (selecao.tipo === 'atrasados') {
      // Comparação de string funciona: 'YYYY-MM-DD' ordena igual à data.
      return todos.filter(
        (p) => p.dataAgendada !== null && p.dataAgendada < isoHoje,
      );
    }
    return todos.filter((p) => p.dataAgendada === selecao.iso);
  }, [pedidosQuery.data, selecao, isoHoje]);

  /** Caminhões presentes na seleção, com quantos pedidos cada um tem. */
  const caminhoes = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const p of daSelecao) {
      const chave = p.caminhaoNome || SEM_CAMINHAO;
      mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
    }
    return [...mapa].sort(([a], [b]) => {
      if (a === SEM_CAMINHAO) return 1;
      if (b === SEM_CAMINHAO) return -1;
      return a.localeCompare(b, 'pt-BR');
    });
  }, [daSelecao]);

  // Filtro EFETIVO: se o caminhão escolhido não está mais na seleção (mudou de
  // dia, a carga saiu), cai para "Todos" em vez de mostrar uma tela vazia.
  const caminhaoAtivo =
    caminhao !== null && caminhoes.some(([nome]) => nome === caminhao)
      ? caminhao
      : null;

  const doDia = useMemo(
    () =>
      caminhaoAtivo === null
        ? daSelecao
        : daSelecao.filter((p) => (p.caminhaoNome || SEM_CAMINHAO) === caminhaoAtivo),
    [daSelecao, caminhaoAtivo],
  );

  const grupos = useMemo(() => {
    const mapa = new Map<ChaveGrupo, Entrega[]>();
    for (const p of doDia) {
      // Em atrasados, turno não organiza nada (são dias diferentes): tudo cai
      // num grupo só e cada cartão mostra a sua data.
      const chave: ChaveGrupo =
        selecao.tipo === 'atrasados' ? 'atrasado' : (p.periodo ?? 'sem');
      const lista = mapa.get(chave);
      if (lista) lista.push(p);
      else mapa.set(chave, [p]);
    }
    for (const lista of mapa.values()) {
      lista.sort((a, b) => {
        // Atrasados: o mais antigo primeiro — é o que está esperando há mais tempo.
        if (selecao.tipo === 'atrasados') {
          const porData = (a.dataAgendada ?? '').localeCompare(
            b.dataAgendada ?? '',
          );
          if (porData !== 0) return porData;
        }
        // Cliente: é assim que o almoxarifado procura na prateleira.
        return a.clienteNome.localeCompare(b.clienteNome, 'pt-BR');
      });
    }
    return mapa;
  }, [doDia, selecao.tipo]);

  const total = doDia.length;
  const prontos = doDia.filter(estaSeparado).length;
  const totalSelecao = daSelecao.length;

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

  const pilulaCaminhao = (ativo: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
      ativo
        ? 'border-mata bg-mata text-creme-50 shadow-carta'
        : 'border-linha bg-papel text-tinta-suave hover:border-mata/30 hover:text-mata'
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
              value={selecao.tipo === 'dia' ? selecao.iso : ''}
              onChange={(e) =>
                setSelecao({ tipo: 'dia', iso: e.target.value || isoHoje })
              }
              aria-label="Dia da separação"
              className="rounded-lg border border-linha bg-papel px-2.5 py-1.5 text-xs font-semibold text-tinta outline-none transition focus:border-mata/40"
            />
            <button
              type="button"
              onClick={() => setSelecao({ tipo: 'dia', iso: isoHoje })}
              className={botaoDia(selecao.tipo === 'dia' && selecao.iso === isoHoje)}
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => setSelecao({ tipo: 'dia', iso: isoAmanha })}
              className={botaoDia(
                selecao.tipo === 'dia' && selecao.iso === isoAmanha,
              )}
            >
              Amanhã
            </button>
            {/* Agendado para trás não some da fila: continua para separar. */}
            <button
              type="button"
              onClick={() => setSelecao({ tipo: 'atrasados' })}
              title="Pedidos agendados para dias que já passaram e ainda não saíram"
              className={botaoDia(selecao.tipo === 'atrasados')}
            >
              Atrasados
            </button>
          </div>

          <div className="flex items-baseline gap-2 text-sm">
            <h2 className="font-display text-base font-semibold text-mata-escuro">
              {selecao.tipo === 'atrasados'
                ? 'Atrasados'
                : rotuloDoDia(selecao.iso)}
            </h2>
            {pedidosQuery.isFetching && (
              <span className="text-xs text-pedra">atualizando…</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold">
          {/* O galpão ainda separa no papel (áudio da Natália). Leva o filtro
              da tela: usa caminhaoAtivo, e não `caminhao`, para não gerar link
              de um filtro que já caiu. */}
          <button
            type="button"
            onClick={() => {
              const p = new URLSearchParams();
              if (selecao.tipo === 'atrasados') p.set('modo', 'atrasados');
              else p.set('dia', selecao.iso);
              if (caminhaoAtivo !== null) p.set('caminhao', caminhaoAtivo);
              window.open(`/separacao/imprimir?${p.toString()}`, '_blank');
            }}
            disabled={total === 0}
            title="Abre a lista em papel numa aba nova. O PDF sai pelo diálogo de impressão (Salvar como PDF)."
            className="inline-flex items-center gap-1.5 rounded-lg border border-linha bg-papel px-2.5 py-1 text-tinta-suave transition hover:border-mata/30 hover:text-mata disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            Imprimir lista
          </button>
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

            {/* Filtro por caminhão: quem carrega o 1620 quer ver só o 1620.
                Só aparece quando há mais de um caminhão para escolher. */}
            {caminhoes.length > 1 && (
              <div
                role="group"
                aria-label="Filtrar por caminhão"
                className="flex flex-wrap items-center gap-2"
              >
                <button
                  type="button"
                  onClick={() => setCaminhao(null)}
                  aria-pressed={caminhaoAtivo === null}
                  className={pilulaCaminhao(caminhaoAtivo === null)}
                >
                  Todos os caminhões ({totalSelecao})
                </button>
                {caminhoes.map(([nome, qtde]) => (
                  <button
                    key={nome}
                    type="button"
                    onClick={() => setCaminhao(nome)}
                    aria-pressed={caminhaoAtivo === nome}
                    className={pilulaCaminhao(caminhaoAtivo === nome)}
                  >
                    {nome} ({qtde})
                  </button>
                ))}
              </div>
            )}

            {total === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl2 border border-dashed border-linha bg-papel/60 py-14 text-center">
                <CalendarDays
                  className="h-6 w-6 text-pedra"
                  aria-hidden="true"
                />
                <p className="font-display text-base font-semibold text-mata-escuro">
                  {selecao.tipo === 'atrasados'
                    ? 'Nenhum pedido atrasado'
                    : 'Nada para separar neste dia'}
                </p>
                <p className="max-w-sm text-sm text-tinta-suave">
                  {selecao.tipo === 'atrasados'
                    ? 'Tudo que foi agendado para trás já saiu para rota.'
                    : `Assim que a logística agendar uma entrega para ${rotuloDoDia(
                        selecao.iso,
                      ).toLowerCase()}, o pedido aparece aqui.`}
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
                          mostrarData={selecao.tipo === 'atrasados'}
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
  pedido: Entrega;
  /** Na fila de atrasados os cartões são de dias diferentes: a data importa. */
  mostrarData?: boolean;
  ocupado: boolean;
  onToggleItem: (itemId: string, separado: boolean) => void;
  onDefinirPedido: (separado: boolean) => void;
}

function CartaoSeparacao({
  pedido,
  mostrarData = false,
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
          {mostrarData && pedido.dataAgendada && (
            <span
              title="Data para a qual esta entrega foi agendada"
              className="rounded-md bg-brasa-claro px-1.5 py-0.5 text-[10px] font-semibold text-brasa-escuro"
            >
              {formatarDataCurta(pedido.dataAgendada)}
            </span>
          )}
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
        {pedido.pesoTotalKg !== null ? (
          <span className="font-semibold text-mata-escuro">
            {formatarPeso(pedido.pesoTotalKg)}
          </span>
        ) : (
          // Peso desconhecido sumia da tela sem dizer nada. Agora aparece, como
          // já aparece na Agenda — quem separa a carga é quem percebe primeiro.
          <span
            className="font-semibold text-trigo-escuro"
            title="Algum item desta viagem está sem peso cadastrado."
          >
            peso pendente
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
