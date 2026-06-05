// Metadados de apresentação dos status logísticos (rótulos e cores).

import type { StatusLogistico } from '@pastobom/shared';

export interface StatusMeta {
  rotulo: string;
  /** Classes Tailwind do badge (texto + fundo). */
  badge: string;
  /** Classe da faixa de cor do topo da coluna. */
  faixa: string;
  /** Botão primário da transição (texto exibido na ação). */
  acao: string;
}

export const STATUS_META: Record<StatusLogistico, StatusMeta> = {
  pendente: {
    rotulo: 'Pendente',
    badge: 'bg-slate-100 text-slate-600',
    faixa: 'bg-slate-400',
    acao: 'Agendar',
  },
  agendada: {
    rotulo: 'Agendada',
    badge: 'bg-blue-100 text-blue-700',
    faixa: 'bg-blue-500',
    acao: 'Pôr em rota',
  },
  em_rota: {
    rotulo: 'Em rota',
    badge: 'bg-amber-100 text-amber-700',
    faixa: 'bg-amber-500',
    acao: 'Marcar entregue',
  },
  entregue: {
    rotulo: 'Entregue',
    badge: 'bg-emerald-100 text-emerald-700',
    faixa: 'bg-emerald-500',
    acao: 'Concluído',
  },
  cancelada: {
    rotulo: 'Cancelada',
    badge: 'bg-red-100 text-red-700',
    faixa: 'bg-red-400',
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
