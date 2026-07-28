// Painel (Dashboard): indicadores da operação — Onda 2.
//
// Ele conta ENTREGAS, não pedidos. Na Onda 2 o pedido perdeu o ciclo da viagem
// (ficou com pendente / entregue / cancelada) e quem tem agendada, em rota e não
// realizado passou a ser a ENTREGA. Contar status de pedido aqui devolvia zero
// fixo em metade dos cartões.
//
// DUAS RÉGUAS, e a tela diz qual é qual:
//
//   AGORA ....... Pedidos em aberto, Agendadas, Em rota, Motoristas ativos.
//                 Ignoram o filtro de período de propósito: "em rota nos últimos
//                 7 dias" não quer dizer nada, e uma janela curta esconderia a
//                 viagem agendada para daqui a dez dias — que existe.
//   NO PERÍODO .. Entregues, Não realizadas, Taxa de sucesso e os gráficos.
//                 Estes são desfechos: só fazem sentido com um recorte.
//
// A TAXA DE SUCESSO mudou de base. Era entregue/(entregue+cancelada), que
// misturava cancelamento comercial (a venda caiu) com falha de entrega (o
// caminhão foi e voltou). Agora é entregue/(entregue+não realizado): os dois
// desfechos de VIAGEM. É a taxa que diz se a operação está errando na rua.
//
// Carregamos TODAS as entregas de uma vez (mesma query key do Quadro, para o
// painel abrir instantâneo depois dele) e recortamos o período no cliente. Não é
// preguiça: o saldo dos pedidos precisa de todas as entregas, sem recorte de
// data — uma viagem antiga fora da conta faria o pedido reaparecer na fila com
// saldo que ele não tem.

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Entrega, StatusEntrega } from '@pastobom/shared';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Package,
  CalendarClock,
  Truck,
  CheckCircle2,
  PackageX,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { STATUS_META, STATUS_HEX } from '../components/status';
import { StatCard } from '../components/StatCard';
import {
  agruparEntregasPorPedido,
  isoMenosDias,
  pedidosComSaldo,
} from '../lib/saldo-pedidos';

// Estilo compartilhado do tooltip dos gráficos (paleta "Campo Claro").
const TOOLTIP_CONTENT_STYLE: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  border: '1px solid #E7DECB',
  borderRadius: 12,
  color: '#23271F',
  boxShadow: '0 18px 50px -16px rgba(20,58,41,0.32)',
};
const TOOLTIP_LABEL_STYLE: React.CSSProperties = { color: '#6F6C5E' };
const TOOLTIP_ITEM_STYLE: React.CSSProperties = { color: '#23271F' };

// --- período ---------------------------------------------------------------

interface Periodo {
  chave: string;
  rotulo: string;
  /** null = sem corte ("Tudo"). */
  dias: number | null;
}

const PERIODOS: Periodo[] = [
  { chave: '7', rotulo: '7 dias', dias: 7 },
  { chave: '15', rotulo: '15 dias', dias: 15 },
  { chave: '30', rotulo: '30 dias', dias: 30 },
  { chave: 'ano', rotulo: 'Ano', dias: 365 },
  { chave: 'tudo', rotulo: 'Tudo', dias: null },
];

const PERIODO_PADRAO = '30';

/** Ordem das fatias da rosca — a mesma do fluxo da viagem. */
const ORDEM_STATUS: StatusEntrega[] = [
  'agendada',
  'em_rota',
  'entregue',
  'nao_realizado',
  'cancelada',
];

// --- datas -----------------------------------------------------------------

/** Chave yyyy-mm-dd em horário LOCAL (sem deslocamento de fuso). */
function chaveLocal(d: Date): string {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/**
 * Extrai a chave yyyy-mm-dd de uma data, espelhando format.ts: data pura
 * (yyyy-mm-dd) é usada como-está (local); timestamp ISO é parseado e convertido
 * para a chave local.
 */
function chaveData(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return chaveLocal(d);
}

interface Bucket {
  chave: string;
  label: string;
  entregas: number;
}

/**
 * Série do gráfico, com a granularidade seguindo o período: dia até 30 dias,
 * mês daí em diante. Um ano em barras diárias são 365 espetos ilegíveis.
 *
 * A data usada é `dataEntregue ?? dataAgendada`: o dia em que a carga chegou é o
 * que interessa; a data agendada é só o fallback de quem foi migrado da Onda 1.
 */
function montarSerie(
  entregues: Entrega[],
  dias: number | null,
): { buckets: Bucket[]; porMes: boolean } {
  const hoje = new Date();
  const porMes = dias === null || dias > 30;
  const buckets: Bucket[] = [];

  if (!porMes) {
    const total = dias ?? 7;
    for (let i = total - 1; i >= 0; i--) {
      const d = new Date(hoje);
      d.setDate(hoje.getDate() - i);
      buckets.push({
        chave: chaveLocal(d),
        label: `${String(d.getDate()).padStart(2, '0')}/${String(
          d.getMonth() + 1,
        ).padStart(2, '0')}`,
        entregas: 0,
      });
    }
  } else {
    // "Ano" = 12 meses. "Tudo" começa na entrega mais antiga, com teto de 24
    // meses para o eixo não virar um borrão.
    let meses = 12;
    if (dias === null) {
      const chaves = entregues
        .map((e) => chaveData(e.dataEntregue ?? e.dataAgendada))
        .filter((c): c is string => c !== null);
      if (chaves.length > 0) {
        const maisAntiga = chaves.reduce((a, b) => (a < b ? a : b));
        const d = new Date(`${maisAntiga}T00:00:00`);
        const diff =
          (hoje.getFullYear() - d.getFullYear()) * 12 +
          (hoje.getMonth() - d.getMonth()) +
          1;
        meses = Math.min(24, Math.max(1, diff));
      } else {
        meses = 1;
      }
    }
    for (let i = meses - 1; i >= 0; i--) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      buckets.push({
        chave: `${d.getFullYear()}-${mm}`,
        label: `${mm}/${String(d.getFullYear()).slice(2)}`,
        entregas: 0,
      });
    }
  }

  const indice = new Map(buckets.map((b) => [b.chave, b]));
  for (const e of entregues) {
    const dia = chaveData(e.dataEntregue ?? e.dataAgendada);
    if (dia == null) continue;
    const bucket = indice.get(porMes ? dia.slice(0, 7) : dia);
    if (bucket) bucket.entregas += 1;
  }
  return { buckets, porMes };
}

// --- página ----------------------------------------------------------------

export function Dashboard(): React.ReactElement {
  const [periodoChave, setPeriodoChave] = useState(PERIODO_PADRAO);
  const periodo =
    PERIODOS.find((p) => p.chave === periodoChave) ?? PERIODOS[2]!;

  // Mesmas query keys do Quadro: quem vem de lá encontra o painel já montado.
  const pedidosQuery = useQuery({
    queryKey: ['pedidos', {}],
    queryFn: ({ signal }) =>
      api.listarPedidos(['pendente', 'entregue', 'cancelada'], signal),
    refetchInterval: 60_000,
  });

  const entregasQuery = useQuery({
    queryKey: ['entregas'],
    queryFn: ({ signal }) => api.listarEntregas({}, signal),
    refetchInterval: 60_000,
  });

  const motoristasQuery = useQuery({
    queryKey: ['motoristas'],
    queryFn: ({ signal }) => api.listarMotoristas(signal),
  });

  const pedidos = useMemo(() => pedidosQuery.data ?? [], [pedidosQuery.data]);
  const entregas = useMemo(() => entregasQuery.data ?? [], [entregasQuery.data]);
  const motoristas = useMemo(
    () => motoristasQuery.data ?? [],
    [motoristasQuery.data],
  );

  // --- AGORA (ignora o filtro) ---------------------------------------------

  /** Pedidos que ainda têm o que entregar — a fila de trabalho da logística. */
  const emAberto = useMemo(
    () => pedidosComSaldo(pedidos, agruparEntregasPorPedido(entregas)).length,
    [pedidos, entregas],
  );

  const agendadas = useMemo(
    () => entregas.filter((e) => e.status === 'agendada').length,
    [entregas],
  );

  const emRota = useMemo(
    () => entregas.filter((e) => e.status === 'em_rota').length,
    [entregas],
  );

  /** Quem está com carga na rua neste momento. */
  const motoristasAtivos = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entregas) {
      if (e.status === 'em_rota' && e.motoristaId) ids.add(e.motoristaId);
    }
    return ids.size;
  }, [entregas]);

  // --- NO PERÍODO ----------------------------------------------------------

  /**
   * O corte é só um piso (`>= corte`), nunca um teto: a viagem agendada para a
   * semana que vem tem de continuar aparecendo na rosca.
   */
  const entregasNoPeriodo = useMemo(() => {
    if (periodo.dias === null) return entregas;
    const corte = isoMenosDias(periodo.dias);
    return entregas.filter((e) => e.dataAgendada >= corte);
  }, [entregas, periodo.dias]);

  const entregues = useMemo(
    () => entregasNoPeriodo.filter((e) => e.status === 'entregue'),
    [entregasNoPeriodo],
  );

  const naoRealizadas = useMemo(
    () => entregasNoPeriodo.filter((e) => e.status === 'nao_realizado').length,
    [entregasNoPeriodo],
  );

  const baseTaxa = entregues.length + naoRealizadas;
  const taxaSucesso =
    baseTaxa === 0 ? 0 : Math.round((entregues.length / baseTaxa) * 100);

  const { buckets: serie, porMes } = useMemo(
    () => montarSerie(entregues, periodo.dias),
    [entregues, periodo.dias],
  );

  /** Distribuição das viagens do período por status (omite os zerados). */
  const distribuicao = useMemo(() => {
    const contagem: Record<StatusEntrega, number> = {
      agendada: 0,
      em_rota: 0,
      entregue: 0,
      nao_realizado: 0,
      cancelada: 0,
    };
    for (const e of entregasNoPeriodo) contagem[e.status] += 1;
    return ORDEM_STATUS.map((s) => ({
      status: s,
      nome: STATUS_META[s].rotulo,
      valor: contagem[s],
    })).filter((d) => d.valor > 0);
  }, [entregasNoPeriodo]);

  // --- estados de carga ----------------------------------------------------

  // Motoristas é acessório (o papel do usuário pode não ter leitura do
  // cadastro) e degrada para "—"; pedidos e entregas são o painel.
  const semMotoristas = motoristasQuery.isError;
  const carregando = pedidosQuery.isLoading || entregasQuery.isLoading;
  const falhou = pedidosQuery.isError || entregasQuery.isError;

  if (carregando) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-tinta-suave">
        Carregando indicadores…
      </div>
    );
  }

  if (falhou) {
    const err = pedidosQuery.error ?? entregasQuery.error;
    const msg =
      err instanceof Error ? err.message : 'Não foi possível carregar o painel.';
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-tinta-suave">
        <p>{msg}</p>
        <button
          type="button"
          onClick={() => {
            void pedidosQuery.refetch();
            void entregasQuery.refetch();
            void motoristasQuery.refetch();
          }}
          className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave hover:border-mata/30 hover:text-mata"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (pedidos.length === 0 && entregas.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-pedra">
        Nenhum pedido ou entrega encontrado.
      </div>
    );
  }

  const rotuloPeriodo =
    periodo.dias === null ? 'desde o início' : `últimos ${periodo.rotulo}`;

  return (
    <div className="scroll-suave h-full overflow-y-auto">
      <div className="animate-sobe mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        {/* --- AGORA --------------------------------------------------- */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-pedra">
            Agora
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Pedidos em aberto"
              value={emAberto}
              sub="Com saldo a entregar"
              icon={Package}
              accent="pedra"
            />
            <StatCard
              label="Agendadas"
              value={agendadas}
              sub="Viagens marcadas"
              icon={CalendarClock}
              accent="folha"
            />
            <StatCard
              label="Em rota"
              value={emRota}
              sub="Carga na rua"
              icon={Truck}
              accent="trigo"
            />
            <StatCard
              label="Motoristas ativos"
              value={semMotoristas ? '—' : motoristasAtivos}
              sub={
                semMotoristas
                  ? 'Cadastro indisponível'
                  : `${motoristas.length} cadastrados`
              }
              icon={Users}
              accent="mata"
            />
          </div>
        </section>

        {/* --- NO PERÍODO ---------------------------------------------- */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-pedra">
              No período
            </h2>
            <div
              role="group"
              aria-label="Período dos indicadores"
              className="flex flex-wrap gap-1.5"
            >
              {PERIODOS.map((p) => {
                const ativo = p.chave === periodo.chave;
                return (
                  <button
                    key={p.chave}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => setPeriodoChave(p.chave)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      ativo
                        ? 'bg-mata text-creme-50'
                        : 'border border-linha bg-papel text-tinta-suave hover:border-mata/30 hover:text-mata'
                    }`}
                  >
                    {p.rotulo}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Entregues"
              value={entregues.length}
              sub={rotuloPeriodo}
              icon={CheckCircle2}
              accent="mata"
            />
            {/* O caminhão foi e a entrega não aconteceu: precisa saltar aos
                olhos da logística. O acento fica em "terra" porque o StatCard
                ainda não expõe o vermelho "brasa" da paleta. */}
            <StatCard
              label="Não realizadas"
              value={naoRealizadas}
              sub="Viagens que falharam na rua"
              icon={PackageX}
              accent="terra"
            />
            <StatCard
              label="Taxa de sucesso"
              value={baseTaxa === 0 ? '—' : `${taxaSucesso}%`}
              sub={
                baseTaxa === 0
                  ? 'Nenhuma viagem encerrada no período'
                  : `${entregues.length} de ${baseTaxa} viagens encerradas`
              }
              icon={TrendingUp}
              accent="folha"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <section className="font-sans rounded-xl2 border border-linha bg-papel p-4 shadow-carta sm:p-5 lg:col-span-2">
              <h3 className="font-display text-base font-semibold text-mata-escuro">
                Entregas concluídas por {porMes ? 'mês' : 'dia'}
              </h3>
              <p className="mt-0.5 text-xs text-pedra">{rotuloPeriodo}</p>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={serie}
                    margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="gradEntregas"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#199A3C"
                          stopOpacity={0.35}
                        />
                        <stop
                          offset="100%"
                          stopColor="#199A3C"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="#E7DECB"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      stroke="#A8A293"
                      tick={{ fill: '#6F6C5E', fontSize: 12 }}
                      tickLine={false}
                      axisLine={{ stroke: '#E7DECB' }}
                      interval="preserveStartEnd"
                      minTickGap={16}
                    />
                    <YAxis
                      allowDecimals={false}
                      stroke="#A8A293"
                      tick={{ fill: '#6F6C5E', fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      width={28}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                      cursor={{ stroke: '#A8A293', strokeWidth: 1 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="entregas"
                      name="Entregas"
                      stroke="#176D2E"
                      strokeWidth={2}
                      fill="url(#gradEntregas)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="font-sans rounded-xl2 border border-linha bg-papel p-4 shadow-carta sm:p-5">
              <h3 className="font-display text-base font-semibold text-mata-escuro">
                Status das viagens
              </h3>
              <p className="mt-0.5 text-xs text-pedra">{rotuloPeriodo}</p>
              <div className="mt-4 h-72">
                {distribuicao.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-pedra">
                    Nenhuma viagem no período.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={distribuicao}
                        dataKey="valor"
                        nameKey="nome"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        stroke="#FFFFFF"
                        strokeWidth={2}
                      >
                        {distribuicao.map((d) => (
                          <Cell key={d.status} fill={STATUS_HEX[d.status]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={TOOLTIP_CONTENT_STYLE}
                        labelStyle={TOOLTIP_LABEL_STYLE}
                        itemStyle={TOOLTIP_ITEM_STYLE}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}
