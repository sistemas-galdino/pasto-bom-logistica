// Metadados de apresentação dos status logísticos (rótulos e cores).
// Paleta "Campo Claro": creme + verdes do agro + acentos quentes.

import type { StatusLogistico } from '@pastobom/shared';

export interface StatusMeta {
  rotulo: string;
  /** Classes Tailwind do badge/pílula (fundo + texto). */
  badge: string;
  /** Classe de cor da faixa/ponto de acento da coluna e do cartão. */
  faixa: string;
  /** Texto do botão primário da transição. */
  acao: string;
}

export const STATUS_META: Record<StatusLogistico, StatusMeta> = {
  pendente: {
    rotulo: 'Pendente',
    badge: 'bg-creme-100 text-tinta-suave',
    faixa: 'bg-pedra',
    acao: 'Agendar',
  },
  agendada: {
    rotulo: 'Agendada',
    badge: 'bg-folha-claro text-mata',
    faixa: 'bg-folha',
    acao: 'Pôr em rota',
  },
  em_rota: {
    rotulo: 'Em rota',
    badge: 'bg-trigo-claro text-trigo-escuro',
    faixa: 'bg-trigo',
    acao: 'Marcar entregue',
  },
  entregue: {
    rotulo: 'Entregue',
    badge: 'bg-mata-claro text-mata-escuro',
    faixa: 'bg-mata',
    acao: 'Concluído',
  },
  cancelada: {
    rotulo: 'Cancelada',
    badge: 'bg-terra-claro text-terra-escuro',
    faixa: 'bg-terra',
    acao: '',
  },
};

/** Colunas exibidas no kanban (a coluna principal), na ordem do fluxo. */
export const COLUNAS_KANBAN: StatusLogistico[] = [
  'pendente',
  'agendada',
  'em_rota',
  'entregue',
];

/** Cor hex de cada status (espelha o token "faixa" do STATUS_META), para
 *  gráficos recharts e outros consumidores fora do Tailwind. */
export const STATUS_HEX: Record<StatusLogistico, string> = {
  pendente: '#A8A293', // pedra
  agendada: '#3C7D52', // folha
  em_rota: '#C08A2D', // trigo
  entregue: '#1C4E37', // mata
  cancelada: '#B25A33', // terra
};

/** Todos os status, na ordem do fluxo (reusado por Board e Dashboard). */
export const TODOS_STATUS: StatusLogistico[] = [
  'pendente',
  'agendada',
  'em_rota',
  'entregue',
  'cancelada',
];
