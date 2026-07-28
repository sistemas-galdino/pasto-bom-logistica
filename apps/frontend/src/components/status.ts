// Metadados de apresentação dos status logísticos (rótulos e cores).
// Paleta "Campo Claro": creme + verdes do agro + acentos quentes.

import type { StatusEntrega, StatusLogistico } from '@pastobom/shared';

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

// ---------------------------------------------------------------------------
// Status da ENTREGA (a viagem) — Onda 2
// ---------------------------------------------------------------------------

/**
 * Metadados de apresentação dos status de VIAGEM.
 *
 * Os nomes coincidem com os do pedido, mas os tipos são distintos de propósito
 * (ver StatusEntrega em @pastobom/shared) — este mapa existe para o TypeScript
 * cobrar a diferença em vez de deixar os dois se misturarem.
 *
 * As cores são as MESMAS do quadro: a legenda da agenda, a bolinha do cartão
 * compacto e a coluna do kanban têm de contar a mesma história.
 */
export const STATUS_ENTREGA_META: Record<StatusEntrega, StatusMeta> = {
  agendada: STATUS_META.agendada,
  em_rota: STATUS_META.em_rota,
  entregue: STATUS_META.entregue,
  nao_realizado: STATUS_META.nao_realizado,
  cancelada: STATUS_META.cancelada,
};

/** Colunas de VIAGEM no quadro. A coluna Pendente mostra pedidos com saldo. */
export const COLUNAS_ENTREGA: StatusEntrega[] = [
  'agendada',
  'em_rota',
  'entregue',
  'nao_realizado',
];

// ---------------------------------------------------------------------------
// Status do ÓRIX (o status da ordem de venda no ERP, diferente do logístico)
// ---------------------------------------------------------------------------

/**
 * Os três status do Órix que chegam ao quadro (a lista-gatilho da ingestão).
 *
 * `rotulo` é o nome CURTO pedido na reunião de 16/07/2026: o nome que o Órix
 * devolve ("Venda aguardando entrega para faturamento") não cabe no cartão e
 * empurrava o resto da informação para fora. O nome longo continua visível no
 * `title` (tooltip) e é o que se lê nos filtros, para ninguém ficar na dúvida
 * sobre qual status do ERP é qual.
 */
export interface StatusOrixMeta {
  codigo: string;
  /** Nome curto, usado no cartão e no botão de filtro. */
  rotulo: string;
  /** Nome do status no Órix — vai no tooltip e na descrição do filtro. */
  descricao: string;
}

export const STATUS_ORIX_META: StatusOrixMeta[] = [
  {
    codigo: '00041',
    rotulo: 'Aguardando entrega',
    descricao: 'Venda aguardando entrega para faturamento',
  },
  {
    codigo: '00045',
    rotulo: 'Sem reserva de estoque',
    descricao: 'Venda entrega futura (sem reserva estoque)',
  },
  {
    codigo: '00027',
    rotulo: 'Parcial',
    descricao: 'Venda aguardando faturamento (parcial)',
  },
];

/**
 * Nome curto de um status do Órix. Se o código não for um dos conhecidos
 * (a lista-gatilho é configurável em sync_state e pode crescer sem novo
 * deploy), devolve o nome que veio do próprio Órix — melhor um rótulo longo do
 * que um cartão sem informação nenhuma.
 */
export function rotuloStatusOrix(codigo: string, nomeOrix: string): string {
  const meta = STATUS_ORIX_META.find((s) => s.codigo === codigo);
  return meta ? meta.rotulo : nomeOrix;
}

/** Todos os status, na ordem do fluxo (reusado por Board e Dashboard). */
export const TODOS_STATUS: StatusLogistico[] = [
  'pendente',
  'agendada',
  'em_rota',
  'entregue',
  'nao_realizado',
  'cancelada',
];
