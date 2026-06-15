// Fonte única de navegação da casca de dashboard: seções do menu lateral
// (consumidas pela Sidebar) e metadados de título/subtítulo por rota
// (consumidos pela Topbar).

import { LayoutDashboard, Package, Route, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  rotulo: string;
  to: string;
  icone: LucideIcon;
}

export interface NavSection {
  titulo: string;
  itens: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    titulo: 'Principal',
    itens: [
      { rotulo: 'Dashboard', to: '/dashboard', icone: LayoutDashboard },
      { rotulo: 'Entregas', to: '/entregas', icone: Package },
    ],
  },
  {
    titulo: 'Operações',
    itens: [
      { rotulo: 'Rotas', to: '/rotas', icone: Route },
      { rotulo: 'Motoristas', to: '/motoristas', icone: Users },
    ],
  },
];

export interface RotaMeta {
  titulo: string;
  subtitulo: string;
}

export const ROTAS_META: Record<string, RotaMeta> = {
  '/dashboard': { titulo: 'Dashboard', subtitulo: 'Visão geral da operação' },
  '/entregas': { titulo: 'Entregas', subtitulo: 'Quadro de pedidos por status' },
  '/rotas': { titulo: 'Rotas', subtitulo: 'Pedidos em rota por motorista' },
  '/motoristas': { titulo: 'Motoristas', subtitulo: 'Equipe e cargas em rota' },
};
