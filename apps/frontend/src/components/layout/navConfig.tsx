// Fonte única de navegação da casca de dashboard: seções do menu lateral
// (consumidas pela Sidebar) e metadados de título/subtítulo por rota
// (consumidos pela Topbar).

import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Package,
  PackageCheck,
  Route,
  Truck,
  UserCog,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Papel } from '../../auth/AuthProvider';

export interface NavItem {
  rotulo: string;
  to: string;
  icone: LucideIcon;
  /** Se definido, o item só aparece para estes papéis. */
  papeis?: Papel[];
}

export interface NavSection {
  titulo: string;
  /** Se definido, a seção só aparece para estes papéis. */
  papeis?: Papel[];
  itens: NavItem[];
}

// Os RÓTULOS seguem o vocabulário da operação, pedido pela Natália: Principal
// fica só com o painel e a agenda, e o quadro desce para Operações com o nome
// que a equipe usa, "Expedição". Os PATHS não mudam: /entregas e /rotas seguem
// valendo (e /expedicao redireciona para /entregas), para não invalidar link
// salvo de ninguém.
export const NAV_SECTIONS: NavSection[] = [
  {
    titulo: 'Principal',
    itens: [
      { rotulo: 'Dash', to: '/dashboard', icone: LayoutDashboard },
      { rotulo: 'Agenda', to: '/agenda', icone: CalendarDays },
    ],
  },
  {
    titulo: 'Operações',
    // Ordem do fluxo físico: o pedido entra na expedição, é separado, e sai em
    // rota.
    itens: [
      // Sem `papeis` DE PROPÓSITO: o quadro é a tela que todos os papéis de
      // equipe abrem, vendedor incluído. Não restrinja aqui.
      { rotulo: 'Expedição', to: '/entregas', icone: Package },
      {
        rotulo: 'Separação',
        to: '/separacao',
        icone: PackageCheck,
        papeis: ['logistica', 'almoxarifado'],
      },
      { rotulo: 'Rota', to: '/rotas', icone: Route, papeis: ['logistica', 'vendedor'] },
      { rotulo: 'Motoristas', to: '/motoristas', icone: Users, papeis: ['logistica'] },
      { rotulo: 'Caminhões', to: '/caminhoes', icone: Truck, papeis: ['logistica'] },
    ],
  },
  {
    titulo: 'Administração',
    papeis: ['logistica'],
    itens: [
      { rotulo: 'Usuários', to: '/usuarios', icone: UserCog },
      { rotulo: 'Motivos', to: '/motivos', icone: ClipboardList },
    ],
  },
];

export interface RotaMeta {
  titulo: string;
  subtitulo: string;
}

export const ROTAS_META: Record<string, RotaMeta> = {
  '/dashboard': { titulo: 'Dashboard', subtitulo: 'Visão geral da operação' },
  '/entregas': { titulo: 'Expedição', subtitulo: 'Quadro de pedidos por status' },
  '/agenda': { titulo: 'Agenda', subtitulo: 'Entregas por dia e período' },
  '/separacao': {
    titulo: 'Separação',
    subtitulo: 'O que separar no dia, por período',
  },
  '/rotas': { titulo: 'Rota', subtitulo: 'Pedidos em rota por motorista' },
  '/motoristas': { titulo: 'Motoristas', subtitulo: 'Equipe e cargas em rota' },
  '/caminhoes': { titulo: 'Caminhões', subtitulo: 'Frota e capacidade de carga' },
  '/usuarios': { titulo: 'Usuários', subtitulo: 'Acessos e papéis da equipe' },
  '/motivos': {
    titulo: 'Motivos',
    subtitulo: 'Motivos de entrega não realizada',
  },
};
