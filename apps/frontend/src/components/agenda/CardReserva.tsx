// Cartão de uma RESERVA DE CAMINHÃO na AGENDA (somente leitura).
//
// O par deste arquivo é components/ReservaCard.tsx, o da faixa do QUADRO, que
// leva as ações de Editar e Cancelar. Aqui não há ação nenhuma: o card só diz
// que o caminhão está tomado naquele período. O tracejado é o MESMO desenho nas
// duas telas, de propósito — o mesmo objeto tem de se reconhecer nos dois
// lugares.

import React from 'react';
import { Lock, MapPin, Truck, User } from 'lucide-react';
import type { AgendaReserva } from '@pastobom/shared';
import { emToneladas } from '../../lib/format';

export interface CardReservaProps {
  reserva: AgendaReserva;
  compacto: boolean;
}

// O card da RESERVA: o caminhão ocupado por algo que não é entrega a cliente
// (oficina, buscar adubo na fábrica). Tracejado e sem cor de status de propósito
// — não é viagem, não vai em rota, não é entregue. E é um <div>, não um <button>:
// não há detalhe de produtos para abrir; o conteúdo dela é este texto livre.
export function CardReserva({
  reserva,
  compacto,
}: CardReservaProps): React.ReactElement {
  const destino =
    reserva.fornecedorNome?.trim() || reserva.cidade?.trim() || '';

  return (
    <div
      className={`animate-sobe rounded-xl border border-dashed border-pedra bg-creme-50 ${
        compacto ? 'p-2' : 'p-3.5'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4
          className={`flex min-w-0 items-center gap-1.5 font-display font-semibold leading-tight text-tinta ${
            compacto ? 'text-xs' : 'text-[15px]'
          }`}
        >
          {reserva.bloqueiaCaminhao && (
            <Lock
              className={`${compacto ? 'h-3 w-3' : 'h-3.5 w-3.5'} shrink-0 text-terra-escuro`}
              aria-label="Caminhão indisponível neste período"
            />
          )}
          <span className="truncate">{reserva.servico}</span>
        </h4>
        <span className="shrink-0 rounded-md border border-dashed border-pedra px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-tinta-suave">
          Reserva
        </span>
      </div>

      {reserva.motoristaNome && (
        <p
          className={`mt-1 flex items-center gap-1 font-medium text-tinta-suave ${
            compacto ? 'text-[11px]' : 'text-xs'
          }`}
        >
          <User
            className="h-3.5 w-3.5 shrink-0 text-pedra"
            aria-hidden="true"
          />
          <span className="truncate">{reserva.motoristaNome}</span>
        </p>
      )}

      {destino && (
        <p
          className={`mt-0.5 flex items-center gap-1 text-tinta-suave ${
            compacto ? 'text-[11px]' : 'text-xs'
          }`}
        >
          <MapPin
            className="h-3.5 w-3.5 shrink-0 text-pedra"
            aria-hidden="true"
          />
          <span className="truncate">{destino}</span>
        </p>
      )}

      {!compacto && reserva.produtos && reserva.produtos.trim() !== '' && (
        <p className="mt-1 line-clamp-2 text-xs text-tinta-suave">
          {reserva.produtos}
        </p>
      )}

      <div
        className={`mt-2 flex items-center justify-between gap-2 border-t border-linha/70 pt-2 ${
          compacto ? 'text-[11px]' : 'text-xs'
        }`}
      >
        <span className="flex min-w-0 items-center gap-1 text-tinta-suave">
          <Truck
            className="h-3.5 w-3.5 shrink-0 text-pedra"
            aria-hidden="true"
          />
          <span className="truncate">{reserva.caminhaoNome || '—'}</span>
        </span>
        {/* Sem peso a reserva ocupa o caminhão sem contar tonelagem — é o caso
            da oficina, contra o da coleta de adubo. Dizer isso no card evita a
            leitura de que "faltou cadastrar o peso". */}
        {reserva.pesoPrevistoKg === null ? (
          <span
            className="shrink-0 text-pedra"
            title="Reserva sem peso: ocupa o caminhão, mas não conta tonelagem."
          >
            sem peso
          </span>
        ) : (
          <span className="shrink-0 font-semibold text-tinta-suave">
            {emToneladas(reserva.pesoPrevistoKg)} t
          </span>
        )}
      </div>
    </div>
  );
}
