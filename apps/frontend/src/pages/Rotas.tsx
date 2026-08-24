// Página de ROTAS, em duas abas (somente leitura nas duas):
//
// 1) "Em rota agora" — os pedidos que estão na estrada NESTE momento, agrupados
//    por motorista e na sequência de paradas que ele informou.
// 2) "Agenda do caminhão" — o calendário (mês/semana/dia) recortado por um
//    caminhão, pedido da Natália: "ver tudo que está agendado para aquele
//    caminhão na semana, no dia, no mês".
//
// As duas respondem a perguntas diferentes e de propósito ficam separadas: a
// primeira é "onde ele está agora?", a segunda é "o que ainda vai acontecer?".
// Juntá-las numa lista só faria a tela de hoje piscar de tamanho a cada dia
// navegado no calendário.
//
// A aba nova NÃO tem calendário próprio: ela monta os MESMOS componentes de
// components/agenda/ que a página de Agenda usa, sobre o mesmo GET /api/agenda e
// a mesma queryKey. Dois calendários divergiriam na primeira correção.

// A ORDEM DAS PARADAS (item 11 da Natália) aparece aqui SOMENTE LEITURA: quem
// informa é o motorista, na Rota do dia, porque é ele que acabou de descarregar
// e conhece a estrada. Esta tela é o outro lado do pedido — a logística ver, ao
// ligar para o cliente, em que posição da rota ele está.

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Info, Truck } from 'lucide-react';
import { filtrarSlotsPorCaminhao, ordenarParadas } from '@pastobom/shared';
import type { AgendaSlot, Entrega } from '@pastobom/shared';
import { api } from '../lib/api';
import { EntregaCard } from '../components/EntregaCard';
import { EntregaDetalheModal } from '../components/EntregaDetalheModal';
import {
  chaveSlot,
  NavegadorPeriodo,
  VisaoDia,
  VisaoMes,
  VisaoSemana,
} from '../components/agenda';
import type { Visao } from '../components/agenda';
import {
  addDias,
  addMeses,
  capitalizar,
  hojeLocal,
  inicioDaSemana,
  isoDeData,
} from '../lib/datas';

// Classe das pílulas de filtro (motorista na aba 1, caminhão na aba 2). É a
// mesma forma nas duas abas porque é o mesmo gesto: "quero ver só este".
function pilulaCls(ativo: boolean): string {
  return `rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
    ativo
      ? 'border-mata bg-mata text-creme shadow-carta'
      : 'border-linha bg-papel text-tinta-suave hover:border-mata/30 hover:text-mata'
  }`;
}

// ---------------------------------------------------------------------------
// Aba 1: em rota agora
// ---------------------------------------------------------------------------

interface GrupoRota {
  chave: string;
  pedidos: Entrega[];
  total: number;
}

function PainelEmRota(): React.ReactElement {
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
                className={pilulaCls(filtroAtivo === null)}
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
                    className={pilulaCls(ativo)}
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

// ---------------------------------------------------------------------------
// Aba 2: agenda do caminhão
// ---------------------------------------------------------------------------
//
// Fuso: as datas vêm como 'YYYY-MM-DD'. Toda conversão passa por isoDeData /
// dataDeIso (Date local) — `new Date('YYYY-MM-DD')` viraria UTC e volta um dia.

interface Intervalo {
  inicio: Date;
  fim: Date;
  dias: Date[];
}

// intervaloDaVisao e tituloDoPeriodo são a MONTAGEM da página, não a visão: o
// que os componentes de components/agenda/ recebem é a lista de dias já pronta.
// Ficam aqui (como na página de Agenda) porque cada tela navega o seu período —
// esta, por exemplo, começa na semana do caminhão, não no mês.
function intervaloDaVisao(visao: Visao, ancora: Date): Intervalo {
  if (visao === 'dia') {
    return { inicio: ancora, fim: ancora, dias: [ancora] };
  }

  let inicio: Date;
  let fim: Date;
  if (visao === 'semana') {
    inicio = inicioDaSemana(ancora);
    fim = addDias(inicio, 6);
  } else {
    const primeiro = new Date(ancora.getFullYear(), ancora.getMonth(), 1);
    const ultimo = new Date(ancora.getFullYear(), ancora.getMonth() + 1, 0);
    inicio = inicioDaSemana(primeiro);
    fim = addDias(inicioDaSemana(ultimo), 6);
  }

  const dias: Date[] = [];
  for (let d = inicio; d <= fim; d = addDias(d, 1)) {
    dias.push(d);
  }
  return { inicio, fim, dias };
}

function tituloDoPeriodo(
  visao: Visao,
  intervalo: Intervalo,
  ancora: Date,
): string {
  if (visao === 'dia') {
    return capitalizar(
      ancora.toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }),
    );
  }
  if (visao === 'semana') {
    const curto = (d: Date) =>
      d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `${curto(intervalo.inicio)} – ${curto(intervalo.fim)} de ${intervalo.fim.getFullYear()}`;
  }
  return capitalizar(
    ancora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  );
}

function PainelAgendaCaminhao(): React.ReactElement {
  // Semana é o padrão: é a pergunta que a Natália faz mais ("o que esse
  // caminhão tem essa semana?"). Mês serve para enxergar folga adiante.
  const [visao, setVisao] = useState<Visao>('semana');
  const [ancora, setAncora] = useState<Date>(() => hojeLocal());
  // null = TODOS os caminhões — ver a decisão comentada nas pílulas abaixo.
  const [caminhaoId, setCaminhaoId] = useState<string | null>(null);
  // Viagem cujo detalhe está aberto. A busca é sob demanda, dentro do modal.
  const [detalheId, setDetalheId] = useState<string | null>(null);

  const intervalo = useMemo(
    () => intervaloDaVisao(visao, ancora),
    [visao, ancora],
  );
  const de = isoDeData(intervalo.inicio);
  const ate = isoDeData(intervalo.fim);

  // MESMA queryKey da página de Agenda, de propósito: quem já abriu o
  // calendário lá entra aqui com os dados prontos (e vice-versa), e um refetch
  // atualiza as duas telas. Backend novo: nenhum.
  const agendaQuery = useQuery({
    queryKey: ['agenda', de, ate],
    queryFn: ({ signal }) => api.agenda(de, ate, signal),
  });

  // A frota vem no PRÓPRIO payload da agenda (AgendaResposta.caminhoes, frota
  // ativa) — nenhuma requisição extra só para desenhar as pílulas.
  const caminhoes = agendaQuery.data?.caminhoes ?? [];
  const slots = agendaQuery.data?.slots ?? [];

  // Filtro EFETIVO, no mesmo espírito da aba de motoristas: se o caminhão
  // escolhido saiu da frota ativa, volta para "Todos" em vez de mostrar tela
  // vazia. Enquanto a frota não chegou (lista vazia), a escolha é respeitada —
  // senão o primeiro carregamento apagaria o filtro do usuário.
  const filtroAtivo =
    caminhaoId !== null &&
    (caminhoes.length === 0 || caminhoes.some((c) => c.id === caminhaoId))
      ? caminhaoId
      : null;

  useEffect(() => {
    if (caminhaoId !== null && filtroAtivo === null) setCaminhaoId(null);
  }, [caminhaoId, filtroAtivo]);

  // O recorte por caminhão é do @pastobom/shared (testado): ele filtra
  // entregas, reservas E ocupação — sem cortar a ocupação, a barra de
  // capacidade continuaria somando os outros caminhões do dia — e mantém o slot
  // em que o caminhão só tem RESERVA, porque é dia ocupado dele.
  const slotsVisiveis = useMemo(
    () =>
      filtroAtivo === null
        ? slots
        : filtrarSlotsPorCaminhao(slots, filtroAtivo),
    [slots, filtroAtivo],
  );

  const porSlot = useMemo(() => {
    const mapa = new Map<string, AgendaSlot>();
    for (const slot of slotsVisiveis) {
      mapa.set(chaveSlot(slot.data, slot.periodo), slot);
    }
    return mapa;
  }, [slotsVisiveis]);

  // Contagem por caminhão para o número na pílula: quem bate o olho já vê onde
  // está o movimento do período, sem clicar em cada um. Entrega e reserva somam
  // porque as duas OCUPAM o caminhão.
  const contagemPorCaminhao = useMemo(() => {
    const mapa = new Map<string, number>();
    const somar = (id: string) => mapa.set(id, (mapa.get(id) ?? 0) + 1);
    for (const slot of slots) {
      for (const e of slot.entregas) {
        if (e.caminhaoId !== null) somar(e.caminhaoId);
      }
      for (const r of slot.reservas) somar(r.caminhaoId);
    }
    return mapa;
  }, [slots]);

  const totalEntregas = slotsVisiveis.reduce(
    (s, slot) => s + slot.entregas.length,
    0,
  );
  // As reservas contam separado: elas não são entrega, mas OCUPAM o período, e
  // é por isso que o aviso de vazio abaixo tem de olhar as duas coisas.
  const totalReservas = slotsVisiveis.reduce(
    (s, slot) => s + slot.reservas.length,
    0,
  );

  const totalPeriodo = slots.reduce(
    (s, slot) => s + slot.entregas.length + slot.reservas.length,
    0,
  );

  const isoHoje = isoDeData(hojeLocal());
  const titulo = tituloDoPeriodo(visao, intervalo, ancora);
  const nomeSelecionado =
    caminhoes.find((c) => c.id === filtroAtivo)?.nome ?? null;

  function navegar(passo: -1 | 1) {
    if (visao === 'dia') setAncora((a) => addDias(a, passo));
    else if (visao === 'semana') setAncora((a) => addDias(a, passo * 7));
    else setAncora((a) => addMeses(a, passo));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <NavegadorPeriodo
        visao={visao}
        titulo={titulo}
        totalEntregas={totalEntregas}
        totalReservas={totalReservas}
        atualizando={agendaQuery.isFetching}
        onNavegar={navegar}
        onHoje={() => setAncora(hojeLocal())}
        onVisao={setVisao}
      />

      <main className="min-h-0 flex-1 overflow-auto scroll-suave">
        {agendaQuery.isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-tinta-suave">
            Carregando agenda…
          </div>
        ) : agendaQuery.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-tinta-suave">
            <p>
              {agendaQuery.error instanceof Error
                ? agendaQuery.error.message
                : 'Não foi possível carregar a agenda.'}
            </p>
            <button
              type="button"
              onClick={() => void agendaQuery.refetch()}
              className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave hover:border-mata/30 hover:text-mata"
            >
              Tentar novamente
            </button>
          </div>
        ) : (
          <div className="mx-auto min-w-0 max-w-[1600px] space-y-4 p-4 animate-sobe sm:p-6">
            {/*
              Sem caminhão escolhido mostramos TUDO, não um convite a escolher.
              A Natália quer um caminhão por vez, mas quem abre a aba nem sempre
              sabe qual: "quem está livre quinta?" só se responde vendo o dia
              inteiro. Tela vazia esperando clique esconderia justamente essa
              resposta — e a aba "Em rota agora" já usa o mesmo par
              "Todos + pílulas", então o gesto é o mesmo em toda a página.
            */}
            <div
              role="group"
              aria-label="Filtrar por caminhão"
              className="flex flex-wrap items-center gap-2"
            >
              <button
                type="button"
                onClick={() => setCaminhaoId(null)}
                aria-pressed={filtroAtivo === null}
                className={pilulaCls(filtroAtivo === null)}
              >
                Todos os caminhões ({totalPeriodo})
              </button>
              {caminhoes.map((c) => {
                const ativo = filtroAtivo === c.id;
                const n = contagemPorCaminhao.get(c.id) ?? 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCaminhaoId(c.id)}
                    aria-pressed={ativo}
                    title={c.placa ? `${c.nome} · ${c.placa}` : c.nome}
                    className={pilulaCls(ativo)}
                  >
                    <span className="flex items-center gap-1.5">
                      <Truck className="h-3.5 w-3.5" aria-hidden="true" />
                      {c.nome} ({n})
                    </span>
                  </button>
                );
              })}
            </div>

            {/*
              Aviso HONESTO e discreto: GET /api/agenda devolve só 'agendada' e
              'em_rota' — é o contrato da rota, não um bug. Sem esta linha,
              alguém olha a semana passada, não vê o que já foi entregue e
              conclui que "faltou entrega no caminhão".
            */}
            <p className="flex items-start gap-2 text-xs text-pedra">
              <Info
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              Esta agenda mostra o que está AGENDADO (e o que já saiu em rota).
              Entregas concluídas saem do calendário — para o histórico, use os
              relatórios.
            </p>

            {totalEntregas === 0 && totalReservas === 0 && (
              <p className="flex items-center justify-center gap-2 rounded-xl2 border border-dashed border-linha bg-papel/60 py-6 text-sm text-tinta-suave">
                <CalendarDays
                  className="h-4 w-4 text-pedra"
                  aria-hidden="true"
                />
                {nomeSelecionado === null
                  ? 'Nada agendado neste período.'
                  : `Nada agendado para ${nomeSelecionado} neste período.`}
              </p>
            )}

            {visao === 'mes' && (
              <VisaoMes
                dias={intervalo.dias}
                mesAtual={ancora.getMonth()}
                isoHoje={isoHoje}
                porSlot={porSlot}
              />
            )}

            {visao === 'semana' && (
              <VisaoSemana
                dias={intervalo.dias}
                isoHoje={isoHoje}
                porSlot={porSlot}
                onAbrir={setDetalheId}
              />
            )}

            {visao === 'dia' && (
              <VisaoDia
                data={isoDeData(ancora)}
                porSlot={porSlot}
                onAbrir={setDetalheId}
              />
            )}
          </div>
        )}
      </main>

      {detalheId !== null && (
        <EntregaDetalheModal
          entregaId={detalheId}
          onFechar={() => setDetalheId(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A página: as duas abas
// ---------------------------------------------------------------------------

type Aba = 'em-rota' | 'agenda';

export function Rotas(): React.ReactElement {
  const [aba, setAba] = useState<Aba>('em-rota');

  // "Em rota agora" continua sendo a aba de entrada: é a pergunta urgente do
  // telefone tocando ("onde está o meu pedido?"). A agenda é planejamento.
  const abaCls = (ativo: boolean) =>
    `rounded-t-lg border-b-2 px-3 py-2 text-sm font-semibold transition ${
      ativo
        ? 'border-mata text-mata-escuro'
        : 'border-transparent text-tinta-suave hover:text-mata'
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Visões da rota"
        className="flex items-center gap-1 border-b border-linha bg-creme-50/70 px-4 sm:px-6"
      >
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'em-rota'}
          onClick={() => setAba('em-rota')}
          className={abaCls(aba === 'em-rota')}
        >
          Em rota agora
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'agenda'}
          onClick={() => setAba('agenda')}
          className={abaCls(aba === 'agenda')}
        >
          Agenda do caminhão
        </button>
      </div>

      {/* Uma aba por vez, desmontada ao trocar: o estado que importa (a lista em
          rota e os slots do período) vive no cache do react-query, então voltar
          para a aba anterior não custa requisição nova. */}
      <div className="min-h-0 flex-1">
        {aba === 'em-rota' ? <PainelEmRota /> : <PainelAgendaCaminhao />}
      </div>
    </div>
  );
}
