// Painel (Dashboard): indicadores agregados de pedidos + motoristas.
//
// Reusa o cache ['pedidos'] (mesma key do Board) para os cards e gráficos, e
// ['motoristas'] para "Motoristas Ativos". Sem mutações: só leitura/visão.

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StatusLogistico } from '@pastobom/shared';
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
  Clock,
  CalendarClock,
  Truck,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { STATUS_META, STATUS_HEX, TODOS_STATUS } from '../components/status';
import { StatCard } from '../components/StatCard';

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

/** Chave yyyy-mm-dd em horário LOCAL (sem deslocamento de fuso). */
function chaveLocal(d: Date): string {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/**
 * Extrai a chave yyyy-mm-dd de uma data do pedido, espelhando format.ts:
 * data pura (yyyy-mm-dd) é usada como-está (local); timestamp ISO é parseado
 * e convertido para a chave local.
 */
function chaveData(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return chaveLocal(d);
}

export function Dashboard(): React.ReactElement {
  const pedidosQuery = useQuery({
    queryKey: ['pedidos'],
    queryFn: ({ signal }) => api.listarPedidos(TODOS_STATUS, signal),
    refetchInterval: 60_000,
  });

  const motoristasQuery = useQuery({
    queryKey: ['motoristas'],
    queryFn: ({ signal }) => api.listarMotoristas(signal),
  });

  const pedidos = useMemo(() => pedidosQuery.data ?? [], [pedidosQuery.data]);
  const motoristas = useMemo(
    () => motoristasQuery.data ?? [],
    [motoristasQuery.data],
  );

  const contagem = useMemo(() => {
    const c: Record<StatusLogistico, number> = {
      pendente: 0,
      agendada: 0,
      em_rota: 0,
      entregue: 0,
      cancelada: 0,
    };
    for (const p of pedidos) c[p.statusLogistico] += 1;
    return c;
  }, [pedidos]);

  const total = pedidos.length;
  const baseTaxa = contagem.entregue + contagem.cancelada;
  const taxaSucesso =
    baseTaxa === 0 ? 0 : Math.round((contagem.entregue / baseTaxa) * 100);

  const motoristasAtivos = useMemo(() => {
    const ids = new Set<string>();
    for (const p of pedidos) {
      if (p.statusLogistico === 'em_rota' && p.motoristaId) {
        ids.add(p.motoristaId);
      }
    }
    return ids.size;
  }, [pedidos]);

  // Série dos últimos 7 dias: contagem de pedidos "entregue" por dia,
  // usando dataEntregue ?? dataPedido.
  const serie7dias = useMemo(() => {
    const buckets: { chave: string; label: string; entregas: number }[] = [];
    const hoje = new Date();
    for (let i = 6; i >= 0; i--) {
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
    const indice = new Map(buckets.map((b) => [b.chave, b]));
    for (const p of pedidos) {
      if (p.statusLogistico !== 'entregue') continue;
      const chave = chaveData(p.dataEntregue ?? p.dataPedido);
      if (chave == null) continue;
      const bucket = indice.get(chave);
      if (bucket) bucket.entregas += 1;
    }
    return buckets;
  }, [pedidos]);

  // Distribuição por status para o donut (omite status zerados).
  const distribuicao = useMemo(
    () =>
      TODOS_STATUS.map((s) => ({
        status: s,
        nome: STATUS_META[s].rotulo,
        valor: contagem[s],
      })).filter((d) => d.valor > 0),
    [contagem],
  );

  const carregando = pedidosQuery.isLoading || motoristasQuery.isLoading;
  const erro = pedidosQuery.isError || motoristasQuery.isError;

  if (carregando) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-tinta-suave">
        Carregando indicadores…
      </div>
    );
  }

  if (erro) {
    const msg =
      pedidosQuery.error instanceof Error
        ? pedidosQuery.error.message
        : motoristasQuery.error instanceof Error
          ? motoristasQuery.error.message
          : 'Não foi possível carregar o painel.';
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-tinta-suave">
        <p>{msg}</p>
        <button
          type="button"
          onClick={() => {
            void pedidosQuery.refetch();
            void motoristasQuery.refetch();
          }}
          className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave hover:border-mata/30 hover:text-mata"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-pedra">
        Nenhum pedido encontrado.
      </div>
    );
  }

  return (
    <div className="scroll-suave h-full overflow-y-auto">
      <div className="animate-sobe mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total"
            value={total}
            sub="Todos os status"
            icon={Package}
            accent="mata"
          />
          <StatCard
            label="Pendentes"
            value={contagem.pendente}
            icon={Clock}
            accent="pedra"
          />
          <StatCard
            label="Agendadas"
            value={contagem.agendada}
            icon={CalendarClock}
            accent="folha"
          />
          <StatCard
            label="Em Rota"
            value={contagem.em_rota}
            icon={Truck}
            accent="trigo"
          />
          <StatCard
            label="Concluídas"
            value={contagem.entregue}
            icon={CheckCircle2}
            accent="mata"
          />
          <StatCard
            label="Cancelados"
            value={contagem.cancelada}
            icon={XCircle}
            accent="terra"
          />
          <StatCard
            label="Taxa de Sucesso"
            value={`${taxaSucesso}%`}
            sub={`${contagem.entregue} de ${baseTaxa} finalizados`}
            icon={TrendingUp}
            accent="folha"
          />
          <StatCard
            label="Motoristas Ativos"
            value={motoristasAtivos}
            sub={`${motoristas.length} cadastrados`}
            icon={Users}
            accent="trigo"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="font-sans rounded-xl2 border border-linha bg-papel p-4 shadow-carta sm:p-5 lg:col-span-2">
            <h3 className="font-display text-base font-semibold text-mata-escuro">
              Entregas nos últimos 7 dias
            </h3>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={serie7dias}
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
                      <stop offset="0%" stopColor="#3C7D52" stopOpacity={0.35} />
                      <stop
                        offset="100%"
                        stopColor="#3C7D52"
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
                    stroke="#1C4E37"
                    strokeWidth={2}
                    fill="url(#gradEntregas)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="font-sans rounded-xl2 border border-linha bg-papel p-4 shadow-carta sm:p-5">
            <h3 className="font-display text-base font-semibold text-mata-escuro">
              Status das Entregas
            </h3>
            <div className="mt-4 h-72">
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
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
