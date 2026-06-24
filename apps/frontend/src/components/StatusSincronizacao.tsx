// Indicador discreto da última sincronização com o Órix (heartbeat do worker).
// Mostrado no cabeçalho global: ajuda a logística a saber se os dados estão
// frescos — importante porque o servidor Órix é instável e às vezes cai.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { tempoRelativo } from '../lib/format';

export function StatusSincronizacao(): React.ReactElement | null {
  const { data } = useQuery({
    queryKey: ['sync-status'],
    queryFn: ({ signal }) => api.statusSync(signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!data) return null;

  const { ultimoSucesso, sucesso } = data;
  // Só alarma (âmbar) se JÁ houve sucesso antes e a última tentativa falhou.
  // Antes da 1ª sincronização (ultimoSucesso null) é só "aguardando", sem alarme.
  const instavel = !sucesso && ultimoSucesso != null;

  const titulo = ultimoSucesso
    ? `Última sincronização com o Órix: ${new Date(ultimoSucesso).toLocaleString('pt-BR')}` +
      (instavel ? ' · a última tentativa falhou (Órix instável)' : '')
    : 'Aguardando a primeira sincronização com o Órix';

  const texto = ultimoSucesso
    ? `Órix · atualizado ${tempoRelativo(ultimoSucesso)}`
    : 'Órix · aguardando sincronização';

  return (
    <div
      title={titulo}
      className="hidden items-center gap-1.5 text-[11px] text-tinta-suave sm:flex"
    >
      <span className="relative flex h-4 w-4 items-center justify-center">
        <RefreshCw className="h-3.5 w-3.5 text-pedra" aria-hidden="true" />
        {instavel && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-trigo-escuro ring-1 ring-papel" />
        )}
      </span>
      <span className={instavel ? 'font-medium text-trigo-escuro' : undefined}>
        {texto}
      </span>
    </div>
  );
}
