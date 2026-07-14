// Tipos de domínio (camelCase) usados por backend e frontend.

export type StatusLogistico =
  | 'pendente'
  | 'agendada'
  | 'em_rota'
  | 'entregue'
  /** Saiu para entrega e não deu: cliente ausente, porteira fechada, chuva… */
  | 'nao_realizado'
  | 'cancelada';

/** Período de entrega. A reunião decidiu planejar por turno, não por horário. */
export type PeriodoEntrega = 'manha' | 'tarde';

export interface ItemPedido {
  id: string;
  produtoCodigo: string;
  nomeProduto: string;
  qtd: number;
  valorUnit: number;
  total: number;
  /** RF-2.2: marca de separação de mercadoria (Fase 2). */
  separado: boolean;
  /**
   * Peso UNITÁRIO do produto em kg (tabela produtos_peso), ou null quando ainda
   * não se sabe o peso — aí a equipe digita no agendamento. Nunca vem da API do
   * Órix, cujo campo `peso` é inutilizável (ver packages/shared/src/peso.ts).
   */
  pesoUnitKg: number | null;
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
  /** Turno da entrega, escolhido no agendamento (junto com data/motorista/caminhão). */
  periodo: PeriodoEntrega | null;
  dataEntregue: string | null;
  /** Fase 3: motorista atribuído ao pedido (auth.uid). */
  motoristaId: string | null;
  /** Fase 3: nome do motorista resolvido via profiles (pode ser vazio). */
  motoristaNome: string | null;
  /** Caminhão que leva a carga; escolhido no agendamento, separado do motorista. */
  caminhaoId: string | null;
  caminhaoNome: string | null;
  /**
   * Bairro do cliente. Entregas são rurais (sem rua/número): o motorista se
   * orienta por bairro + cidade + nome do cliente.
   */
  bairro: string | null;
  /**
   * Peso total da carga em kg = Σ(pesoUnitKg × qtd).
   * `null` quando ALGUM item ainda está sem peso — nesse caso o pedido não pode
   * ser agendado até a equipe completar os pesos que faltam.
   */
  pesoTotalKg: number | null;
  /** Observação livre (ex.: anotação do motorista na entrega). */
  observacoes?: string | null;
  /**
   * Por que a entrega não foi realizada. Obrigatório na transição para
   * `nao_realizado` — sem o motivo, a logística não sabe o que remarcar.
   */
  motivoNaoEntrega?: string | null;
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
// Carga: caminhões e peso dos produtos
// ---------------------------------------------------------------------------

/** Caminhão da frota, com a capacidade máxima que pode carregar. */
export interface Caminhao {
  id: string;
  nome: string;
  placa: string | null;
  /** Capacidade máxima em kg (a tela mostra em toneladas). */
  capacidadeKg: number;
  ativo: boolean;
}

/** Peso unitário conhecido de um produto (tabela produtos_peso). */
export interface PesoProduto {
  produtoCodigo: string;
  nomeProduto: string | null;
  pesoKg: number;
  /** 'auto' = extraído do nome pelo parser; 'manual' = digitado pela equipe. */
  origem: 'auto' | 'manual';
  atualizadoEm: string;
}

// ---------------------------------------------------------------------------
// Agenda (calendário de entregas — mês/semana/dia)
// ---------------------------------------------------------------------------

/** Entrega como aparece no card da agenda. */
export interface AgendaEntrega {
  pedidoId: string;
  orixNumero: string;
  clienteNome: string;
  /** O vendedor usa o bairro para saber se "cabe" mais uma entrega na região. */
  bairro: string | null;
  cidade: string;
  motoristaId: string | null;
  motoristaNome: string | null;
  caminhaoId: string | null;
  caminhaoNome: string | null;
  pesoTotalKg: number | null;
  statusLogistico: StatusLogistico;
}

/** Ocupação de um caminhão dentro de um slot (data + período). */
export interface AgendaOcupacao {
  caminhaoId: string;
  caminhaoNome: string;
  capacidadeKg: number;
  usadoKg: number;
  /** Motorista que leva esse caminhão no slot (o par é único por slot). */
  motoristaId: string | null;
  motoristaNome: string | null;
  entregas: number;
}

/** Um slot da agenda: um período (manhã ou tarde) de um dia. */
export interface AgendaSlot {
  /** Data ISO (YYYY-MM-DD). */
  data: string;
  periodo: PeriodoEntrega;
  entregas: AgendaEntrega[];
  ocupacao: AgendaOcupacao[];
}

/** Resposta de GET /api/agenda?de=&ate= — só os slots com alguma entrega. */
export interface AgendaResposta {
  slots: AgendaSlot[];
  /** Frota ativa, para a tela mostrar capacidade total mesmo em slot vazio. */
  caminhoes: Caminhao[];
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
