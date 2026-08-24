// Página principal: QUADRO — Onda 2.
//
// O quadro mistura DOIS objetos, e essa é a mudança central do modelo:
//
//   Pendente ................ PEDIDOS com saldo ("restam 80 de 180")
//   Agendada / Em rota /
//   Entregue / Não realizado  ENTREGAS (cada viagem é um cartão)
//
// Assim um pedido grande pode ter três caminhões saindo no mesmo dia — três
// cartões em rota — e ainda mostrar o que sobrou na coluna Pendente. No modelo
// antigo, um pedido era um cartão só e nada disso cabia.
//
// SALDO CALCULADO NO CLIENTE. Usamos a MESMA função do backend
// (calcularSaldo, de @pastobom/shared) sobre os pedidos e as entregas já
// carregados. Isso evita uma chamada por pedido e, mais importante, garante que
// tela e servidor não possam discordar sobre quanto falta entregar.
//
// JANELAS DE EXIBIÇÃO. As colunas de desfecho são listas de trabalho, não
// arquivo: 'não realizado' mostra os últimos 7 dias e 'entregue' os últimos 30.
// O corte é só VISUAL — o saldo é calculado sobre TODAS as entregas, senão uma
// viagem antiga sumiria da conta e o pedido reapareceria com saldo que não tem.

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AtualizarReservaRequest,
  CriarReservaRequest,
  Entrega,
  Pedido,
  Reserva,
  StatusEntrega,
} from '@pastobom/shared';
import { api, ApiError } from '../lib/api';
import {
  agruparEntregasPorPedido,
  isoMenosDias,
  pedidosComSaldo,
  type PedidoComSaldo,
} from '../lib/saldo-pedidos';
import { formatarData } from '../lib/format';
import { useAuth } from '../auth/AuthProvider';
import { EntregaCard } from '../components/EntregaCard';
import { PedidoCard } from '../components/PedidoCard';
import { AgendarEntregaModal } from '../components/AgendarEntregaModal';
import { ConfirmacaoModal } from '../components/ConfirmacaoModal';
import { SeparacaoModal } from '../components/SeparacaoModal';
import { ReagendarEntregaModal } from '../components/ReagendarEntregaModal';
import { NaoRealizadoModal } from '../components/NaoRealizadoModal';
import { ReservaCard } from '../components/ReservaCard';
import { ReservaModal } from '../components/ReservaModal';
import {
  COLUNAS_ENTREGA,
  STATUS_ENTREGA_META,
  STATUS_META,
  STATUS_ORIX_META,
} from '../components/status';

const STATUS_ORIX_OPCOES = STATUS_ORIX_META;

/** Dias mostrados nas colunas de desfecho (só exibição; ver topo do arquivo). */
const DIAS_NAO_REALIZADO = 7;
const DIAS_ENTREGUE = 30;

/** Transição de entrega aguardando confirmação. */
interface AlvoEntrega {
  entrega: Entrega;
  para: StatusEntrega;
  /** true quando é uma reversão (volta uma etapa), não um avanço. */
  reversao?: boolean;
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
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function Board(): React.ReactElement {
  const { podeEscrever, podeSeparar } = useAuth();
  const queryClient = useQueryClient();

  const [verCancelados, setVerCancelados] = useState(false);

  // Agendamento (pedido -> nova entrega)
  const [agendando, setAgendando] = useState<PedidoComSaldo | null>(null);
  const [erroAgendar, setErroAgendar] = useState<string | null>(null);

  // Transições de entrega (confirmação simples)
  const [alvoEntrega, setAlvoEntrega] = useState<AlvoEntrega | null>(null);
  const [erroEntrega, setErroEntrega] = useState<string | null>(null);
  const [reagendando, setReagendando] = useState<Entrega | null>(null);
  const [erroReagendar, setErroReagendar] = useState<string | null>(null);

  // Descarte/restauração do pedido
  const [alvoPedido, setAlvoPedido] = useState<{
    pedido: Pedido;
    descartar: boolean;
  } | null>(null);
  const [erroPedido, setErroPedido] = useState<string | null>(null);

  const [separandoId, setSeparandoId] = useState<string | null>(null);
  const [erroSeparacao, setErroSeparacao] = useState<string | null>(null);

  const [alvoNaoRealizado, setAlvoNaoRealizado] = useState<Entrega | null>(null);
  const [erroNaoRealizado, setErroNaoRealizado] = useState<string | null>(null);

  // Reserva de caminhão (o card avulso). `undefined` = modal fechado; `null` =
  // aberto para uma reserva NOVA; um objeto = aberto em edição. Sem essa
  // distinção o mesmo estado não conseguiria dizer "abrir vazio".
  const [reservaEdicao, setReservaEdicao] = useState<Reserva | null | undefined>(
    undefined,
  );
  const [erroReserva, setErroReserva] = useState<string | null>(null);
  const [cancelandoReserva, setCancelandoReserva] = useState<Reserva | null>(
    null,
  );
  const [erroCancelarReserva, setErroCancelarReserva] = useState<string | null>(
    null,
  );

  // Filtros server-side (período de ENTRADA + status do Órix) e busca local.
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [statusOrix, setStatusOrix] = useState<string[]>([]);
  const [busca, setBusca] = useState('');

  // Filtro por DATA DA ENTREGA (entregas.data_agendada). Fica FORA do `filtros`
  // abaixo de propósito: aquele objeto é a queryKey dos pedidos, e este filtro
  // não vai ao servidor. Ver o comentário em entregasPorStatus.
  const [entregaDe, setEntregaDe] = useState('');
  const [entregaAte, setEntregaAte] = useState('');

  const filtros = useMemo(() => {
    const f: { de?: string; ate?: string; statusOrix?: string[] } = {};
    if (de) f.de = de;
    if (ate) f.ate = ate;
    if (statusOrix.length > 0) f.statusOrix = statusOrix;
    return f;
  }, [de, ate, statusOrix]);

  const pedidosQuery = useQuery({
    queryKey: ['pedidos', filtros],
    queryFn: ({ signal }) =>
      api.listarPedidos(['pendente', 'entregue', 'cancelada'], signal, filtros),
    refetchInterval: 60_000,
  });

  // TODAS as entregas: o saldo depende de todas elas (ver topo do arquivo).
  const entregasQuery = useQuery({
    queryKey: ['entregas'],
    queryFn: ({ signal }) => api.listarEntregas({}, signal),
    refetchInterval: 60_000,
  });

  /**
   * Janela das reservas mostradas na faixa.
   *
   * Segue o filtro de DATA DA ENTREGA: quem recorta o quadro para "o que sai
   * hoje" espera que a reserva do mesmo dia venha junto. Sem filtro, de hoje em
   * diante — reserva da semana passada não é trabalho a fazer, e a faixa existe
   * para o dia à frente não parecer vago.
   */
  const filtroReservas = useMemo(() => {
    const f: { de?: string; ate?: string } = {};
    f.de = entregaDe !== '' ? entregaDe : isoMenosDias(0);
    if (entregaAte !== '') f.ate = entregaAte;
    return f;
  }, [entregaDe, entregaAte]);

  // Só as ATIVAS: é o padrão da rota. Reserva cancelada não ocupa caminhão e
  // não tem por que voltar ao quadro.
  const reservasQuery = useQuery({
    queryKey: ['reservas', filtroReservas],
    queryFn: ({ signal }) => api.listarReservas(filtroReservas, signal),
    refetchInterval: 60_000,
  });

  function invalidarTudo(): void {
    void queryClient.invalidateQueries({ queryKey: ['pedidos'] });
    void queryClient.invalidateQueries({ queryKey: ['entregas'] });
    void queryClient.invalidateQueries({ queryKey: ['agenda'] });
    // A reserva ocupa (ou libera) o caminhão, e é isso que a agenda e as
    // entregas mostram como capacidade — as três precisam cair juntas.
    void queryClient.invalidateQueries({ queryKey: ['reservas'] });
  }

  // --- mutações -------------------------------------------------------------

  const agendarMutacao = useMutation({
    mutationFn: (body: Parameters<typeof api.criarEntrega>[0]) =>
      api.criarEntrega(body),
    onSuccess: () => {
      invalidarTudo();
      setAgendando(null);
      setErroAgendar(null);
    },
    onError: (err) =>
      setErroAgendar(mensagemDeErro(err, 'Falha ao agendar a entrega.')),
  });

  const entregaMutacao = useMutation({
    mutationFn: ({ id, para, reversao }: { id: string; para: StatusEntrega; reversao?: boolean }) =>
      reversao
        ? api.reverterEntrega(id, para)
        : api.transicionarEntrega(id, { para }),
    onSuccess: () => {
      invalidarTudo();
      setAlvoEntrega(null);
      setErroEntrega(null);
    },
    onError: (err) =>
      setErroEntrega(mensagemDeErro(err, 'Falha ao atualizar a entrega.')),
  });

  const reagendarMutacao = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Parameters<typeof api.reagendarEntrega>[1];
    }) => api.reagendarEntrega(id, body),
    onSuccess: () => {
      invalidarTudo();
      setReagendando(null);
      setErroReagendar(null);
    },
    onError: (err) =>
      setErroReagendar(mensagemDeErro(err, 'Falha ao reagendar a entrega.')),
  });

  const pedidoMutacao = useMutation({
    mutationFn: ({ id, descartar }: { id: string; descartar: boolean }) =>
      descartar
        ? api.transicionar(id, { para: 'cancelada' })
        : api.reverter(id, 'pendente'),
    onSuccess: () => {
      invalidarTudo();
      setAlvoPedido(null);
      setErroPedido(null);
    },
    onError: (err) =>
      setErroPedido(mensagemDeErro(err, 'Falha ao atualizar o pedido.')),
  });

  const separacaoMutacao = useMutation({
    mutationFn: ({
      entregaId,
      itemId,
      separado,
    }: {
      entregaId: string;
      itemId: string;
      separado: boolean;
    }) => api.definirSeparacaoItemEntrega(entregaId, itemId, separado),
    onSuccess: () => {
      invalidarTudo();
      setErroSeparacao(null);
    },
    onError: (err) =>
      setErroSeparacao(mensagemDeErro(err, 'Falha ao atualizar a separação.')),
  });

  const naoRealizadoMutacao = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      api.transicionarEntrega(id, { para: 'nao_realizado', motivo }),
    onSuccess: () => {
      invalidarTudo();
      setAlvoNaoRealizado(null);
      setErroNaoRealizado(null);
    },
    onError: (err) =>
      setErroNaoRealizado(
        mensagemDeErro(err, 'Falha ao marcar a entrega como não realizada.'),
      ),
  });

  const reservaMutacao = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      /** Ausente = criar. */
      id?: string;
      body: CriarReservaRequest | AtualizarReservaRequest;
    }) =>
      id === undefined
        ? api.criarReserva(body as CriarReservaRequest)
        : api.atualizarReserva(id, body),
    onSuccess: () => {
      invalidarTudo();
      setReservaEdicao(undefined);
      setErroReserva(null);
    },
    onError: (err) =>
      setErroReserva(mensagemDeErro(err, 'Falha ao salvar a reserva.')),
  });

  const cancelarReservaMutacao = useMutation({
    mutationFn: (id: string) => api.cancelarReserva(id),
    onSuccess: () => {
      invalidarTudo();
      setCancelandoReserva(null);
      setErroCancelarReserva(null);
    },
    onError: (err) =>
      setErroCancelarReserva(
        mensagemDeErro(err, 'Falha ao cancelar a reserva.'),
      ),
  });

  // --- dados derivados ------------------------------------------------------

  const pedidos = useMemo(() => pedidosQuery.data ?? [], [pedidosQuery.data]);
  const entregas = useMemo(() => entregasQuery.data ?? [], [entregasQuery.data]);

  /** Entregas agrupadas por pedido — insumo do cálculo de saldo. */
  const entregasPorPedido = useMemo(
    () => agruparEntregasPorPedido(entregas),
    [entregas],
  );

  /** Pedidos que ainda têm o que entregar, com o saldo já calculado. */
  const pendentesComSaldo = useMemo<PedidoComSaldo[]>(
    () => pedidosComSaldo(pedidos, entregasPorPedido),
    [pedidos, entregasPorPedido],
  );

  // --- busca ----------------------------------------------------------------

  const termo = normalizar(busca.trim());

  const casaPedido = useMemo(
    () =>
      (p: Pedido): boolean => {
        if (termo === '') return true;
        const campos = [p.clienteNome, p.orixNumero, p.cidadeCliente, p.bairro ?? ''];
        if (campos.some((c) => normalizar(c ?? '').includes(termo))) return true;
        return p.itens.some(
          (i) =>
            normalizar(i.produtoCodigo).includes(termo) ||
            normalizar(i.nomeProduto).includes(termo),
        );
      },
    [termo],
  );

  const casaEntrega = useMemo(
    () =>
      (e: Entrega): boolean => {
        if (termo === '') return true;
        const campos = [e.clienteNome, e.orixNumero, e.cidadeCliente, e.bairro ?? ''];
        if (campos.some((c) => normalizar(c ?? '').includes(termo))) return true;
        return e.itens.some(
          (i) =>
            normalizar(i.produtoCodigo).includes(termo) ||
            normalizar(i.nomeProduto).includes(termo),
        );
      },
    [termo],
  );

  const pendentesVisiveis = useMemo(
    () => pendentesComSaldo.filter((x) => casaPedido(x.pedido)),
    [pendentesComSaldo, casaPedido],
  );

  /**
   * Entregas por coluna, já com a janela de exibição das colunas de desfecho.
   *
   * O filtro por data da entrega é aplicado AQUI, na exibição, e não na query.
   * Duas razões: a query ['entregas'] sem filtro alimenta o saldo da coluna
   * Pendente (ver o topo do arquivo) — recortá-la no servidor faria o saldo
   * mentir; e essa queryKey é compartilhada com o Dashboard, que passaria a
   * discordar do quadro sobre o universo de viagens.
   *
   * Quando o filtro está ativo, ele MANDA e as janelas de 7/30 dias saem de
   * cena: quem escolhe "01/03 a 31/03" e recebe zero na coluna Entregue não tem
   * como adivinhar que havia um corte de 30 dias por cima.
   */
  const entregasPorStatus = useMemo(() => {
    const janelaAtiva = entregaDe === '' && entregaAte === '';
    const corteNaoRealizado = isoMenosDias(DIAS_NAO_REALIZADO);
    const corteEntregue = isoMenosDias(DIAS_ENTREGUE);

    const mapa: Record<StatusEntrega, Entrega[]> = {
      agendada: [],
      em_rota: [],
      entregue: [],
      nao_realizado: [],
      cancelada: [],
    };

    for (const e of entregas) {
      if (!casaEntrega(e)) continue;
      if (entregaDe && e.dataAgendada < entregaDe) continue;
      if (entregaAte && e.dataAgendada > entregaAte) continue;
      if (janelaAtiva) {
        if (e.status === 'nao_realizado' && e.dataAgendada < corteNaoRealizado) {
          continue;
        }
        if (e.status === 'entregue' && e.dataAgendada < corteEntregue) continue;
      }
      mapa[e.status].push(e);
    }

    // Mais antigo primeiro: é a ordem de trabalho pedida na reunião.
    for (const lista of Object.values(mapa)) {
      lista.sort((a, b) => a.dataAgendada.localeCompare(b.dataAgendada));
    }
    return mapa;
  }, [entregas, casaEntrega, entregaDe, entregaAte]);

  const cancelados = useMemo(
    () =>
      pedidos.filter((p) => p.statusLogistico === 'cancelada' && casaPedido(p)),
    [pedidos, casaPedido],
  );

  /**
   * Reservas da faixa, obedecendo a MESMA busca dos cards.
   *
   * Quem digita "oficina" espera achar a reserva; quem digita o nome de um
   * cliente não espera ver reserva nenhuma. Deixar a faixa fora da busca faria
   * o quadro filtrado mostrar cartões que não casam com o termo.
   */
  const reservasVisiveis = useMemo(() => {
    const lista = reservasQuery.data ?? [];
    if (termo === '') return lista;
    return lista.filter((r) =>
      [
        r.servico,
        r.fornecedorNome ?? '',
        r.cidade ?? '',
        r.produtos ?? '',
        r.caminhaoNome ?? '',
        r.motoristaNome ?? '',
      ].some((c) => normalizar(c).includes(termo)),
    );
  }, [reservasQuery.data, termo]);

  const entregaSeparacao = useMemo(
    () => entregas.find((e) => e.id === separandoId) ?? null,
    [entregas, separandoId],
  );

  const totalNoFluxo =
    pendentesVisiveis.length +
    COLUNAS_ENTREGA.reduce((s, st) => s + entregasPorStatus[st].length, 0);

  const carregando = pedidosQuery.isLoading || entregasQuery.isLoading;
  const erroCarregar = pedidosQuery.error ?? entregasQuery.error;

  // --- ações ----------------------------------------------------------------

  function abrirAgendamento(pedido: Pedido): void {
    const alvo = pendentesComSaldo.find((x) => x.pedido.id === pedido.id);
    if (!alvo) return;
    setErroAgendar(null);
    setAgendando(alvo);
  }

  function abrirTransicaoEntrega(entrega: Entrega, para: StatusEntrega): void {
    setErroEntrega(null);
    setAlvoEntrega({ entrega, para });
  }

  function abrirReversaoEntrega(entrega: Entrega, para: StatusEntrega): void {
    setErroEntrega(null);
    setAlvoEntrega({ entrega, para, reversao: true });
  }

  function alternarStatusOrix(codigo: string): void {
    setStatusOrix((atual) =>
      STATUS_ORIX_OPCOES.map((o) => o.codigo).filter((c) =>
        c === codigo ? !atual.includes(c) : atual.includes(c),
      ),
    );
  }

  function limparFiltros(): void {
    setDe('');
    setAte('');
    setStatusOrix([]);
    setBusca('');
    setEntregaDe('');
    setEntregaAte('');
  }

  const temFiltros =
    de !== '' ||
    ate !== '' ||
    entregaDe !== '' ||
    entregaAte !== '' ||
    statusOrix.length > 0 ||
    busca.trim() !== '';

  /**
   * Rótulo da janela de uma coluna, para o cabeçalho não mentir.
   *
   * Com filtro de data da entrega ativo, ele manda e a janela padrão sai de
   * cena (ver entregasPorStatus). Sem filtro e sem janela padrão — as colunas
   * Agendada e Em rota — não há nada a dizer.
   */
  function notaJanela(diasPadrao?: number): string | undefined {
    if (entregaDe === '' && entregaAte === '') {
      return diasPadrao === undefined ? undefined : `últimos ${diasPadrao} dias`;
    }
    if (entregaDe && entregaAte) {
      return `${formatarData(entregaDe)} – ${formatarData(entregaAte)}`;
    }
    if (entregaDe) return `de ${formatarData(entregaDe)}`;
    return `até ${formatarData(entregaAte)}`;
  }

  const abaCls = (ativo: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
      ativo
        ? 'bg-mata text-creme-50 shadow-sm'
        : 'border border-linha bg-papel text-tinta-suave hover:border-mata/30 hover:text-mata'
    }`;

  const campoCls =
    'rounded-lg border border-linha bg-papel px-2 py-1 text-xs text-tinta outline-none transition focus:border-mata/40';

  /** Texto do modal de confirmação conforme a transição escolhida. */
  function textoConfirmacao(alvo: AlvoEntrega): {
    titulo: string;
    descricao: string;
    rotulo: string;
    perigo: boolean;
  } {
    if (alvo.reversao) {
      return {
        titulo: 'Voltar a entrega para agendada',
        descricao:
          'Desfaz o despacho. A carga continua reservada para este caminhão e a viagem volta para a fila de saída.',
        rotulo: 'Voltar',
        perigo: false,
      };
    }
    if (alvo.para === 'cancelada') {
      return {
        titulo: 'Desfazer o agendamento',
        descricao:
          'A carga volta para a fila do pedido e a vaga de peso deste caminhão é liberada. O cliente não é avisado.',
        rotulo: 'Desfazer',
        perigo: true,
      };
    }
    if (alvo.para === 'em_rota') {
      return {
        titulo: 'Pôr em rota',
        descricao:
          'O cliente recebe a mensagem de que o pedido saiu para entrega.',
        rotulo: 'Pôr em rota',
        perigo: false,
      };
    }
    return {
      titulo: 'Marcar como entregue',
      descricao:
        'Se ainda sobrar mercadoria no pedido, o restante volta para a coluna Pendente para ser agendado depois.',
      rotulo: 'Marcar entregue',
      perigo: false,
    };
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-linha bg-creme-50/70 px-4 py-2.5 backdrop-blur sm:px-6">
        <div className="flex items-baseline gap-2 text-sm">
          <h2 className="font-display text-base font-semibold text-mata-escuro">
            Quadro de expedição
          </h2>
          <span className="text-pedra">·</span>
          <span className="text-tinta-suave">
            {verCancelados
              ? `${cancelados.length} descartados`
              : `${totalNoFluxo} no fluxo`}
          </span>
          {(pedidosQuery.isFetching || entregasQuery.isFetching) && (
            <span className="text-xs text-pedra">atualizando…</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Reservar caminhão fica JUNTO das abas, e não dentro de uma coluna:
              a reserva não pertence a nenhuma etapa do fluxo — ela é o caminhão
              tomado por outra coisa. */}
          {podeEscrever && (
            <button
              type="button"
              onClick={() => {
                setErroReserva(null);
                setReservaEdicao(null);
              }}
              title="Ocupa o caminhão com algo que não é entrega: oficina, buscar mercadoria, outro serviço."
              className="rounded-lg border border-dashed border-pedra bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/40 hover:text-mata"
            >
              + Reservar caminhão
            </button>
          )}
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
            Descartados ({cancelados.length})
          </button>
        </div>
      </div>

      {/* Filtros: período de entrada + status do Órix (servidor) e busca (local). */}
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3 border-b border-linha bg-papel/70 px-4 py-3 sm:px-6">
        <div className="flex min-w-[240px] flex-1 flex-col">
          <label htmlFor="busca-pedidos" className="sr-only">
            Buscar
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
            Entrada do pedido (cadastro)
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
          {/* Dois pares de data lado a lado sem dizer o que cada um recorta é
              convite a erro — daí os dois hints. */}
          <span className="mt-1 text-[10px] text-pedra">
            filtra a coluna Pendente
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-pedra">
            Data da entrega
          </span>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-tinta-suave">
            <label htmlFor="filtro-entrega-de" className="sr-only">
              Data da entrega — de
            </label>
            <input
              id="filtro-entrega-de"
              type="date"
              value={entregaDe}
              max={entregaAte || undefined}
              onChange={(e) => setEntregaDe(e.target.value)}
              className={campoCls}
            />
            <span className="text-pedra">até</span>
            <label htmlFor="filtro-entrega-ate" className="sr-only">
              Data da entrega — até
            </label>
            <input
              id="filtro-entrega-ate"
              type="date"
              value={entregaAte}
              min={entregaDe || undefined}
              onChange={(e) => setEntregaAte(e.target.value)}
              className={campoCls}
            />
            {/* O uso real do Johnny é "o que sai hoje" e "o que sai amanhã". */}
            <button
              type="button"
              onClick={() => {
                const hoje = isoMenosDias(0);
                setEntregaDe(hoje);
                setEntregaAte(hoje);
              }}
              className="rounded-lg border border-linha bg-papel px-2 py-1 text-[11px] font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => {
                // isoMenosDias(-1) = hoje + 1 dia.
                const amanha = isoMenosDias(-1);
                setEntregaDe(amanha);
                setEntregaAte(amanha);
              }}
              className="rounded-lg border border-linha bg-papel px-2 py-1 text-[11px] font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
            >
              Amanhã
            </button>
          </div>
          <span className="mt-1 text-[10px] text-pedra">
            filtra as colunas de viagem
          </span>
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
        {carregando ? (
          <div className="flex h-full items-center justify-center text-sm text-tinta-suave">
            Carregando…
          </div>
        ) : erroCarregar ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-tinta-suave">
            <p>
              {erroCarregar instanceof Error
                ? erroCarregar.message
                : 'Não foi possível carregar o quadro.'}
            </p>
            <button
              type="button"
              onClick={() => {
                void pedidosQuery.refetch();
                void entregasQuery.refetch();
              }}
              className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave hover:border-mata/30 hover:text-mata"
            >
              Tentar novamente
            </button>
          </div>
        ) : verCancelados ? (
          <div className="scroll-suave h-full overflow-y-auto p-4 sm:p-6">
            {cancelados.length === 0 ? (
              <p className="text-center text-sm text-pedra">
                {temFiltros
                  ? 'Nenhum pedido descartado com esses filtros.'
                  : 'Nenhum pedido descartado.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {cancelados.map((p) => (
                  <PedidoCard
                    key={p.id}
                    pedido={p}
                    podeEscrever={podeEscrever}
                    onAgendar={abrirAgendamento}
                    onDescartar={(pedido) => {
                      setErroPedido(null);
                      setAlvoPedido({ pedido, descartar: true });
                    }}
                    onRestaurar={(pedido) => {
                      setErroPedido(null);
                      setAlvoPedido({ pedido, descartar: false });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {/* FAIXA DE RESERVAS, acima das colunas.

                Por que fora das colunas, e não dentro de "Agendada": a `Coluna`
                se esvazia por `quantidade` (quantidade === 0 vira "Nada aqui."
                em lugar dos children), então uma reserva posta ali desapareceria
                em todo dia sem nenhuma entrega — justamente o dia que o Johnny
                quer ver ocupado. E é mais honesto: reserva não é entrega, não
                caminha pelo fluxo.

                A faixa só existe quando há reserva: uma faixa vazia permanente
                só roubaria altura das colunas. */}
            {reservasVisiveis.length > 0 && (
              <section className="border-b border-linha bg-creme-50/40 px-4 py-3 sm:px-6">
                <div className="flex items-baseline gap-2">
                  <h3 className="font-display text-sm font-semibold text-mata-escuro">
                    Caminhão reservado
                  </h3>
                  <span className="text-[11px] text-pedra">
                    {reservasVisiveis.length === 1
                      ? '1 reserva'
                      : `${reservasVisiveis.length} reservas`}{' '}
                    · não é entrega a cliente
                  </span>
                </div>
                <div className="scroll-suave mt-2 flex gap-3 overflow-x-auto pb-1">
                  {reservasVisiveis.map((r) => (
                    <ReservaCard
                      key={r.id}
                      reserva={r}
                      podeEscrever={podeEscrever}
                      onEditar={(reserva) => {
                        setErroReserva(null);
                        setReservaEdicao(reserva);
                      }}
                      onCancelar={(reserva) => {
                        setErroCancelarReserva(null);
                        setCancelandoReserva(reserva);
                      }}
                    />
                  ))}
                </div>
              </section>
            )}

            <div className="scroll-suave flex min-h-0 flex-1 gap-3 overflow-x-auto p-4 sm:p-6">
              {/* Coluna PENDENTE: pedidos com saldo. */}
            <Coluna
              rotulo="Pendente"
              faixa={STATUS_META.pendente.faixa}
              quantidade={pendentesVisiveis.length}
              nota={
                // Pedido pendente não TEM data de entrega — é o que ainda não
                // foi agendado. Esconder a coluna esconderia o trabalho a
                // fazer; dizer que ela não é filtrada é o honesto.
                entregaDe !== '' || entregaAte !== ''
                  ? 'sem data de entrega — não filtrado'
                  : undefined
              }
            >
              {pendentesVisiveis.map(({ pedido, saldo }) => (
                <PedidoCard
                  key={pedido.id}
                  pedido={pedido}
                  saldo={saldo}
                  podeEscrever={podeEscrever}
                  onAgendar={abrirAgendamento}
                  onDescartar={(p) => {
                    setErroPedido(null);
                    setAlvoPedido({ pedido: p, descartar: true });
                  }}
                />
              ))}
            </Coluna>

            {/* Colunas de VIAGEM. */}
            {COLUNAS_ENTREGA.map((status) => (
              <Coluna
                key={status}
                rotulo={STATUS_ENTREGA_META[status].rotulo}
                faixa={STATUS_ENTREGA_META[status].faixa}
                quantidade={entregasPorStatus[status].length}
                nota={
                  status === 'nao_realizado'
                    ? notaJanela(DIAS_NAO_REALIZADO)
                    : status === 'entregue'
                      ? notaJanela(DIAS_ENTREGUE)
                      : notaJanela()
                }
              >
                {entregasPorStatus[status].map((e) => (
                  <EntregaCard
                    key={e.id}
                    entrega={e}
                    podeEscrever={podeEscrever}
                    podeSeparar={podeSeparar}
                    onTransicionar={abrirTransicaoEntrega}
                    onSeparar={(entrega) => {
                      setErroSeparacao(null);
                      setSeparandoId(entrega.id);
                    }}
                    onReverter={abrirReversaoEntrega}
                    onReagendar={(entrega) => {
                      setErroReagendar(null);
                      setReagendando(entrega);
                    }}
                    onNaoRealizado={(entrega) => {
                      setErroNaoRealizado(null);
                      setAlvoNaoRealizado(entrega);
                    }}
                  />
                ))}
              </Coluna>
            ))}
            </div>
          </div>
        )}
      </main>

      {agendando && (
        <AgendarEntregaModal
          pedido={agendando.pedido}
          saldo={agendando.saldo}
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

      {reagendando && (
        <ReagendarEntregaModal
          entrega={reagendando}
          enviando={reagendarMutacao.isPending}
          erro={erroReagendar}
          onFechar={() => {
            if (!reagendarMutacao.isPending) {
              setReagendando(null);
              setErroReagendar(null);
            }
          }}
          onConfirmar={(body) =>
            reagendarMutacao.mutate({ id: reagendando.id, body })
          }
        />
      )}

      {alvoEntrega &&
        (() => {
          const t = textoConfirmacao(alvoEntrega);
          return (
            <ConfirmacaoModal
              titulo={t.titulo}
              subtitulo={`Pedido nº ${alvoEntrega.entrega.orixNumero || '—'} — ${
                alvoEntrega.entrega.clienteNome
              }`}
              descricao={t.descricao}
              rotuloConfirmar={t.rotulo}
              perigo={t.perigo}
              enviando={entregaMutacao.isPending}
              erro={erroEntrega}
              onCancelar={() => {
                if (!entregaMutacao.isPending) {
                  setAlvoEntrega(null);
                  setErroEntrega(null);
                }
              }}
              onConfirmar={() =>
                entregaMutacao.mutate({
                  id: alvoEntrega.entrega.id,
                  para: alvoEntrega.para,
                  reversao: alvoEntrega.reversao,
                })
              }
            />
          );
        })()}

      {alvoPedido && (
        <ConfirmacaoModal
          titulo={
            alvoPedido.descartar ? 'Descartar pedido' : 'Restaurar pedido'
          }
          subtitulo={`nº ${alvoPedido.pedido.orixNumero || '—'} — ${
            alvoPedido.pedido.clienteNome
          }`}
          descricao={
            alvoPedido.descartar
              ? 'Some do quadro por não ser uma entrega. Não avisa o cliente e dá para restaurar depois.'
              : 'O pedido volta para a fila e pode ser agendado de novo.'
          }
          rotuloConfirmar={alvoPedido.descartar ? 'Descartar' : 'Restaurar'}
          perigo={alvoPedido.descartar}
          enviando={pedidoMutacao.isPending}
          erro={erroPedido}
          onCancelar={() => {
            if (!pedidoMutacao.isPending) {
              setAlvoPedido(null);
              setErroPedido(null);
            }
          }}
          onConfirmar={() =>
            pedidoMutacao.mutate({
              id: alvoPedido.pedido.id,
              descartar: alvoPedido.descartar,
            })
          }
        />
      )}

      {entregaSeparacao && (
        <SeparacaoModal
          entrega={entregaSeparacao}
          enviando={separacaoMutacao.isPending}
          erro={erroSeparacao}
          onToggle={(itemId, separado) =>
            separacaoMutacao.mutate({
              entregaId: entregaSeparacao.id,
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

      {alvoNaoRealizado && (
        <NaoRealizadoModal
          entrega={alvoNaoRealizado}
          enviando={naoRealizadoMutacao.isPending}
          erro={erroNaoRealizado}
          onCancelar={() => {
            if (!naoRealizadoMutacao.isPending) {
              setAlvoNaoRealizado(null);
              setErroNaoRealizado(null);
            }
          }}
          onConfirmar={(motivo) =>
            naoRealizadoMutacao.mutate({ id: alvoNaoRealizado.id, motivo })
          }
        />
      )}

      {/* `undefined` é fechado; `null` é aberto em branco (reserva nova). */}
      {reservaEdicao !== undefined && (
        <ReservaModal
          reserva={reservaEdicao}
          enviando={reservaMutacao.isPending}
          erro={erroReserva}
          onFechar={() => {
            if (!reservaMutacao.isPending) {
              setReservaEdicao(undefined);
              setErroReserva(null);
            }
          }}
          onConfirmar={(body) =>
            reservaMutacao.mutate({
              id: reservaEdicao?.id,
              body,
            })
          }
        />
      )}

      {/* Cancelar reserva passa pela MESMA confirmação dos outros cards: nada de
          window.confirm, que não tem a paleta, não diz a consequência e não sabe
          mostrar o erro do servidor. */}
      {cancelandoReserva && (
        <ConfirmacaoModal
          titulo="Cancelar a reserva"
          subtitulo={`${cancelandoReserva.servico} — ${formatarData(
            cancelandoReserva.dataAgendada,
          )}`}
          descricao="O caminhão fica livre neste período e volta a aceitar entrega. A reserva não é apagada: fica no histórico."
          rotuloConfirmar="Cancelar reserva"
          perigo
          enviando={cancelarReservaMutacao.isPending}
          erro={erroCancelarReserva}
          onCancelar={() => {
            if (!cancelarReservaMutacao.isPending) {
              setCancelandoReserva(null);
              setErroCancelarReserva(null);
            }
          }}
          onConfirmar={() => cancelarReservaMutacao.mutate(cancelandoReserva.id)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coluna do quadro
// ---------------------------------------------------------------------------

interface ColunaProps {
  rotulo: string;
  faixa: string;
  quantidade: number;
  /** Nota do cabeçalho (ex.: a janela de dias das colunas de desfecho). */
  nota?: string;
  children: React.ReactNode;
}

function Coluna({
  rotulo,
  faixa,
  quantidade,
  nota,
  children,
}: ColunaProps): React.ReactElement {
  return (
    <section className="flex min-w-[280px] max-w-[360px] flex-1 flex-col rounded-xl2 border border-linha/70 bg-creme-50/50">
      <header className="sticky top-0 z-10 rounded-t-xl2 bg-creme-50/95 px-4 pt-3.5 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${faixa}`} />
            <h2 className="font-display text-[15px] font-semibold text-mata-escuro">
              {rotulo}
            </h2>
          </div>
          <span className="rounded-full bg-papel px-2 py-0.5 text-xs font-semibold text-tinta-suave shadow-sm">
            {quantidade}
          </span>
        </div>
        {nota && <p className="mt-0.5 text-[10px] text-pedra">{nota}</p>}
        <div className={`mt-2.5 h-[3px] w-full rounded-full ${faixa} opacity-70`} />
      </header>

      <div className="scroll-suave flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {quantidade === 0 ? (
          <p className="px-1 py-10 text-center text-xs text-pedra">
            Nada aqui.
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
