// Casca da aplicação (rota de layout): menu lateral + barra superior + conteúdo.
// Sidebar fixa e colapsável no desktop; em gaveta com overlay no mobile.

import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell(): React.ReactElement {
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Fecha a gaveta ao navegar entre rotas.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const fecharDrawer = () => setDrawerOpen(false);
  const alternarColapso = () => setCollapsed((v) => !v);

  return (
    <div className="flex h-screen overflow-hidden bg-creme">
      {/* Sidebar desktop */}
      <div
        className={`hidden shrink-0 transition-[width] duration-300 lg:flex ${
          collapsed ? 'w-[76px]' : 'w-64'
        }`}
      >
        <Sidebar
          collapsed={collapsed}
          onToggleCollapse={alternarColapso}
          onClose={fecharDrawer}
        />
      </div>

      {/* Overlay (mobile) */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-mata-escuro/40 lg:hidden"
          onClick={fecharDrawer}
          aria-hidden="true"
        />
      )}

      {/* Gaveta (mobile) */}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-300 lg:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar
          collapsed={false}
          onToggleCollapse={alternarColapso}
          onClose={fecharDrawer}
        />
      </div>

      {/* Coluna de conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setDrawerOpen(true)} />
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
