// Confirmação simples: título, explicação do que vai acontecer e um botão.
//
// Substitui o TransicaoModal nas transições que não pedem dados — pôr em rota,
// marcar entregue, desfazer agendamento, voltar uma etapa. O agendamento (que
// pede quantidade, data, motorista e caminhão) tem modal próprio, e a não
// realização também, porque exige motivo.
//
// A `descricao` não é enfeite: é onde se diz a consequência. "Desfazer" e
// "voltar" mexem em vaga de caminhão e em saldo, e quem clica precisa saber
// disso antes, não depois.

import React from 'react';

interface Props {
  titulo: string;
  /** Linha secundária: de quem/de qual pedido se trata. */
  subtitulo?: string;
  /** O que vai acontecer, em uma frase. */
  descricao?: string;
  rotuloConfirmar: string;
  /** Ação destrutiva/de recuo ganha o vermelho da marca. */
  perigo?: boolean;
  enviando: boolean;
  erro: string | null;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ConfirmacaoModal({
  titulo,
  subtitulo,
  descricao,
  rotuloConfirmar,
  perigo = false,
  enviando,
  erro,
  onConfirmar,
  onCancelar,
}: Props): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCancelar();
      }}
    >
      <div className="w-full max-w-md animate-sobe rounded-xl2 bg-papel p-5 shadow-flutua">
        <h2 className="font-display text-lg font-semibold text-mata-escuro">
          {titulo}
        </h2>
        {subtitulo && (
          <p className="mt-0.5 text-sm text-tinta-suave">{subtitulo}</p>
        )}

        {descricao && (
          <p
            className={`mt-4 rounded-lg px-3 py-2.5 text-sm ${
              perigo
                ? 'bg-brasa-claro text-brasa-escuro'
                : 'bg-creme-100 text-tinta-suave'
            }`}
          >
            {descricao}
          </p>
        )}

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
            onClick={onConfirmar}
            disabled={enviando}
            className={`rounded-lg px-4 py-2 text-sm font-bold text-creme-50 transition disabled:cursor-not-allowed disabled:opacity-60 ${
              perigo ? 'bg-brasa hover:bg-brasa-escuro' : 'bg-mata hover:bg-mata-escuro'
            }`}
          >
            {enviando ? 'Aplicando…' : rotuloConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
