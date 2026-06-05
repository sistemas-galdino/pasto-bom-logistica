// Cabeçalho do app: marca, papel do usuário e ação de sair.

import React from 'react';
import { useAuth, type Papel } from '../auth/AuthProvider';

const PAPEL_ROTULO: Record<Papel, string> = {
  logistica: 'Logística',
  vendedor: 'Vendedor',
  motorista: 'Motorista',
};

const PAPEL_BADGE: Record<Papel, string> = {
  logistica: 'bg-emerald-100 text-emerald-700',
  vendedor: 'bg-indigo-100 text-indigo-700',
  motorista: 'bg-amber-100 text-amber-700',
};

export function Header(): React.ReactElement {
  const { user, papel, podeEscrever, sair } = useAuth();

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-lg">
          🐂
        </span>
        <div className="leading-tight">
          <h1 className="text-sm font-semibold text-slate-800">Pasto Bom</h1>
          <p className="text-[11px] text-slate-400">Logística</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-xs font-medium text-slate-600">
            {user?.email ?? '—'}
          </p>
          {papel && (
            <p className="text-[11px] text-slate-400">
              {podeEscrever ? 'Acesso de edição' : 'Somente leitura'}
            </p>
          )}
        </div>
        {papel && (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${PAPEL_BADGE[papel]}`}
          >
            {PAPEL_ROTULO[papel]}
          </span>
        )}
        <button
          type="button"
          onClick={() => void sair()}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
        >
          Sair
        </button>
      </div>
    </header>
  );
}
