// Tipos de domínio (camelCase) usados por backend e frontend.

export type StatusLogistico =
  | 'pendente'
  | 'agendada'
  | 'em_rota'
  | 'entregue'
  | 'cancelada';

export interface ItemPedido {
  id: string;
  produtoCodigo: string;
  nomeProduto: string;
  qtd: number;
  valorUnit: number;
  total: number;
  /** RF-2.2: marca de separação de mercadoria (Fase 2). */
  separado: boolean;
}

export interface Pedido {
  id: string;
  orixIdPedido: string;
  orixNumero: string;
  empresa: number;
  clienteCodigo: string;
  clienteNome: string;
  cidadeCliente: string;
  vendedorCodigo: string;
  vendedorNome: string;
  propriedadeCodigo: string | null;
  valorTotal: number;
  dataPedido: string | null;
  statusOrix: string;
  statusOrixNome: string;
  statusLogistico: StatusLogistico;
  dataAgendada: string | null;
  dataEntregue: string | null;
  /** Fase 3: motorista atribuído ao pedido (auth.uid). */
  motoristaId: string | null;
  /** Fase 3: nome do motorista resolvido via profiles (pode ser vazio). */
  motoristaNome: string | null;
  /** Observação livre (ex.: anotação do motorista na entrega). */
  observacoes?: string | null;
  /** Fase 3: destino resolvido (só preenchido na rota do motorista). */
  destino?: DestinoEntrega | null;
  itens: ItemPedido[];
  criadoEm: string;
  atualizadoEm: string;
}

/** Destino de entrega resolvido (propriedade ou, na falta, cliente). */
export interface DestinoEntrega {
  latitude: string;
  longitude: string;
  endereco: string;
  cidade: string;
  uf: string;
}

/** Resumo de motorista para seleção pela logística. */
export interface MotoristaResumo {
  id: string;
  nome: string;
}

export interface Cliente {
  codigo: string;
  nome: string;
  celular: string;
  telefone: string;
  email: string;
  endereco: string;
  cidade: string;
  uf: string;
}

export interface Propriedade {
  codigo: string;
  clienteCodigo: string;
  nome: string;
  endereco: string;
  cidade: string;
  uf: string;
  latitude: string;
  longitude: string;
}
