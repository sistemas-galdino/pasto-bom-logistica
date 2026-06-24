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

// ---------------------------------------------------------------------------
// Administração de usuários (console da logística)
// ---------------------------------------------------------------------------

/** Papel/setor de um usuário do sistema (espelha profiles.papel). */
export type PapelUsuario =
  | 'logistica'
  | 'almoxarifado'
  | 'vendedor'
  | 'motorista';

/** Situação de acesso de um usuário no diretório administrativo. */
export type StatusUsuario =
  | 'ativo' // login habilitado e e-mail confirmado
  | 'pendente' // convidado; ainda não definiu a senha / confirmou
  | 'inativo'; // acesso bloqueado (banido)

/** Usuário do sistema na visão do console de administração (logística). */
export interface UsuarioAdmin {
  id: string;
  email: string;
  /** Nome do perfil (profiles.nome); pode ser vazio. */
  nome: string;
  /** Papel do perfil; null se o usuário ainda não tem linha em profiles. */
  papel: PapelUsuario | null;
  status: StatusUsuario;
  /** Último login (auth.users.last_sign_in_at); null se nunca acessou. */
  ultimoAcesso: string | null;
  /** Criação do usuário no Auth (auth.users.created_at). */
  criadoEm: string;
}

/** Corpo do convite de um novo usuário por e-mail. */
export interface ConviteUsuarioRequest {
  email: string;
  nome: string;
  papel: PapelUsuario;
}

/** Atualização de papel e/ou nome de um usuário existente. */
export interface AtualizarUsuarioRequest {
  papel?: PapelUsuario;
  nome?: string;
}

/**
 * Resposta do convite: o usuário criado + o link de acesso a ser repassado
 * (ex.: WhatsApp). O Supabase NÃO envia e-mail; quem entrega o link é a logística.
 */
export interface ConviteUsuarioResposta {
  usuario: UsuarioAdmin;
  link: string;
}

/** Resposta ao (re)gerar um link de acesso para um usuário já existente. */
export interface LinkAcessoResposta {
  link: string;
}
