// Modal da transição em_rota -> nao_realizado: pergunta POR QUE a entrega não
// aconteceu. O motivo é obrigatório (o backend recusa com 422 `motivo_obrigatorio`)
// porque é ele que diz à logística o que precisa ser resolvido antes de remarcar.
// Como a venda continua de pé, isto NÃO é cancelamento e o cliente NÃO é avisado.

import React, { useState } from 'react';
import type { Pedido } from '@pastobom/shared';

interface Props {
  pedido: Pedido;
  enviando: boolean;
  erro: string | null;
  onConfirmar: (motivo: string) => void;
  onCancelar: () => void;
}

/** Os motivos que mais aparecem na entrega rural (atalhos de digitação). */
const MOTIVOS_COMUNS = [
  'Cliente ausente',
  'Porteira fechada',
  'Estrada intransitável',
  'Endereço não encontrado',
  'Cliente recusou',
];

const MAX_MOTIVO = 1000;

export function NaoRealizadoModal({
  pedido,
  enviando,
  erro,
  onConfirmar,
  onCancelar,
}: Props): React.ReactElement {
  const [motivo, setMotivo] = useState('');
  const motivoLimpo = motivo.trim();
  const semMotivo = motivoLimpo === '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Entrega não realizada"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCancelar();
      }}
    >
      <div className="w-full max-w-md animate-sobe rounded-xl2 bg-papel p-5 shadow-flutua">
        <h2 className="font-display text-lg font-semibold text-mata-escuro">
          Entrega não realizada
        </h2>
        <p className="mt-0.5 text-sm text-tinta-suave">
          Pedido nº {pedido.orixNumero || '—'} —{' '}
          {pedido.clienteNome || pedido.clienteCodigo}
        </p>

        <p className="mt-4 rounded-lg bg-brasa-claro px-3 py-2.5 text-sm text-brasa-escuro">
          O pedido sai da rota e fica em <strong>Não realizado</strong> até ser
          reagendado. A venda continua de pé — o cliente <strong>não</strong> é
          notificado.
        </p>

        <div className="mt-4">
          <label
            htmlFor="motivo-nao-entrega"
            className="text-sm font-semibold text-tinta"
          >
            Por que a entrega não foi realizada?
          </label>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {MOTIVOS_COMUNS.map((sugestao) => (
              <button
                key={sugestao}
                type="button"
                onClick={() => setMotivo(sugestao)}
                disabled={enviando}
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition disabled:opacity-60 ${
                  motivoLimpo === sugestao
                    ? 'border-brasa/40 bg-brasa-claro text-brasa-escuro'
                    : 'border-linha bg-creme-50 text-tinta-suave hover:border-brasa/30 hover:text-brasa-escuro'
                }`}
              >
                {sugestao}
              </button>
            ))}
          </div>

          <textarea
            id="motivo-nao-entrega"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={MAX_MOTIVO}
            rows={3}
            autoFocus
            disabled={enviando}
            placeholder="Ex.: cliente ausente, ninguém para receber a carga."
            className="mt-2 w-full resize-none rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition placeholder:text-pedra focus:border-mata/40 focus:bg-papel disabled:opacity-60"
          />
          <p className="mt-1 flex items-center justify-between text-[11px] text-pedra">
            <span>Obrigatório — sem o motivo a logística não sabe o que remarcar.</span>
            <span>
              {motivo.length}/{MAX_MOTIVO}
            </span>
          </p>
        </div>

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
            Voltar
          </button>
          <button
            type="button"
            onClick={() => onConfirmar(motivoLimpo)}
            disabled={enviando || semMotivo}
            title={semMotivo ? 'Informe o motivo da não entrega.' : undefined}
            className="rounded-lg bg-brasa px-4 py-2 text-sm font-bold text-creme-50 transition hover:bg-brasa-escuro disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando ? 'Registrando…' : 'Marcar não realizado'}
          </button>
        </div>
      </div>
    </div>
  );
}
