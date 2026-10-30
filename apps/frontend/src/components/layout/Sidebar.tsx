// Menu lateral da casca de dashboard: marca, navegação por seções e bloco do
// usuário. Verde escuro da paleta (#1C4416), no visual do Cadastro: item ativo
// em pílula verde-clara, demais em branco translúcido. Colapsa no desktop (chevron) e fecha no mobile (X).

import React from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronLeft, ChevronRight, LogOut, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { Marca, MarcaOficial } from '../Marca';
import { PAPEL_ROTULO } from '../../lib/papeis';
import { NAV_SECTIONS, type NavSection } from './navConfig';
import type { Papel } from '../../auth/AuthProvider';

interface SidebarProps {
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/** Item/seção sem `papeis` é livre; com `papeis`, exige papel resolvido e listado. */
function visivelPara(papel: Papel | null, papeis?: Papel[]): boolean {
  return !papeis || (papel != null && papeis.includes(papel));
}

/** Aplica o filtro de papel a seções e itens, descartando seções sem itens. */
export function secoesVisiveis(papel: Papel | null): NavSection[] {
  return NAV_SECTIONS.filter((s) => visivelPara(papel, s.papeis))
    .map((s) => ({ ...s, itens: s.itens.filter((i) => visivelPara(papel, i.papeis)) }))
    .filter((s) => s.itens.length > 0);
}

export function Sidebar({
  onClose,
  collapsed,
  onToggleCollapse,
}: SidebarProps): React.ReactElement {
  const { user, papel, sair } = useAuth();
  const secoes = secoesVisiveis(papel);

  return (
    <aside className="flex h-full w-full flex-col bg-mata text-creme-50">
      {/* Cabeçalho: marca centralizada; o fechar (mobile) fica no canto, fora
          do fluxo, para não empurrar a marca para o lado. */}
      <div className="relative flex items-center justify-center px-4 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
        {collapsed ? (
          <Marca className="h-9 w-9 shrink-0" />
        ) : (
          <div className="rounded-xl bg-papel px-3 py-2">
            <MarcaOficial className="h-12 w-auto" />
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar menu"
          className="absolute right-2 top-[max(0.75rem,env(safe-area-inset-top))] rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navegação por seções (seções e itens com `papeis` só aparecem ao papel certo) */}
      <nav className="scroll-suave flex-1 overflow-y-auto px-3 py-2">
        {secoes.map((secao) => (
          <div key={secao.titulo} className="mb-4">
            {!collapsed && (
              <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
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
                        `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                          collapsed ? 'justify-center px-2 ' : ''
                        }${
                          isActive
                            ? 'bg-folha-claro text-mata'
                            : 'text-white/80 hover:bg-white/10 hover:text-white'
                        }`
                      }
                    >
                      <Icone className="h-5 w-5 shrink-0" strokeWidth={1.75} />
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
        className="mx-3 mb-2 hidden items-center justify-center gap-2 rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white lg:flex"
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
      <div className="mx-3 border-t border-white/15 px-1 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-folha-claro text-sm font-bold text-mata">
              {(user?.email ?? '?').charAt(0).toUpperCase()}
            </div>
            <button
              type="button"
              onClick={() => void sair()}
              aria-label="Sair"
              className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <>
            <p className="truncate text-sm font-semibold text-white">
              {user?.email ?? '—'}
            </p>
            {papel && (
              <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">
                {PAPEL_ROTULO[papel]}
              </p>
            )}
            <button
              type="button"
              onClick={() => void sair()}
              className="mt-3 flex items-center gap-2 text-sm font-medium text-white/70 transition hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
