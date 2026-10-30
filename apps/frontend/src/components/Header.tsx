// Cabeçalho do app: marca, identidade do usuário (papel) e ação de sair.

import React from 'react';
import { useAuth } from '../auth/AuthProvider';
import { PAPEL_ROTULO, PAPEL_BADGE, PAPEL_ACESSO } from '../lib/papeis';
import { MarcaOficial } from './Marca';
import { StatusSincronizacao } from './StatusSincronizacao';

export function Header(): React.ReactElement {
  const { user, papel, sair } = useAuth();

  return (
    <header className="sticky top-0 z-20 border-b border-linha bg-creme-50/85 backdrop-blur">
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
        <h1 className="shrink-0">
          <MarcaOficial className="h-10 w-auto sm:h-11" />
        </h1>

        <div className="flex items-center gap-3">
          <StatusSincronizacao />
          <div className="hidden text-right sm:block">
            <p className="text-xs font-semibold text-tinta">
              {user?.email ?? '—'}
            </p>
            {papel && (
              <p className="text-[11px] text-tinta-suave">{PAPEL_ACESSO[papel]}</p>
            )}
          </div>
          {papel && (
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${PAPEL_BADGE[papel]}`}
            >
              {PAPEL_ROTULO[papel]}
            </span>
          )}
          <button
            type="button"
            onClick={() => void sair()}
            className="rounded-lg border border-linha bg-papel px-3 py-1.5 text-xs font-semibold text-tinta-suave transition hover:border-mata/40 hover:text-mata"
          >
            Sair
          </button>
        </div>
      </div>
    </header>
  );
}
