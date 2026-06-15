// Barra superior da casca: hambúrguer (mobile), título/subtítulo da rota atual
// e indicadores à direita (status do sistema + sino decorativo).

import React from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, Menu } from 'lucide-react';
import { ROTAS_META } from './navConfig';

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
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-linha bg-creme-50/85 px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir menu"
          className="rounded-lg border border-linha bg-papel p-2 text-tinta-suave transition hover:border-mata/40 hover:text-mata lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="leading-tight">
          <h1 className="font-display text-lg font-semibold text-mata-escuro">
            {meta.titulo}
          </h1>
          <p className="text-[11px] text-tinta-suave">{meta.subtitulo}</p>
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
