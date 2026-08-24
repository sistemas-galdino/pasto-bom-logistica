// Um CAMINHÃO e a carga dele num slot: barra de capacidade em cima, cards
// embaixo. Junto dele mora a BarraOcupacao, porque a barra só existe como
// cabeçalho deste grupo — separá-las esconderia essa dependência.
//
// Está nesta pasta porque a agenda do caminhão (tela de Rota) mostra o mesmo
// agrupamento; a regra e a ordenação continuam em @pastobom/shared, testadas.

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AgendaOcupacao, GrupoCaminhaoAgenda } from '@pastobom/shared';
import { emToneladas } from '../../lib/format';
import { CardEntrega } from './CardEntrega';
import { CardReserva } from './CardReserva';

export interface GrupoCaminhaoProps {
  grupo: GrupoCaminhaoAgenda;
  compacto: boolean;
  onAbrir: (entregaId: string) => void;
}

// O caminhão e a sua carga do período, juntos: barra em cima, clientes embaixo.
// A borda à esquerda é o que amarra visualmente os cards ao cabeçalho — sem
// ela, dois grupos seguidos voltam a parecer uma lista só.
export function GrupoCaminhao({
  grupo,
  compacto,
  onAbrir,
}: GrupoCaminhaoProps): React.ReactElement {
  const semCaminhao = grupo.caminhaoId === null;

  return (
    <div>
      <div
        className={`rounded-xl border bg-papel ${
          semCaminhao ? 'border-trigo/50' : 'border-linha'
        } ${compacto ? 'p-2' : 'p-3'}`}
      >
        {grupo.ocupacao ? (
          <BarraOcupacao ocupacao={grupo.ocupacao} compacto={compacto} />
        ) : (
          // Sem caminhão não há capacidade a medir — e viagem sem caminhão é
          // pendência, não detalhe: fica em âmbar e sempre no fim do período.
          <div className="flex items-center gap-1.5">
            <AlertTriangle
              className={`${compacto ? 'h-3 w-3' : 'h-3.5 w-3.5'} shrink-0 text-trigo-escuro`}
              aria-hidden="true"
            />
            <span
              className={`font-semibold text-trigo-escuro ${
                compacto ? 'text-[11px]' : 'text-xs'
              }`}
            >
              {semCaminhao ? 'Sem caminhão' : grupo.caminhaoNome}
            </span>
            <span
              className={`ml-auto text-pedra ${compacto ? 'text-[10px]' : 'text-[11px]'}`}
            >
              {grupo.entregas.length + grupo.reservas.length}
            </span>
          </div>
        )}
      </div>

      <div
        className={`mt-1.5 border-l border-linha ${
          compacto ? 'space-y-1.5 pl-1.5' : 'space-y-2 pl-2.5'
        }`}
      >
        {/* Reservas primeiro: elas são o contexto do caminhão no período. Ler
            "está na oficina" depois da lista de clientes é ler na ordem errada. */}
        {grupo.reservas.map((r) => (
          <CardReserva key={r.reservaId} reserva={r} compacto={compacto} />
        ))}
        {grupo.entregas.map((e) => (
          <CardEntrega
            key={e.entregaId}
            entrega={e}
            compacto={compacto}
            onAbrir={onAbrir}
          />
        ))}
      </div>
    </div>
  );
}

export interface BarraOcupacaoProps {
  ocupacao: AgendaOcupacao;
  compacto: boolean;
}

// "Truck Branco: 4,2 / 10,0 t" + barra. Vermelho quando o caminhão fechou a
// capacidade — é o sinal de que não cabe mais nada naquele período.
export function BarraOcupacao({
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
