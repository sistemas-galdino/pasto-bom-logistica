// O bloco de um SLOT (data + período): a célula do calendário.
//
// É a peça que as três visões reaproveitam — na semana ela é uma coluna estreita
// (modo compacto), no dia é um painel com título. Vive nesta pasta porque a
// agenda do caminhão (tela de Rota) monta as mesmas visões a partir dela.

import React from 'react';
import type { AgendaSlot, PeriodoEntrega } from '@pastobom/shared';
import { agruparSlotPorCaminhao } from '@pastobom/shared';
import { GrupoCaminhao } from './GrupoCaminhao';
import { PERIODO_ROTULO } from './slots';

export interface BlocoSlotProps {
  slot: AgendaSlot | undefined;
  periodo: PeriodoEntrega;
  /** Célula da semana: paddings e cards menores. */
  compacto?: boolean;
  /** Visão de dia: cabeçalho com o nome do período. */
  mostrarTitulo?: boolean;
  onAbrir: (entregaId: string) => void;
}

export function BlocoSlot({
  slot,
  periodo,
  compacto = false,
  mostrarTitulo = false,
  onAbrir,
}: BlocoSlotProps): React.ReactElement {
  const entregas = slot?.entregas ?? [];
  const reservas = slot?.reservas ?? [];

  // Um bloco por caminhão, com a barra de capacidade virando o CABEÇALHO do
  // grupo em vez de uma lista solta no topo: era impossível dizer qual cliente
  // ia em qual caminhão (queixa da Natália). Regra e ordenação em
  // @pastobom/shared, testadas.
  const grupos = React.useMemo(
    () => (slot ? agruparSlotPorCaminhao(slot) : []),
    [slot],
  );

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
            {reservas.length > 0 &&
              ` · ${reservas.length === 1 ? '1 reserva' : `${reservas.length} reservas`}`}
          </span>
        </div>
      )}

      {/* Reserva sozinha JÁ enche o período: o caminhão está tomado. Testar só
          `entregas` mandava o slot da oficina para o "Sem entregas neste
          período" e os grupos nem chegavam a renderizar. */}
      {entregas.length === 0 && reservas.length === 0 ? (
        <p
          className={`text-center text-tinta-suave ${
            compacto ? 'py-3 text-[11px] text-pedra' : 'py-6 text-sm'
          }`}
        >
          {compacto ? '—' : 'Sem entregas neste período.'}
        </p>
      ) : (
        <div className={compacto ? 'space-y-2.5' : 'space-y-4'}>
          {grupos.map((grupo) => (
            <GrupoCaminhao
              key={grupo.caminhaoId ?? '__sem_caminhao__'}
              grupo={grupo}
              compacto={compacto}
              onAbrir={onAbrir}
            />
          ))}
        </div>
      )}
    </section>
  );
}
