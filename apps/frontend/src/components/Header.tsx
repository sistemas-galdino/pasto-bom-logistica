// Cabeçalho do app: marca, identidade do usuário (papel) e ação de sair.

import React from 'react';
import { useAuth } from '../auth/AuthProvider';
import { PAPEL_ROTULO, PAPEL_BADGE, PAPEL_ACESSO } from '../lib/papeis';
import { Marca } from './Marca';
import { StatusSincronizacao } from './StatusSincronizacao';

export function Header(): React.ReactElement {
  const { user, papel, sair } = useAuth();

  return (
    <header className="sticky top-0 z-20 border-b border-linha bg-creme-50/85 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Marca className="h-9 w-9 shrink-0 drop-shadow-sm" />
          <div className="leading-tight">
            <h1 className="font-display text-lg font-semibold text-mata-escuro">
              Pasto Bom
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-tinta-suave">
              Logística Inteligente
            </p>
          </div>
        </div>

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
