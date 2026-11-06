// Marca de "reserva concluída" (0026) e o botão que a liga e desliga.
//
// Um componente só para os quatro lugares onde a reserva aparece — agenda,
// agendamento, quadro e a rota do motorista — para o botão dizer a mesma coisa
// e invalidar as mesmas listas em todos eles. Quem PODE concluir é decidido por
// quem usa: a logística em qualquer reserva, o motorista nas dele de hoje (o
// servidor confere as duas regras de novo).

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';

/** Selo verde mostrado no card da reserva já concluída. */
export function SeloReservaConcluida(): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-mata-claro px-2 py-0.5 text-[11px] font-bold text-mata-escuro">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
      Concluída
    </span>
  );
}

interface Props {
  reservaId: string;
  concluida: boolean;
  /** Botão mais largo (app do motorista) ou compacto (cards da equipe). */
  grande?: boolean;
}

export function BotaoConcluirReserva({
  reservaId,
  concluida,
  grande = false,
}: Props): React.ReactElement {
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);

  const mutacao = useMutation({
    mutationFn: (valor: boolean) => api.concluirReserva(reservaId, valor),
    onSuccess: () => {
      setErro(null);
      // Todas as telas que mostram ou contam reserva.
      for (const chave of ['agenda', 'reservas', 'minhas-reservas', 'reservas-dia']) {
        void queryClient.invalidateQueries({ queryKey: [chave] });
      }
    },
    onError: (err) => {
      setErro(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Não foi possível gravar a conclusão.',
      );
    },
  });

  const tamanho = grande ? 'px-3 py-2.5 text-sm' : 'px-2.5 py-1.5 text-xs';

  return (
    <div className={grande ? 'w-full' : ''}>
      <button
        type="button"
        onClick={(e) => {
          // O card da agenda pode ser clicável: o botão não abre o detalhe.
          e.stopPropagation();
          mutacao.mutate(!concluida);
        }}
        disabled={mutacao.isPending}
        title={
          concluida
            ? 'Volta a reserva para "não concluída".'
            : 'O serviço foi feito: conta como viagem do motorista.'
        }
        className={`rounded-lg font-semibold transition disabled:opacity-60 ${tamanho} ${
          grande ? 'w-full' : ''
        } ${
          concluida
            ? 'border border-linha bg-papel text-tinta-suave hover:bg-creme-100'
            : 'bg-mata font-bold text-creme-50 hover:bg-mata-escuro'
        }`}
      >
        {mutacao.isPending
          ? 'Gravando…'
          : concluida
            ? 'Desfazer conclusão'
            : 'Marcar como concluída'}
      </button>
      {erro && <p className="mt-1 text-[11px] text-brasa-escuro">{erro}</p>}
    </div>
  );
}
