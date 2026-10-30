// Barra superior da casca: hambúrguer (tablet; no celular o menu fica na
// BarraInferior), título/subtítulo da rota atual
// e indicadores à direita (status do sistema + sino decorativo).

import React from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, Menu } from 'lucide-react';
import { ROTAS_META } from './navConfig';
import { StatusSincronizacao } from '../StatusSincronizacao';

interface TopbarProps {
  onOpenMenu: () => void;
}

const META_PADRAO = {
  titulo: 'Pasto Bom',
  subtitulo: 'Logística Inteligente',
};

export function Topbar({ onOpenMenu }: TopbarProps): React.ReactElement {
  const { pathname } = useLocation();
  const meta = ROTAS_META[pathname] ?? META_PADRAO;

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-linha bg-creme/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur sm:px-8 sm:pb-4 sm:pt-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir menu"
          className="hidden rounded-lg border border-linha bg-papel p-2 text-tinta-suave transition hover:border-mata/40 hover:text-mata md:inline-flex lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="leading-tight">
          <h1 className="text-xl font-extrabold tracking-tight text-tinta sm:text-[28px]">
            {meta.titulo}
          </h1>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-tinta-suave">
            {meta.subtitulo}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-2 rounded-full bg-folha-claro px-3 py-1 text-xs font-semibold text-mata sm:inline-flex">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-folha opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-folha" />
          </span>
          Sistema Operacional
        </span>
        <StatusSincronizacao />
        <button
          type="button"
          aria-label="Notificações"
          className="rounded-lg border border-linha bg-papel p-2 text-tinta-suave transition hover:border-mata/40 hover:text-mata"
        >
          <Bell className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
