// Fonte única de navegação da casca de dashboard: seções do menu lateral
// (consumidas pela Sidebar) e metadados de título/subtítulo por rota
// (consumidos pela Topbar).

import { LayoutDashboard, Package, Route, UserCog, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Papel } from '../../auth/AuthProvider';

export interface NavItem {
  rotulo: string;
  to: string;
  icone: LucideIcon;
}

export interface NavSection {
  titulo: string;
  /** Se definido, a seção só aparece para estes papéis. */
  papeis?: Papel[];
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
  {
    titulo: 'Administração',
    papeis: ['logistica'],
    itens: [{ rotulo: 'Usuários', to: '/usuarios', icone: UserCog }],
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
  '/usuarios': { titulo: 'Usuários', subtitulo: 'Acessos e papéis da equipe' },
};
