// Modal de confirmação para "voltar" um pedido uma etapa (reverter status).
// Diferente das transições para frente: NÃO dispara WhatsApp e limpa campos —
// o motorista ao sair da rota; a data agendada ao voltar para pendente.

import React from 'react';
import type { Pedido, StatusLogistico } from '@pastobom/shared';
import { STATUS_META } from './status';

interface Props {
  pedido: Pedido;
  para: StatusLogistico;
  enviando: boolean;
  erro: string | null;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/** Texto do efeito colateral conforme o destino da reversão. */
function efeitoDaReversao(para: StatusLogistico): string {
  if (para === 'pendente') {
    return 'A data agendada e o motorista serão removidos.';
  }
  if (para === 'agendada') {
    return 'O motorista atribuído será removido (a data agendada é mantida).';
  }
  return '';
}

export function ReverterModal({
  pedido,
  para,
  enviando,
  erro,
  onConfirmar,
  onCancelar,
}: Props): React.ReactElement {
  const destino = STATUS_META[para].rotulo;
  const origem = STATUS_META[pedido.statusLogistico].rotulo;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Voltar pedido"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCancelar();
      }}
    >
      <div className="w-full max-w-md animate-sobe rounded-xl2 bg-papel p-5 shadow-flutua">
        <h2 className="font-display text-lg font-semibold text-mata-escuro">
          Voltar para {destino}
        </h2>
        <p className="mt-0.5 text-sm text-tinta-suave">
          Pedido nº {pedido.orixNumero || '—'} —{' '}
          {pedido.clienteNome || pedido.clienteCodigo}
        </p>

        <p className="mt-4 rounded-lg bg-trigo-claro px-3 py-2.5 text-sm text-trigo-escuro">
          O pedido volta de <strong>{origem}</strong> para <strong>{destino}</strong>.{' '}
          {efeitoDaReversao(para)} O cliente <strong>não</strong> é notificado.
        </p>

        {erro && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-sm text-terra-escuro"
          >
            {erro}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={enviando}
            className="rounded-lg border border-linha px-4 py-2 text-sm font-semibold text-tinta-suave transition hover:bg-creme-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={enviando}
            className="rounded-lg bg-mata px-4 py-2 text-sm font-bold text-creme-50 transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando ? 'Voltando…' : `Voltar para ${destino}`}
          </button>
        </div>
      </div>
    </div>
  );
}
