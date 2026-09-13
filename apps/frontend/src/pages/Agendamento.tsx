// Página de AGENDAMENTO — a agenda do caminhão, e o lugar de agendar.
//
// POR QUE ELA EXISTE
// ---------------------------------------------------------------------------
// Era a aba 2 da Rota. A Natália descreveu o problema na reunião de 27/08, com
// o Johnny do lado: para agendar uma entrega ele abre o Quadro, descobre que
// não sabe se o caminhão está livre, vai até a Agenda, olha o dia, volta para o
// Quadro e agenda. "entra nessa tela para ver isso, tem que sair dessa tela
// para fazer esse tipo de coisa. Então tá um pouco ainda disfuncional."
//
// A tela nova é a costura: ver a agenda do caminhão E agendar nela. Por isso
// ela saiu de dentro da Rota — que é a tela do "onde ele está AGORA" — e virou
// item próprio do menu, entre o Quadro e a Separação.
//
// Ela NÃO tem calendário próprio: monta os MESMOS componentes de
// components/agenda/ que a página de Agenda usa, sobre o mesmo GET /api/agenda
// e a MESMA queryKey. Dois calendários divergiriam na primeira correção.
//
// A /agenda continua SOMENTE LEITURA para todos os papéis. Esta aqui é a de
// escrita — e mesmo ela é aberta ao vendedor, que precisa ver a agenda para
// responder ao cliente; quem recusa escrita de quem não é logística é o
// backend, e a tela só esconde o que não adianta oferecer.
//
// Fuso: as datas vêm como 'YYYY-MM-DD'. O intervalo do período é calculado em
// ISO puro (packages/shared/periodo-agenda.ts) e só vira Date na borda do
// desenho — `new Date('YYYY-MM-DD')` seria UTC e voltaria um dia.

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Info, Truck } from 'lucide-react';
import { filtrarSlotsPorCaminhao } from '@pastobom/shared';
import type { AgendaSlot } from '@pastobom/shared';
import { api } from '../lib/api';
import { EntregaDetalheModal } from '../components/EntregaDetalheModal';
import {
  chaveSlot,
  intervaloParaTela,
  NavegadorPeriodo,
  tituloDoPeriodo,
  VisaoDia,
  VisaoMes,
  VisaoSemana,
} from '../components/agenda';
import type { Visao } from '../components/agenda';
import { addDias, addMeses, hojeLocal, isoDeData } from '../lib/datas';
import { pilulaFiltro } from '../lib/pilula';

export default function Agendamento(): React.ReactElement {
  // Semana é o padrão: é a pergunta que a Natália faz mais ("o que esse
  // caminhão tem essa semana?"). Mês serve para enxergar folga adiante.
  const [visao, setVisao] = useState<Visao>('semana');
  const [ancora, setAncora] = useState<Date>(() => hojeLocal());
  // null = TODOS os caminhões — ver a decisão comentada nas pílulas abaixo.
  const [caminhaoId, setCaminhaoId] = useState<string | null>(null);
  // Viagem cujo detalhe está aberto. A busca é sob demanda, dentro do modal.
  const [detalheId, setDetalheId] = useState<string | null>(null);

  const ancoraIso = isoDeData(ancora);
  const intervalo = useMemo(
    () => intervaloParaTela(visao, ancoraIso),
    [visao, ancoraIso],
  );
  const de = intervalo.inicio;
  const ate = intervalo.fim;

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


  // Previsão do tempo no cartão, igual à página de Agenda. Só nas visões que
  // desenham cartão — ver o comentário lá. Usa `slotsVisiveis`: quem filtrou um
  // caminhão não precisa da previsão dos outros.
  const idsClima = useMemo(() => {
    if (visao === 'mes') return [];
    const ids = new Set<string>();
    for (const slot of slotsVisiveis) {
      for (const e of slot.entregas) ids.add(e.pedidoId);
    }
    return [...ids].slice(0, 200);
  }, [slotsVisiveis, visao]);

  const idsClimaKey = useMemo(
    () => idsClima.slice().sort().join(','),
    [idsClima],
  );

  const climaQuery = useQuery({
    queryKey: ['clima-agenda', idsClimaKey],
    queryFn: ({ signal }) => api.climaLote(idsClima, signal),
    enabled: idsClima.length > 0,
    staleTime: 30 * 60 * 1000,
  });
  const climaPorPedido = climaQuery.data ?? {};

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
  const titulo = tituloDoPeriodo(visao, intervalo, ancoraIso);
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
                className={pilulaFiltro(filtroAtivo === null)}
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
                    className={pilulaFiltro(ativo)}
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
                dias={intervalo.diasData}
                mesAtual={ancora.getMonth()}
                isoHoje={isoHoje}
                porSlot={porSlot}
              />
            )}

            {visao === 'semana' && (
              <VisaoSemana
                dias={intervalo.diasData}
                isoHoje={isoHoje}
                porSlot={porSlot}
                onAbrir={setDetalheId}
                climaPorPedido={climaPorPedido}
              />
            )}

            {visao === 'dia' && (
              <VisaoDia
                data={isoDeData(ancora)}
                porSlot={porSlot}
                onAbrir={setDetalheId}
                climaPorPedido={climaPorPedido}
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
