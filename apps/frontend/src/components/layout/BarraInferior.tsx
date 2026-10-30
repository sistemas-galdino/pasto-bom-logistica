// Barra de navegação inferior, no formato de aplicativo — SÓ no celular
// (abaixo de md). No desktop o menu lateral segue sendo a única navegação.
//
// Mostra até quatro atalhos e um "Menu" que abre a gaveta com o menu completo:
// o que não cabe aqui continua a um toque de distância, com o mesmo filtro de
// papel da Sidebar.

import React from 'react';
import { NavLink } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { secoesVisiveis } from './Sidebar';
import type { NavItem } from './navConfig';

// Ordem de preferência dos atalhos. Os que o papel não vê são pulados e o
// próximo da lista ocupa a vaga.
const ATALHOS_PREFERIDOS = [
  '/dashboard',
  '/agendamento',
  '/entregas',
  '/agenda',
  '/separacao',
  '/rotas',
];
const MAX_ATALHOS = 4;

interface BarraInferiorProps {
  onOpenMenu: () => void;
}

export function BarraInferior({ onOpenMenu }: BarraInferiorProps): React.ReactElement {
  const { papel } = useAuth();
  const itens = secoesVisiveis(papel).flatMap((s) => s.itens);
  const atalhos = ATALHOS_PREFERIDOS.map((to) => itens.find((i) => i.to === to))
    .filter((i): i is NavItem => i != null)
    .slice(0, MAX_ATALHOS);

  return (
    <nav
      aria-label="Navegação principal"
      className="shrink-0 border-t border-linha bg-papel pb-[env(safe-area-inset-bottom)] shadow-carta md:hidden"
    >
      <ul className="flex items-stretch justify-around">
        {atalhos.map((item) => {
          const Icone = item.icone;
          return (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                end
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 px-1 pb-2 pt-2.5 text-[11px] font-semibold transition ${
                    isActive ? 'text-mata' : 'text-tinta-suave'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`flex h-8 w-14 items-center justify-center rounded-full transition ${
                        isActive ? 'bg-folha-claro' : ''
                      }`}
                    >
                      <Icone className="h-5 w-5" />
                    </span>
                    <span className="max-w-full truncate">{item.rotulo}</span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
        <li className="flex-1">
          <button
            type="button"
            onClick={onOpenMenu}
            className="flex w-full flex-col items-center gap-1 px-1 pb-2 pt-2.5 text-[11px] font-semibold text-tinta-suave"
          >
            <span className="flex h-8 w-14 items-center justify-center rounded-full">
              <Menu className="h-5 w-5" />
            </span>
            <span>Menu</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
