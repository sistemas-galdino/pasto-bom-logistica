// Menu lateral da casca de dashboard: marca, navegação por seções e bloco do
// usuário. Verde-mata escuro com texto creme; item ativo destacado em trigo.
// Colapsa no desktop (chevron) e fecha no mobile (X).

import React from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronLeft, ChevronRight, LogOut, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { Marca } from '../Marca';
import { PAPEL_ROTULO, PAPEL_ACESSO } from '../../lib/papeis';
import { NAV_SECTIONS } from './navConfig';

interface SidebarProps {
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  onClose,
  collapsed,
  onToggleCollapse,
}: SidebarProps): React.ReactElement {
  const { user, papel, sair } = useAuth();

  return (
    <aside className="flex h-full w-full flex-col bg-mata-escuro text-creme-100">
      {/* Cabeçalho: marca + fechar (mobile) */}
      <div className="flex items-center justify-between gap-2 px-4 py-4">
        <div className="flex items-center gap-3 overflow-hidden">
          <Marca className="h-9 w-9 shrink-0 drop-shadow-sm" />
          {!collapsed && (
            <div className="leading-tight">
              <p className="font-display text-base font-semibold text-creme-50">
                Pasto Bom
              </p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-creme-100/60">
                Logística Inteligente
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar menu"
          className="rounded-lg p-1.5 text-creme-100/70 transition hover:bg-mata/50 hover:text-creme-50 lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navegação por seções */}
      <nav className="scroll-suave flex-1 overflow-y-auto px-3 py-2">
        {NAV_SECTIONS.map((secao) => (
          <div key={secao.titulo} className="mb-4">
            {!collapsed && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-creme-100/50">
                {secao.titulo}
              </p>
            )}
            <ul className="space-y-1">
              {secao.itens.map((item) => {
                const Icone = item.icone;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end
                      onClick={onClose}
                      title={collapsed ? item.rotulo : undefined}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-sm font-medium transition ${
                          collapsed ? 'justify-center px-2 ' : ''
                        }${
                          isActive
                            ? 'border-trigo bg-mata text-trigo'
                            : 'border-transparent text-creme-100/80 hover:bg-mata/40 hover:text-creme-50'
                        }`
                      }
                    >
                      <Icone className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>{item.rotulo}</span>}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Recolher (desktop) */}
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        className="mx-3 mb-2 hidden items-center justify-center gap-2 rounded-lg border border-mata/60 px-3 py-2 text-xs font-semibold text-creme-100/70 transition hover:bg-mata/40 hover:text-creme-50 lg:flex"
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <>
            <ChevronLeft className="h-4 w-4" />
            <span>Recolher</span>
          </>
        )}
      </button>

      {/* Rodapé: usuário + sair */}
      <div className="border-t border-mata/60 px-3 py-3">
        <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mata text-sm font-bold text-trigo">
            {(user?.email ?? '?').charAt(0).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-xs font-semibold text-creme-50">
                {user?.email ?? '—'}
              </p>
              {papel && (
                <p className="truncate text-[11px] text-creme-100/60">
                  {PAPEL_ROTULO[papel]} · {PAPEL_ACESSO[papel]}
                </p>
              )}
            </div>
          )}
          {!collapsed && (
            <button
              type="button"
              onClick={() => void sair()}
              aria-label="Sair"
              className="rounded-lg p-2 text-creme-100/70 transition hover:bg-mata/50 hover:text-terra-claro"
            >
              <LogOut className="h-5 w-5" />
            </button>
          )}
        </div>
        {collapsed && (
          <button
            type="button"
            onClick={() => void sair()}
            aria-label="Sair"
            className="mt-2 flex w-full items-center justify-center rounded-lg p-2 text-creme-100/70 transition hover:bg-mata/50 hover:text-terra-claro"
          >
            <LogOut className="h-5 w-5" />
          </button>
        )}
      </div>
    </aside>
  );
}
