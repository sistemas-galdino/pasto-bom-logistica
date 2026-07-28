// Modal da transição em_rota -> nao_realizado: pergunta POR QUE a entrega não
// aconteceu. O motivo é obrigatório (o backend recusa com 422 `motivo_obrigatorio`)
// porque é ele que diz à logística o que precisa ser resolvido antes de remarcar.
// Como a venda continua de pé, isto NÃO é cancelamento e o cliente NÃO é avisado.
//
// O motivo vem de uma LISTA FECHADA, cadastrada pela logística na tela de
// Motivos (reunião de 16/07/2026). Não há campo de texto livre: com cada pessoa
// escrevendo o seu, o filtro por motivo deixaria de significar qualquer coisa.

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Entrega } from '@pastobom/shared';
import { api } from '../lib/api';

interface Props {
  entrega: Entrega;
  enviando: boolean;
  erro: string | null;
  onConfirmar: (motivo: string) => void;
  onCancelar: () => void;
}

export function NaoRealizadoModal({
  entrega,
  enviando,
  erro,
  onConfirmar,
  onCancelar,
}: Props): React.ReactElement {
  const [motivo, setMotivo] = useState('');

  // A lista muda pouco: cacheia por 5 min para o modal abrir instantâneo.
  const motivosQuery = useQuery({
    queryKey: ['motivos'],
    queryFn: ({ signal }) => api.listarMotivos(false, signal),
    staleTime: 5 * 60_000,
  });

  const motivos = motivosQuery.data ?? [];
  const semMotivo = motivo === '';
  // Lista vazia trava o registro — e a mensagem tem que dizer o que fazer,
  // senão o motorista fica olhando um select vazio sem entender.
  const listaVazia = !motivosQuery.isLoading && motivos.length === 0;

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
          Pedido nº {entrega.orixNumero || '—'} —{' '}
          {entrega.clienteNome || entrega.clienteCodigo}
        </p>

        <p className="mt-4 rounded-lg bg-brasa-claro px-3 py-2.5 text-sm text-brasa-escuro">
          Esta viagem é encerrada e a carga <strong>volta para a fila</strong> do
          pedido, pronta para ser agendada de novo. A venda continua de pé — o
          cliente <strong>não</strong> é notificado.
        </p>

        <div className="mt-4">
          <label
            htmlFor="motivo-nao-entrega"
            className="text-sm font-semibold text-tinta"
          >
            Por que a entrega não foi realizada?
          </label>

          <select
            id="motivo-nao-entrega"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            disabled={enviando || motivosQuery.isLoading || listaVazia}
            autoFocus
            className="mt-2 w-full rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition focus:border-mata/40 focus:bg-papel disabled:opacity-60"
          >
            <option value="">
              {motivosQuery.isLoading
                ? 'Carregando motivos…'
                : 'Escolha o motivo…'}
            </option>
            {motivos.map((m) => (
              <option key={m.id} value={m.descricao}>
                {m.descricao}
              </option>
            ))}
          </select>

          <p className="mt-1 text-[11px] text-pedra">
            {listaVazia
              ? 'Nenhum motivo cadastrado. A logística cadastra os motivos na tela Motivos.'
              : 'Obrigatório — é por ele que a logística sabe o que resolver antes de remarcar.'}
          </p>

          {motivosQuery.isError && (
            <p className="mt-1 text-[11px] text-terra-escuro">
              Não foi possível carregar os motivos.{' '}
              <button
                type="button"
                onClick={() => void motivosQuery.refetch()}
                className="font-semibold underline"
              >
                Tentar novamente
              </button>
            </p>
          )}
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
            onClick={() => onConfirmar(motivo)}
            disabled={enviando || semMotivo}
            title={semMotivo ? 'Escolha o motivo da não entrega.' : undefined}
            className="rounded-lg bg-brasa px-4 py-2 text-sm font-bold text-creme-50 transition hover:bg-brasa-escuro disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando ? 'Registrando…' : 'Marcar não realizado'}
          </button>
        </div>
      </div>
    </div>
  );
}
