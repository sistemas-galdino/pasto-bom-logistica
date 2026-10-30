// Barra de navegação inferior, no formato de aplicativo — SÓ no celular
// (abaixo de md). No desktop o menu lateral segue sendo a única navegação.
//
// Ordem fixa pedida pela Natália (30/10/2026): Menu primeiro, depois
// Dashboard, Agenda e Quadro de pedidos. Todo o resto mora no Menu, que abre a
// gaveta com o menu completo e o mesmo filtro de papel da Sidebar.

import React from 'react';
import { NavLink } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { secoesVisiveis } from './Sidebar';
import type { NavItem } from './navConfig';

// Só estes viram atalho. Um que o papel não vê simplesmente não aparece — a
// vaga não é preenchida por outro, para a barra ser sempre a mesma.
const ATALHOS = ['/dashboard', '/agenda', '/entregas'];

interface BarraInferiorProps {
  onOpenMenu: () => void;
}

export function BarraInferior({ onOpenMenu }: BarraInferiorProps): React.ReactElement {
  const { papel } = useAuth();
  const itens = secoesVisiveis(papel).flatMap((s) => s.itens);
  const atalhos = ATALHOS.map((to) => itens.find((i) => i.to === to)).filter(
    (i): i is NavItem => i != null,
  );

  return (
    <nav
      aria-label="Navegação principal"
      className="shrink-0 border-t border-linha bg-papel pb-[env(safe-area-inset-bottom)] shadow-carta md:hidden"
    >
      <ul className="flex items-stretch justify-around">
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
                    {/* Quebra em duas linhas em vez de cortar: "Quadro de
                        pedidos" não cabe numa linha em tela de 360px. */}
                    <span className="max-w-full text-center leading-tight">
                      {item.rotulo}
                    </span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
