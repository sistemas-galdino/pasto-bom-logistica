// Página de AGENDA: calendário de entregas em mês / semana / dia.
//
// O domínio é SLOT = (data + período manhã/tarde) — a reunião de 25/06 decidiu
// planejar por turno, nunca por horário. Por isso não há timeline: cada dia se
// parte em dois blocos, e o que interessa em cada bloco é quanto de carga já
// está em cada caminhão (é assim que o vendedor decide se "cabe mais uma").
//
// SOMENTE LEITURA para todos os papéis: quem agenda é a logística, no quadro.
//
// Fuso: as datas vêm como 'YYYY-MM-DD'. Toda conversão passa por dataDeIso/
// isoDeData (Date local) — `new Date('YYYY-MM-DD')` viraria UTC e volta um dia.

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Truck,
  User,
} from 'lucide-react';
import type {
  AgendaEntrega,
  AgendaOcupacao,
  AgendaSlot,
  PeriodoEntrega,
} from '@pastobom/shared';
import { api } from '../lib/api';
import { STATUS_META } from '../components/status';

type Visao = 'mes' | 'semana' | 'dia';

const PERIODOS: PeriodoEntrega[] = ['manha', 'tarde'];

const PERIODO_ROTULO: Record<PeriodoEntrega, string> = {
  manha: 'Manhã',
  tarde: 'Tarde',
};

const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

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

function addMeses(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Domingo da semana de `d` (a grade começa no domingo). */
function inicioDaSemana(d: Date): Date {
  return addDias(d, -d.getDay());
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Toneladas com 1 casa (ex.: 4,2) — a tela sempre fala em toneladas. */
function emToneladas(kg: number): string {
  return (kg / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function chaveSlot(data: string, periodo: PeriodoEntrega): string {
  return `${data}|${periodo}`;
}

interface Intervalo {
  inicio: Date;
  fim: Date;
  dias: Date[];
}

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

function tituloDoPeriodo(visao: Visao, intervalo: Intervalo, ancora: Date): string {
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

export default function Agenda(): React.ReactElement {
  const [visao, setVisao] = useState<Visao>('semana');
  const [ancora, setAncora] = useState<Date>(() => hojeLocal());

  const intervalo = useMemo(
    () => intervaloDaVisao(visao, ancora),
    [visao, ancora],
  );
  const de = isoDeData(intervalo.inicio);
  const ate = isoDeData(intervalo.fim);

  const agendaQuery = useQuery({
    queryKey: ['agenda', de, ate],
    queryFn: ({ signal }) => api.agenda(de, ate, signal),
  });

  const porSlot = useMemo(() => {
    const mapa = new Map<string, AgendaSlot>();
    for (const slot of agendaQuery.data?.slots ?? []) {
      mapa.set(chaveSlot(slot.data, slot.periodo), slot);
    }
    return mapa;
  }, [agendaQuery.data]);

  const totalEntregas = (agendaQuery.data?.slots ?? []).reduce(
    (s, slot) => s + slot.entregas.length,
    0,
  );

  const isoHoje = isoDeData(hojeLocal());
  const titulo = tituloDoPeriodo(visao, intervalo, ancora);

  function navegar(passo: -1 | 1) {
    if (visao === 'dia') setAncora((a) => addDias(a, passo));
    else if (visao === 'semana') setAncora((a) => addDias(a, passo * 7));
    else setAncora((a) => addMeses(a, passo));
  }

  const abaCls = (ativo: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
      ativo
        ? 'bg-mata text-creme-50 shadow-sm'
        : 'border border-linha bg-papel text-tinta-suave hover:border-mata/30 hover:text-mata'
    }`;

  const navCls =
    'flex h-8 w-8 items-center justify-center rounded-lg border border-linha bg-papel text-tinta-suave transition hover:border-mata/30 hover:text-mata';

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-linha bg-creme-50/70 px-4 py-2.5 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navegar(-1)}
              aria-label="Período anterior"
              className={navCls}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setAncora(hojeLocal())}
              className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => navegar(1)}
              aria-label="Próximo período"
              className={navCls}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-baseline gap-2 text-sm">
            <h2 className="font-display text-base font-semibold text-mata-escuro">
              {titulo}
            </h2>
            <span className="text-pedra">·</span>
            <span className="text-tinta-suave">
              {totalEntregas === 1 ? '1 entrega' : `${totalEntregas} entregas`}
            </span>
            {agendaQuery.isFetching && (
              <span className="text-xs text-pedra">atualizando…</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setVisao('mes')}
            className={abaCls(visao === 'mes')}
          >
            Mês
          </button>
          <button
            type="button"
            onClick={() => setVisao('semana')}
            className={abaCls(visao === 'semana')}
          >
            Semana
          </button>
          <button
            type="button"
            onClick={() => setVisao('dia')}
            className={abaCls(visao === 'dia')}
          >
            Dia
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-auto scroll-suave">
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
          <div className="mx-auto max-w-[1600px] space-y-4 p-4 animate-sobe sm:p-6">
            {totalEntregas === 0 && (
              <p className="flex items-center justify-center gap-2 rounded-xl2 border border-dashed border-linha bg-papel/60 py-6 text-sm text-tinta-suave">
                <CalendarDays className="h-4 w-4 text-pedra" aria-hidden="true" />
                Nenhuma entrega agendada neste período.
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
              />
            )}

            {visao === 'dia' && (
              <VisaoDia data={isoDeData(ancora)} porSlot={porSlot} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// --- visões -----------------------------------------------------------------

interface VisaoMesProps {
  dias: Date[];
  mesAtual: number;
  isoHoje: string;
  porSlot: Map<string, AgendaSlot>;
}

function VisaoMes({
  dias,
  mesAtual,
  isoHoje,
  porSlot,
}: VisaoMesProps): React.ReactElement {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[820px]">
        <div className="grid grid-cols-7 gap-2 pb-2">
          {DIAS_CURTOS.map((d) => (
            <div
              key={d}
              className="text-center text-[11px] font-semibold uppercase tracking-wide text-tinta-suave"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-2">
          {dias.map((d) => {
            const iso = isoDeData(d);
            const manha = porSlot.get(chaveSlot(iso, 'manha'));
            const tarde = porSlot.get(chaveSlot(iso, 'tarde'));
            const ocupacoes = [
              ...(manha?.ocupacao ?? []),
              ...(tarde?.ocupacao ?? []),
            ];
            const usadoKg = ocupacoes.reduce((s, o) => s + o.usadoKg, 0);
            const capacidadeKg = ocupacoes.reduce(
              (s, o) => s + o.capacidadeKg,
              0,
            );
            const entregas =
              (manha?.entregas.length ?? 0) + (tarde?.entregas.length ?? 0);
            const foraDoMes = d.getMonth() !== mesAtual;
            const ehHoje = iso === isoHoje;
            const cheio = capacidadeKg > 0 && usadoKg >= capacidadeKg;
            const pct =
              capacidadeKg > 0
                ? Math.min(100, (usadoKg / capacidadeKg) * 100)
                : 0;

            return (
              <div
                key={iso}
                className={`min-h-[104px] rounded-xl border p-2 transition ${
                  foraDoMes
                    ? 'border-linha/60 bg-creme-50/50'
                    : 'border-linha bg-papel shadow-carta'
                } ${ehHoje ? 'ring-2 ring-folha/40' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-semibold ${
                      foraDoMes
                        ? 'text-pedra'
                        : ehHoje
                          ? 'text-mata'
                          : 'text-tinta'
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  {entregas > 0 && (
                    <span className="rounded-md bg-creme-100 px-1.5 py-0.5 text-[10px] font-semibold text-tinta-suave">
                      {entregas}
                    </span>
                  )}
                </div>

                {entregas === 0 ? (
                  <p className="mt-3 text-center text-[11px] text-pedra">—</p>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] text-tinta-suave">
                      <span className="rounded bg-folha-claro px-1.5 py-0.5 font-semibold text-mata">
                        M {manha?.entregas.length ?? 0}
                      </span>
                      <span className="rounded bg-trigo-claro px-1.5 py-0.5 font-semibold text-trigo-escuro">
                        T {tarde?.entregas.length ?? 0}
                      </span>
                    </div>
                    {capacidadeKg > 0 && (
                      <div>
                        <p
                          className={`text-[11px] font-semibold ${
                            cheio ? 'text-terra-escuro' : 'text-tinta-suave'
                          }`}
                        >
                          {emToneladas(usadoKg)} / {emToneladas(capacidadeKg)} t
                        </p>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-creme-100">
                          <div
                            className={`h-full rounded-full transition-all ${
                              cheio ? 'bg-terra' : 'bg-folha'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface VisaoSemanaProps {
  dias: Date[];
  isoHoje: string;
  porSlot: Map<string, AgendaSlot>;
}

function VisaoSemana({
  dias,
  isoHoje,
  porSlot,
}: VisaoSemanaProps): React.ReactElement {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1040px] space-y-4">
        <div className="grid grid-cols-7 gap-2">
          {dias.map((d) => {
            const iso = isoDeData(d);
            const ehHoje = iso === isoHoje;
            return (
              <div
                key={iso}
                className={`rounded-lg px-2 py-1.5 text-center ${
                  ehHoje ? 'bg-folha-claro' : ''
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-tinta-suave">
                  {DIAS_CURTOS[d.getDay()]}
                </p>
                <p
                  className={`font-display text-lg font-semibold ${
                    ehHoje ? 'text-mata' : 'text-tinta'
                  }`}
                >
                  {d.getDate()}
                </p>
              </div>
            );
          })}
        </div>

        {PERIODOS.map((periodo) => (
          <div key={periodo}>
            <div className="mb-2 flex items-center gap-2">
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  periodo === 'manha'
                    ? 'bg-folha-claro text-mata'
                    : 'bg-trigo-claro text-trigo-escuro'
                }`}
              >
                {PERIODO_ROTULO[periodo]}
              </span>
              <span className="h-px flex-1 bg-linha" />
            </div>
            <div className="grid grid-cols-7 items-start gap-2">
              {dias.map((d) => {
                const iso = isoDeData(d);
                return (
                  <BlocoSlot
                    key={iso}
                    slot={porSlot.get(chaveSlot(iso, periodo))}
                    periodo={periodo}
                    compacto
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface VisaoDiaProps {
  data: string;
  porSlot: Map<string, AgendaSlot>;
}

function VisaoDia({ data, porSlot }: VisaoDiaProps): React.ReactElement {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {PERIODOS.map((periodo) => (
        <BlocoSlot
          key={periodo}
          slot={porSlot.get(chaveSlot(data, periodo))}
          periodo={periodo}
          mostrarTitulo
        />
      ))}
    </div>
  );
}

// --- bloco de um slot (data + período) --------------------------------------

interface BlocoSlotProps {
  slot: AgendaSlot | undefined;
  periodo: PeriodoEntrega;
  /** Célula da semana: paddings e cards menores. */
  compacto?: boolean;
  /** Visão de dia: cabeçalho com o nome do período. */
  mostrarTitulo?: boolean;
}

function BlocoSlot({
  slot,
  periodo,
  compacto = false,
  mostrarTitulo = false,
}: BlocoSlotProps): React.ReactElement {
  const entregas = slot?.entregas ?? [];
  const ocupacao = slot?.ocupacao ?? [];

  return (
    <section
      className={`rounded-xl2 border border-linha bg-creme-50/60 ${
        compacto ? 'min-h-[80px] p-2' : 'p-4'
      }`}
    >
      {mostrarTitulo && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-display text-base font-semibold text-mata-escuro">
            {PERIODO_ROTULO[periodo]}
          </h3>
          <span className="text-xs text-tinta-suave">
            {entregas.length === 1
              ? '1 entrega'
              : `${entregas.length} entregas`}
          </span>
        </div>
      )}

      {ocupacao.length > 0 && (
        <div
          className={`mb-3 space-y-2 rounded-xl border border-linha bg-papel ${
            compacto ? 'p-2' : 'p-3'
          }`}
        >
          {ocupacao.map((o) => (
            <BarraOcupacao key={o.caminhaoId} ocupacao={o} compacto={compacto} />
          ))}
        </div>
      )}

      {entregas.length === 0 ? (
        <p
          className={`text-center text-tinta-suave ${
            compacto ? 'py-3 text-[11px] text-pedra' : 'py-6 text-sm'
          }`}
        >
          {compacto ? '—' : 'Sem entregas neste período.'}
        </p>
      ) : (
        <div className={compacto ? 'space-y-2' : 'space-y-3'}>
          {entregas.map((e) => (
            <CardEntrega key={e.pedidoId} entrega={e} compacto={compacto} />
          ))}
        </div>
      )}
    </section>
  );
}

interface BarraOcupacaoProps {
  ocupacao: AgendaOcupacao;
  compacto: boolean;
}

// "Truck Branco: 4,2 / 10,0 t" + barra. Vermelho quando o caminhão fechou a
// capacidade — é o sinal de que não cabe mais nada naquele período.
function BarraOcupacao({
  ocupacao,
  compacto,
}: BarraOcupacaoProps): React.ReactElement {
  const cheio =
    ocupacao.capacidadeKg > 0 && ocupacao.usadoKg >= ocupacao.capacidadeKg;
  const pct =
    ocupacao.capacidadeKg > 0
      ? Math.min(100, (ocupacao.usadoKg / ocupacao.capacidadeKg) * 100)
      : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`truncate font-semibold text-tinta ${
            compacto ? 'text-[11px]' : 'text-xs'
          }`}
        >
          {ocupacao.caminhaoNome}
        </span>
        <span
          className={`shrink-0 font-semibold ${
            compacto ? 'text-[11px]' : 'text-xs'
          } ${cheio ? 'text-terra-escuro' : 'text-tinta-suave'}`}
        >
          {emToneladas(ocupacao.usadoKg)} / {emToneladas(ocupacao.capacidadeKg)}{' '}
          t
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-creme-100">
        <div
          className={`h-full rounded-full transition-all ${
            cheio ? 'bg-terra' : 'bg-folha'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {!compacto && ocupacao.motoristaNome && (
        <p className="mt-1 text-[11px] text-tinta-suave">
          {ocupacao.motoristaNome} ·{' '}
          {ocupacao.entregas === 1
            ? '1 entrega'
            : `${ocupacao.entregas} entregas`}
        </p>
      )}
    </div>
  );
}

interface CardEntregaProps {
  entrega: AgendaEntrega;
  compacto: boolean;
}

// Ordem de destaque pedida na reunião: CLIENTE, MOTORISTA, BAIRRO (+ cidade).
function CardEntrega({ entrega, compacto }: CardEntregaProps): React.ReactElement {
  const meta = STATUS_META[entrega.statusLogistico];
  const local = [entrega.bairro, entrega.cidade]
    .filter((p) => p && p.trim().length > 0)
    .join(' · ');

  return (
    <article
      className={`animate-sobe rounded-xl border border-linha bg-papel shadow-carta transition duration-200 hover:-translate-y-0.5 hover:shadow-flutua ${
        compacto ? 'p-2' : 'p-3.5'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4
          className={`font-display font-semibold leading-tight text-tinta ${
            compacto ? 'text-xs' : 'text-[15px]'
          }`}
        >
          {entrega.clienteNome || 'Cliente'}
        </h4>
        {!compacto && (
          <span className="shrink-0 rounded-md bg-creme-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-tinta-suave">
            nº {entrega.orixNumero || '—'}
          </span>
        )}
      </div>

      <p
        className={`mt-1 flex items-center gap-1 font-medium text-tinta-suave ${
          compacto ? 'text-[11px]' : 'text-xs'
        }`}
      >
        <User className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true" />
        <span className="truncate">
          {entrega.motoristaNome || 'Sem motorista'}
        </span>
      </p>

      <p
        className={`mt-0.5 flex items-center gap-1 text-tinta-suave ${
          compacto ? 'text-[11px]' : 'text-xs'
        }`}
      >
        <MapPin className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true" />
        <span className="truncate">{local || '—'}</span>
      </p>

      <div
        className={`mt-2 flex items-center justify-between gap-2 border-t border-linha/70 pt-2 ${
          compacto ? 'text-[11px]' : 'text-xs'
        }`}
      >
        <span className="flex min-w-0 items-center gap-1 text-tinta-suave">
          <Truck className="h-3.5 w-3.5 shrink-0 text-pedra" aria-hidden="true" />
          <span className="truncate">{entrega.caminhaoNome || '—'}</span>
        </span>
        {entrega.pesoTotalKg === null ? (
          <span
            className="flex shrink-0 items-center gap-1 text-trigo-escuro"
            title="Algum item do pedido ainda está sem peso cadastrado."
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            peso pendente
          </span>
        ) : (
          <span className="shrink-0 font-semibold text-mata-escuro">
            {emToneladas(entrega.pesoTotalKg)} t
          </span>
        )}
      </div>

      {!compacto && (
        <span
          className={`mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${meta.badge}`}
        >
          {meta.rotulo}
        </span>
      )}
    </article>
  );
}
