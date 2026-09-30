// Um CAMINHÃO e a carga dele num slot: barra de capacidade em cima, cards
// embaixo. Junto dele mora a BarraOcupacao, porque a barra só existe como
// cabeçalho deste grupo — separá-las esconderia essa dependência.
//
// Está nesta pasta porque a agenda do caminhão (tela de Rota) mostra o mesmo
// agrupamento; a regra e a ordenação continuam em @pastobom/shared, testadas.

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type {
  AgendaOcupacao,
  GrupoCaminhaoAgenda,
  PrevisaoClima,
} from '@pastobom/shared';
import { avaliarCapacidade } from '@pastobom/shared';
import { emToneladas } from '../../lib/format';
import { CardEntrega } from './CardEntrega';
import { CardReserva } from './CardReserva';
import { ListaEntregasOrdenavel } from './ListaEntregasOrdenavel';
import type { ReordenarGrupo } from './ListaEntregasOrdenavel';

export interface GrupoCaminhaoProps {
  grupo: GrupoCaminhaoAgenda;
  compacto: boolean;
  onAbrir: (entregaId: string) => void;
  /** Previsão por pedido. Opcional: o Mês não desenha cartão e não busca. */
  climaPorPedido?: Record<string, PrevisaoClima | null>;
  /**
   * Arrastar para reordenar as entregas do grupo. OPCIONAL, e é a ausência que
   * vale: sem ela (a /agenda, a Semana, o Mês) a lista é a de sempre, sem alça
   * nenhuma. Só a visão Dia da /agendamento, para a logística, passa — ver
   * ListaEntregasOrdenavel.tsx.
   */
  onReordenar?: ReordenarGrupo;
}

// O caminhão e a sua carga do período, juntos: barra em cima, clientes embaixo.
// A borda à esquerda é o que amarra visualmente os cards ao cabeçalho — sem
// ela, dois grupos seguidos voltam a parecer uma lista só.
export function GrupoCaminhao({
  grupo,
  compacto,
  onAbrir,
  climaPorPedido,
  onReordenar,
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
        {/* Reservas não arrastam: não são parada de rota, são o caminhão
            ocupado. Ficam fora da lista ordenável, sempre em cima. */}
        {onReordenar ? (
          <ListaEntregasOrdenavel
            entregas={grupo.entregas}
            compacto={compacto}
            onAbrir={onAbrir}
            climaPorPedido={climaPorPedido}
            onReordenar={onReordenar}
          />
        ) : (
          grupo.entregas.map((e) => (
            <CardEntrega
              key={e.entregaId}
              entrega={e}
              compacto={compacto}
              onAbrir={onAbrir}
              clima={climaPorPedido?.[e.pedidoId] ?? null}
            />
          ))
        )}
      </div>
    </div>
  );
}

export interface BarraOcupacaoProps {
  ocupacao: AgendaOcupacao;
  compacto: boolean;
}

// "Truck Branco: 4,2 / 10,0 t" + barra.
//
// Esta barra deixou de ser decoração em 27/08/2026. Com o peso não recusando
// mais agendamento, ela é O SINAL que a Natália pediu no lugar da trava:
// "mostrando na agenda, mas que ele não seja um impeditivo de agendamento, mas
// que ele sinalize para ele se aquele caminhão já tá lotado ou não".
//
// Por isso a comparação saiu daqui e foi para `avaliarCapacidade` no shared:
// ela existia em três cópias que discordavam entre si (a barra ficava vermelha
// em >=, o servidor recusava em >), e um caminhão fechado na capacidade exata
// aparecia vermelho e passava. Agora "fechou" (âmbar) e "passou" (terra) são
// estados diferentes, e o excedente aparece escrito.
export function BarraOcupacao({
  ocupacao,
  compacto,
}: BarraOcupacaoProps): React.ReactElement {
  const capacidade = avaliarCapacidade({
    capacidadeKg: ocupacao.capacidadeKg,
    usadoKg: ocupacao.usadoKg,
  });
  // A barra é limitada em 100%; o texto ao lado é que conta a verdade inteira.
  const pct = Math.min(100, capacidade.percentual ?? 0);

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
          } ${
            capacidade.nivel === 'excedido'
              ? 'text-terra-escuro'
              : capacidade.nivel === 'cheio'
                ? 'text-trigo-escuro'
                : 'text-tinta-suave'
          }`}
          title={
            capacidade.nivel === 'excedido'
              ? `Acima da capacidade em ${emToneladas(capacidade.excedenteKg)} t. O sistema não impede — confira a carga.`
              : capacidade.nivel === 'cheio'
                ? 'Caminhão fechado neste período.'
                : undefined
          }
        >
          {emToneladas(ocupacao.usadoKg)} / {emToneladas(ocupacao.capacidadeKg)}{' '}
          t
          {capacidade.nivel === 'excedido' &&
            ` · passou ${emToneladas(capacidade.excedenteKg)} t`}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-creme-100">
        <div
          className={`h-full rounded-full transition-all ${
            capacidade.nivel === 'excedido'
              ? 'bg-terra'
              : capacidade.nivel === 'cheio'
                ? 'bg-trigo'
                : 'bg-folha'
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
