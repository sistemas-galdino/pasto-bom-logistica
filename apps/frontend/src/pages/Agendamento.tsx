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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  Info,
  Truck,
  X,
} from 'lucide-react';
import {
  expandirRotasCidade,
  filtrarSlotsPorCaminhao,
  reordenacoesPorMotorista,
} from '@pastobom/shared';
import type {
  AgendaEntrega,
  AgendaSlot,
  AtualizarReservaRequest,
  CriarReservaRequest,
} from '@pastobom/shared';
import { api, ApiError } from '../lib/api';
import { AgendarEntregaModal } from '../components/AgendarEntregaModal';
import { EntregaDetalheModal } from '../components/EntregaDetalheModal';
import { ReservaModal } from '../components/ReservaModal';
import { SeletorPedidoPendente } from '../components/SeletorPedidoPendente';
import {
  AcaoRotasCidade,
  chaveSlot,
  indexarRotasPorSlot,
  FaixaVagas,
  intervaloParaTela,
  NavegadorPeriodo,
  tituloDoPeriodo,
  VisaoDia,
  VisaoMes,
  VisaoSemana,
} from '../components/agenda';
import type { AlvoVaga, Visao } from '../components/agenda';
import { useAuth } from '../auth/AuthProvider';
import { invalidarAgendamento } from '../lib/cache';
import { addDias, addMeses, hojeLocal, isoDeData } from '../lib/datas';
import type { PedidoComSaldo } from '../lib/saldo-pedidos';
import { pilulaFiltro } from '../lib/pilula';

function mensagemDeErro(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function Agendamento(): React.ReactElement {
  const { podeEscrever } = useAuth();
  const queryClient = useQueryClient();

  // Semana é o padrão: é a pergunta que a Natália faz mais ("o que esse
  // caminhão tem essa semana?"). Mês serve para enxergar folga adiante.
  const [visao, setVisao] = useState<Visao>('semana');
  const [ancora, setAncora] = useState<Date>(() => hojeLocal());
  // null = TODOS os caminhões — ver a decisão comentada nas pílulas abaixo.
  const [caminhaoId, setCaminhaoId] = useState<string | null>(null);
  // Viagem cujo detalhe está aberto. A busca é sob demanda, dentro do modal.
  const [detalheId, setDetalheId] = useState<string | null>(null);

  // O CAMINHO DA VAGA, em três passos e dois estados:
  //   vaga clicada  -> `vagaEscolhida` abre o seletor de pedidos
  //   pedido escolhido -> `agendando` abre o modal de agendar já preenchido
  // Guardar os dois separados (em vez de um estado com "etapa") deixa o
  // `slotInicial` disponível nos dois passos sem ninguém precisar lembrar de
  // carregá-lo adiante.
  const [vagaEscolhida, setVagaEscolhida] = useState<AlvoVaga | null>(null);
  const [agendando, setAgendando] = useState<
    (PedidoComSaldo & { alvo: AlvoVaga }) | null
  >(null);
  const [erroAgendar, setErroAgendar] = useState<string | null>(null);

  // Reserva aberta pela faixa (E7) ou pelo botão do cabeçalho.
  const [reservando, setReservando] = useState<
    { data: string; caminhaoId?: string } | null
  >(null);
  const [erroReserva, setErroReserva] = useState<string | null>(null);
  // Erro ao gravar a ordem arrastada. Não tem modal onde morar (o arrasto é
  // direto no calendário), então vira um aviso no topo da visão Dia.
  const [erroOrdem, setErroOrdem] = useState<string | null>(null);

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

  const isoHoje = isoDeData(hojeLocal());

  // --- escrever -------------------------------------------------------------
  //
  // As MESMAS rotas e as MESMAS invalidações do Quadro (lib/cache.ts). Esta
  // tela não tem regra própria de agendamento: ela só encurta o caminho até a
  // mesma chamada.

  const agendarMutacao = useMutation({
    mutationFn: (body: Parameters<typeof api.criarEntrega>[0]) =>
      api.criarEntrega(body),
    onSuccess: () => {
      invalidarAgendamento(queryClient);
      setAgendando(null);
      setErroAgendar(null);
    },
    onError: (err) =>
      setErroAgendar(mensagemDeErro(err, 'Falha ao agendar a entrega.')),
  });

  const reservaMutacao = useMutation({
    mutationFn: (body: CriarReservaRequest | AtualizarReservaRequest) =>
      api.criarReserva(body as CriarReservaRequest),
    onSuccess: () => {
      invalidarAgendamento(queryClient);
      setReservando(null);
      setErroReserva(null);
    },
    onError: (err) =>
      setErroReserva(mensagemDeErro(err, 'Falha ao reservar o caminhão.')),
  });

  /**
   * ARRASTAR PARA REORDENAR (Natália, 24/09/2026) — o lado da página.
   *
   * A lista já reordenou na tela antes de isto rodar (otimista, ver
   * ListaEntregasOrdenavel.tsx); aqui só sai a gravação. Um PATCH por
   * motorista cuja ordem relativa mudou — a ordem é do MOTORISTA no dia, e o
   * servidor permuta as paradas enviadas no lugar, sem tocar nas outras dele.
   *
   * Rejeitar a promessa é o que faz a lista desfazer o override; por isso o
   * `throw` depois de registrar o erro.
   */
  const reordenarMutacao = useMutation({
    mutationFn: async ({
      data,
      antes,
      depois,
    }: {
      data: string;
      antes: AgendaEntrega[];
      depois: AgendaEntrega[];
    }) => {
      const chamadas = reordenacoesPorMotorista(antes, depois);
      if (chamadas.length === 0) {
        // Só acontece quando o grupo tem dois motoristas e o card de um passou
        // por cima do card do outro: a sequência de CADA motorista continua a
        // mesma, então não há o que gravar. Deixar o card no lugar novo seria
        // mentir — no próximo refetch ele voltaria sozinho.
        throw new Error(
          'Esses cards são de motoristas diferentes, e a ordem de cada motorista não mudou — nada foi gravado. A ordem é do motorista, não do caminhão.',
        );
      }
      // Em paralelo: motoristas diferentes não disputam a mesma rota.
      await Promise.all(
        chamadas.map((c) =>
          api.reordenarParadas({
            motoristaId: c.motoristaId,
            data,
            ordem: c.ordem,
          }),
        ),
      );
    },
    onSuccess: () => {
      setErroOrdem(null);
      invalidarAgendamento(queryClient);
    },
    onError: (err) => {
      setErroOrdem(mensagemDeErro(err, 'Falha ao gravar a ordem das paradas.'));
      // Com dois motoristas, um PATCH pode ter gravado e o outro não: o
      // refetch mostra o que ficou de verdade, em vez de a tela adivinhar.
      invalidarAgendamento(queryClient);
    },
  });

  async function reordenar(args: {
    data: string;
    antes: AgendaEntrega[];
    depois: AgendaEntrega[];
  }): Promise<void> {
    setErroOrdem(null);
    await reordenarMutacao.mutateAsync(args);
  }

  const nomeDoCaminhao = (id: string): string =>
    caminhoes.find((c) => c.id === id)?.nome || 'Caminhão';

  // Memorizado porque a FaixaVagas recalcula as vagas quando a lista muda de
  // identidade — e um `.filter()` no meio do JSX cria um array novo por render,
  // sete vezes por semana desenhada.
  const caminhoesDaFaixa = useMemo(
    () =>
      filtroAtivo === null
        ? caminhoes
        : caminhoes.filter((c) => c.id === filtroAtivo),
    [caminhoes, filtroAtivo],
  );

  /**
   * A faixa de vagas de um dia.
   *
   * Os SLOTS COMPLETOS, nunca `slotsVisiveis`: `filtrarSlotsPorCaminhao`
   * descarta o slot sem entrega e sem reserva daquele caminhão, e o dia mais
   * livre — o que tem TODAS as vagas — é justamente o que sumiria. Já a FROTA
   * respeita o filtro: quem escolheu um caminhão está perguntando dele.
   *
   * `onAgendar` só existe para quem escreve. Sem ele a faixa vira texto, e é o
   * que o vendedor e o almoxarifado veem.
   *
   * Em "Todos os caminhões" a faixa NÃO aparece. Pedido da Natália, 24/09/2026:
   * seis caminhões × sete dias davam 42 pílulas "sem teto" empilhadas acima do
   * calendário — "a gente achou confuso… a gente só quer aqui [a agenda]". As
   * vagas voltam ao escolher um caminhão, que é quando a pergunta "cabe mais
   * uma?" tem sujeito.
   */
  function renderVagas(dataIso: string, variante: 'compacta' | 'completa') {
    if (filtroAtivo === null) return null;
    return (
      <FaixaVagas
        data={dataIso}
        slots={slots}
        limites={agendaQuery.data?.limites ?? []}
        caminhoes={caminhoesDaFaixa}
        variante={variante}
        // Passado não recebe convite: ninguém agenda para trás, e a pílula ali
        // só produziria um 422 (ou, pior, uma viagem marcada para ontem).
        somenteLeitura={dataIso < isoHoje}
        onAgendar={
          podeEscrever
            ? (alvo) => {
                setErroAgendar(null);
                setVagaEscolhida(alvo);
              }
            : undefined
        }
        onReservar={
          podeEscrever
            ? (alvo) => {
                setErroReserva(null);
                setReservando(alvo);
              }
            : undefined
        }
      />
    );
  }

  const porSlot = useMemo(() => {
    const mapa = new Map<string, AgendaSlot>();
    for (const slot of slotsVisiveis) {
      mapa.set(chaveSlot(slot.data, slot.periodo), slot);
    }
    return mapa;
  }, [slotsVisiveis]);

  /**
   * ROTAS DE CIDADE do período mostrado.
   *
   * As configurações vêm CRUAS no payload da agenda (campo irmão de `slots` —
   * ver o tipo) e quem as expande em ocorrências é a regra pura, com a borda
   * de vigência inclusiva escrita num lugar só.
   */
  const rotasPorSlot = useMemo(
    () =>
      indexarRotasPorSlot(
        expandirRotasCidade(agendaQuery.data?.rotas ?? [], de, ate),
      ),
    [agendaQuery.data, de, ate],
  );

  /**
   * Cidades vistas nesta janela, para o autocomplete do cadastro de rota.
   *
   * Sem requisição nova: a agenda já devolve a cidade de cada entrega. `GET
   * /api/cidades` fica recusado por ora — a fonte seria o espelho do Órix, que
   * já tem as três grafias misturadas.
   */
  const cidadesSugeridas = useMemo(() => {
    const vistas = new Set<string>();
    for (const slot of agendaQuery.data?.slots ?? []) {
      for (const e of slot.entregas) {
        const c = e.cidade.trim();
        if (c !== '') vistas.add(c);
      }
    }
    return [...vistas];
  }, [agendaQuery.data]);

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
              {/* RESERVAR fica aqui e TAMBÉM continua no Quadro. Ela disse "se
                  você quiser tirar ele daqui e deixar ele só lá também pode, aí
                  fica critério" — isso não é pedido de remoção, e tirar um botão
                  que a equipe usa hoje seria regressão com ganho zero. O atalho
                  bom é o da faixa de vagas, que já sabe o dia e o caminhão; este
                  aqui é para quem chegou sem nenhum dos dois. */}
              <span className="ml-auto flex items-center gap-2">
                <AcaoRotasCidade cidadesSugeridas={cidadesSugeridas} />
                {podeEscrever && (
                  <button
                    type="button"
                    onClick={() => {
                      setErroReserva(null);
                      setReservando({ data: ancoraIso });
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    Reservar caminhão
                  </button>
                )}
              </span>
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

            {/* A ROTA DE CIDADE NÃO ENTRA NESTA CONTA, e isto não é
                esquecimento: uma semana que só tem rota realmente não tem
                entrega agendada. A frase é verdadeira, e o chip aparece logo
                abaixo dizendo o que aquele dia tem. Não "conserte" isto
                somando as rotas — passaria a dizer que há entrega onde não há.
            */}
            {/* Sem a faixa, o "+" da vaga some — e ele é a porta de entrada do
                agendamento nesta tela. A linha diz para onde ela foi. */}
            {filtroAtivo === null && podeEscrever && (
              <p className="flex items-start gap-2 text-xs text-tinta-suave">
                <Truck
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pedra"
                  aria-hidden="true"
                />
                Escolha um caminhão acima para ver as vagas e agendar.
              </p>
            )}

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
                rotasPorSlot={rotasPorSlot}
                dias={intervalo.diasData}
                mesAtual={ancora.getMonth()}
                isoHoje={isoHoje}
                porSlot={porSlot}
              />
            )}

            {visao === 'semana' && (
              <VisaoSemana
                rotasPorSlot={rotasPorSlot}
                dias={intervalo.diasData}
                isoHoje={isoHoje}
                porSlot={porSlot}
                onAbrir={setDetalheId}
                climaPorPedido={climaPorPedido}
                renderVagas={(iso) => renderVagas(iso, 'compacta')}
              />
            )}

            {visao === 'dia' && (
              <>
                {/* A faixa entra como IRMÃ dos dois períodos, e não dentro da
                    VisaoDia: a vaga é do DIA (o teto da 0020 é diário), e
                    desenhá-la dentro de cada período diria que cabem N de manhã
                    E N à tarde. */}
                {renderVagas(ancoraIso, 'completa')}
                {erroOrdem !== null && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-sm text-terra-escuro"
                  >
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <p className="min-w-0 flex-1">
                      Não foi possível mudar a ordem das paradas: {erroOrdem}
                    </p>
                    <button
                      type="button"
                      onClick={() => setErroOrdem(null)}
                      aria-label="Fechar aviso"
                      className="shrink-0 rounded p-0.5 hover:bg-terra/10"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
                {/* O arrasto só aqui, e só para a logística: ver o porquê em
                    VisaoDia e em ListaEntregasOrdenavel. Sem `podeEscrever` a
                    prop nem desce, e o dia fica igual ao da /agenda. */}
                <VisaoDia
                  rotasPorSlot={rotasPorSlot}
                  data={ancoraIso}
                  porSlot={porSlot}
                  onAbrir={setDetalheId}
                  climaPorPedido={climaPorPedido}
                  onReordenar={podeEscrever ? reordenar : undefined}
                />
              </>
            )}
          </div>
        )}
      </main>

      {detalheId !== null && (
        <EntregaDetalheModal
          entregaId={detalheId}
          onFechar={() => setDetalheId(null)}
          // As ações do card (entregue, não realizado, voltar…) moram só aqui:
          // é a tela de trabalho. A /agenda continua somente leitura.
          comAcoes={podeEscrever}
        />
      )}

      {/* Passo 2 do caminho da vaga: QUAL pedido vai nesta viagem. */}
      {vagaEscolhida !== null && (
        <SeletorPedidoPendente
          data={vagaEscolhida.data}
          periodo={vagaEscolhida.periodo}
          nomeCaminhao={nomeDoCaminhao(vagaEscolhida.caminhaoId)}
          onFechar={() => setVagaEscolhida(null)}
          onEscolher={(escolhido) => {
            setAgendando({ ...escolhido, alvo: vagaEscolhida });
            setVagaEscolhida(null);
          }}
        />
      )}

      {/* Passo 3: o MESMO modal do Quadro, já com data, período e caminhão. */}
      {agendando !== null && (
        <AgendarEntregaModal
          pedido={agendando.pedido}
          saldo={agendando.saldo}
          slotInicial={agendando.alvo}
          enviando={agendarMutacao.isPending}
          erro={erroAgendar}
          onCancelar={() => {
            if (!agendarMutacao.isPending) {
              setAgendando(null);
              setErroAgendar(null);
            }
          }}
          onConfirmar={(dados) =>
            agendarMutacao.mutate({ pedidoId: agendando.pedido.id, ...dados })
          }
        />
      )}

      {reservando !== null && (
        <ReservaModal
          slotInicial={
            reservando.caminhaoId
              ? {
                  data: reservando.data,
                  periodo: 'manha',
                  caminhaoId: reservando.caminhaoId,
                }
              : { data: reservando.data, periodo: 'manha' }
          }
          enviando={reservaMutacao.isPending}
          erro={erroReserva}
          onFechar={() => {
            if (!reservaMutacao.isPending) {
              setReservando(null);
              setErroReserva(null);
            }
          }}
          onConfirmar={(body) => reservaMutacao.mutate(body)}
        />
      )}
    </div>
  );
}
