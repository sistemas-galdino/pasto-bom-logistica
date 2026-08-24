// Metadados de apresentação dos status logísticos (rótulos e cores).
// Paleta "Campo Claro": creme + verdes do agro + acentos quentes.

import type { StatusEntrega, StatusLogistico } from '@pastobom/shared';

export interface StatusMeta {
  rotulo: string;
  /** Classes Tailwind do badge/pílula (fundo + texto). */
  badge: string;
  /** Classe de cor da faixa/ponto de acento da coluna e do cartão. */
  faixa: string;
}

export const STATUS_META: Record<StatusLogistico, StatusMeta> = {
  pendente: {
    rotulo: 'Pendente',
    badge: 'bg-creme-100 text-tinta-suave',
    faixa: 'bg-pedra',
  },
  agendada: {
    rotulo: 'Agendada',
    badge: 'bg-folha-claro text-mata',
    faixa: 'bg-folha',
  },
  em_rota: {
    rotulo: 'Em rota',
    badge: 'bg-trigo-claro text-trigo-escuro',
    faixa: 'bg-trigo',
  },
  entregue: {
    rotulo: 'Entregue',
    badge: 'bg-mata-claro text-mata-escuro',
    faixa: 'bg-mata',
  },
  nao_realizado: {
    rotulo: 'Não realizado',
    badge: 'bg-brasa-claro text-brasa-escuro',
    faixa: 'bg-brasa',
  },
  cancelada: {
    rotulo: 'Cancelada',
    badge: 'bg-terra-claro text-terra-escuro',
    faixa: 'bg-terra',
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

/**
 * Texto do botão que EXECUTA uma transição, indexado pelo par (de -> para).
 *
 * Por que um mapa por par, e não um campo `acao` no metadado do status: o campo
 * antigo carregava uma ambiguidade que virou bug em produção. As strings foram
 * escritas com a semântica de ORIGEM ("como se sai deste estado"), e o cartão
 * as lia pelo DESTINO — então um cartão em Agendada mostrava "Marcar entregue",
 * que é a ação de quem já está EM ROTA. A Natália reclamou disso; ela estava
 * certa. Indexar por origem consertaria hoje e voltaria a quebrar no dia em que
 * um estado tivesse dois avanços na tela.
 *
 * Aqui o par é explícito: não há como ler errado, e os botões que antes tinham
 * texto fixo no componente ("Desfazer", "Não realizado") passam a ter uma fonte
 * só. Fica no frontend, junto das classes Tailwind, porque é texto de botão da
 * casca web — o vocabulário que o backend usa em mensagens de erro é o
 * ROTULO_STATUS_ENTREGA de @pastobom/shared.
 */
export const ACAO_ENTREGA: Record<
  StatusEntrega,
  Partial<Record<StatusEntrega, string>>
> = {
  agendada: { em_rota: 'Pôr em rota', cancelada: 'Desfazer' },
  em_rota: { entregue: 'Marcar entregue', nao_realizado: 'Não realizado' },
  // Terminais: não se sai deles por avanço (de nao_realizado, agenda-se outra
  // viagem; de entregue e cancelada, não se sai).
  entregue: {},
  nao_realizado: {},
  cancelada: {},
};

/**
 * Rótulo do botão da transição `de -> para`.
 *
 * O fallback para o nome do estado de destino existe só para não quebrar a tela
 * se alguém acrescentar uma transição na máquina de estados e esquecer o texto
 * aqui — nesse caso o botão diz o nome do estado, que é feio mas verdadeiro.
 */
export function rotuloAcaoEntrega(
  de: StatusEntrega,
  para: StatusEntrega,
): string {
  return ACAO_ENTREGA[de][para] ?? STATUS_ENTREGA_META[para].rotulo;
}

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
