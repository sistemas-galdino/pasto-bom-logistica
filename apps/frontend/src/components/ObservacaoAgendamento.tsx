// Recado de quem AGENDOU a viagem (migração 0027) — pedido da Natália,
// 06/11/2026: "visível em todo fluxo até a entrega ser dada como concluída",
// no quadro, na agenda, no detalhe e na tela do motorista.
//
// Um desenho só para todo lugar, em tom de trigo (aviso, não erro), para o
// motorista reconhecer de longe que "aquilo amarelo é recado".

import React from 'react';
import { MessageSquareText } from 'lucide-react';
import type { StatusEntrega } from '@pastobom/shared';

interface Props {
  texto: string | null | undefined;
  /**
   * Com status, o recado some quando a viagem é encerrada (entregue, não
   * realizada, cancelada). Sem status, aparece sempre — é o caso do detalhe,
   * onde ele fica como registro do que foi combinado.
   */
  status?: StatusEntrega;
  /** Cartões pequenos: uma linha com reticências; o texto inteiro no title. */
  compacto?: boolean;
  className?: string;
}

export function viagemEmAberto(status: StatusEntrega): boolean {
  return status === 'agendada' || status === 'em_rota';
}

export function ObservacaoAgendamento({
  texto,
  status,
  compacto = false,
  className = '',
}: Props): React.ReactElement | null {
  const limpo = texto?.trim();
  if (!limpo) return null;
  if (status !== undefined && !viagemEmAberto(status)) return null;

  if (compacto) {
    return (
      <p
        title={limpo}
        className={`flex items-center gap-1 rounded-md bg-trigo-claro px-1.5 py-0.5 text-[11px] text-trigo-escuro ${className}`}
      >
        <MessageSquareText className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{limpo}</span>
      </p>
    );
  }

  return (
    <div
      className={`flex items-start gap-2 rounded-lg border border-trigo/40 bg-trigo-claro px-3 py-2 text-sm text-trigo-escuro ${className}`}
    >
      <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide">
          Observação do agendamento
        </p>
        <p className="whitespace-pre-wrap break-words">{limpo}</p>
      </div>
    </div>
  );
}
