// As três VISÕES do calendário: mês, semana e dia.
//
// Estão no mesmo arquivo porque são a mesma coisa vista de três distâncias — o
// intervalo de dias chega por prop e cada uma decide o que vale mostrar naquele
// zoom (o mês resume em contagem e tonelagem; a semana e o dia abrem os blocos
// de slot). Mexer numa quase sempre pede olhar as outras duas.
//
// Nenhuma delas tem estado: quem escolhe a visão e a âncora é a página. É isso
// que permite a tela de Rota reusá-las com a sua própria navegação.

import React from 'react';
import type { AgendaSlot } from '@pastobom/shared';
import { DIAS_CURTOS, isoDeData } from '../../lib/datas';
import { emToneladas } from '../../lib/format';
import { BlocoSlot } from './BlocoSlot';
import { chaveSlot, PERIODO_ROTULO, PERIODOS } from './slots';

export interface VisaoMesProps {
  dias: Date[];
  mesAtual: number;
  isoHoje: string;
  porSlot: Map<string, AgendaSlot>;
}

export function VisaoMes({
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
            // A reserva CONTA no dia. Sem isso, o dia em que o caminhão só vai
            // à oficina aparece vazio no mês — e é justamente esse "parece
            // vago" que faz alguém prometer entrega e depois refazer tudo.
            const reservas =
              (manha?.reservas.length ?? 0) + (tarde?.reservas.length ?? 0);
            const itens = entregas + reservas;
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
                  {itens > 0 && (
                    <span
                      className="rounded-md bg-creme-100 px-1.5 py-0.5 text-[10px] font-semibold text-tinta-suave"
                      title={
                        reservas > 0
                          ? `${entregas} entrega(s) e ${reservas} reserva(s)`
                          : `${entregas} entrega(s)`
                      }
                    >
                      {itens}
                    </span>
                  )}
                </div>

                {itens === 0 ? (
                  <p className="mt-3 text-center text-[11px] text-pedra">—</p>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] text-tinta-suave">
                      {/* M e T contam ENTREGAS. A reserva vem na linha
                          tracejada abaixo, separada, porque somá-la aqui diria
                          que há entrega onde não há. */}
                      <span
                        className="rounded bg-folha-claro px-1.5 py-0.5 font-semibold text-mata"
                        title="Entregas da manhã"
                      >
                        M {manha?.entregas.length ?? 0}
                      </span>
                      <span
                        className="rounded bg-trigo-claro px-1.5 py-0.5 font-semibold text-trigo-escuro"
                        title="Entregas da tarde"
                      >
                        T {tarde?.entregas.length ?? 0}
                      </span>
                    </div>
                    {reservas > 0 && (
                      <p className="rounded border border-dashed border-pedra px-1.5 py-0.5 text-[10px] font-semibold text-tinta-suave">
                        {reservas === 1 ? '1 reserva' : `${reservas} reservas`}
                      </p>
                    )}
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

export interface VisaoSemanaProps {
  dias: Date[];
  isoHoje: string;
  porSlot: Map<string, AgendaSlot>;
  onAbrir: (entregaId: string) => void;
}

export function VisaoSemana({
  dias,
  isoHoje,
  porSlot,
  onAbrir,
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
                    onAbrir={onAbrir}
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

export interface VisaoDiaProps {
  data: string;
  porSlot: Map<string, AgendaSlot>;
  onAbrir: (entregaId: string) => void;
}

export function VisaoDia({
  data,
  porSlot,
  onAbrir,
}: VisaoDiaProps): React.ReactElement {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {PERIODOS.map((periodo) => (
        <BlocoSlot
          key={periodo}
          slot={porSlot.get(chaveSlot(data, periodo))}
          periodo={periodo}
          mostrarTitulo
          onAbrir={onAbrir}
        />
      ))}
    </div>
  );
}
