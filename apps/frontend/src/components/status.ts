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
  nao_realizado: {
    rotulo: 'Não realizado',
    badge: 'bg-brasa-claro text-brasa-escuro',
    faixa: 'bg-brasa',
    // Sem ação de avanço: sai daqui pela REVERSÃO ("Reagendar" -> pendente).
    acao: '',
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
  // Desfecho ruim de uma saída. Fica ao lado de 'entregue' porque é a outra
  // maneira de uma rota terminar — e precisa saltar aos olhos do Johnny.
  'nao_realizado',
];

/** Cor hex de cada status (espelha o token "faixa" do STATUS_META), para
 *  gráficos recharts e outros consumidores fora do Tailwind. */
export const STATUS_HEX: Record<StatusLogistico, string> = {
  pendente: '#A8A293', // pedra
  agendada: '#199A3C', // folha
  em_rota: '#D9AE07', // trigo
  entregue: '#176D2E', // mata
  nao_realizado: '#B3261E', // brasa
  cancelada: '#8C5A2B', // terra
};

/** Todos os status, na ordem do fluxo (reusado por Board e Dashboard). */
export const TODOS_STATUS: StatusLogistico[] = [
  'pendente',
  'agendada',
  'em_rota',
  'entregue',
  'nao_realizado',
  'cancelada',
];
