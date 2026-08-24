// Tipos de domínio (camelCase) usados por backend e frontend.

export type StatusLogistico =
  | 'pendente'
  | 'agendada'
  | 'em_rota'
  | 'entregue'
  /** Saiu para entrega e não deu: cliente ausente, porteira fechada, chuva… */
  | 'nao_realizado'
  | 'cancelada';

/**
 * Status de uma ENTREGA (uma viagem), diferente do status do PEDIDO.
 *
 * O pedido responde "em que situação está a ordem de venda"; a entrega responde
 * "o que aconteceu com esta viagem". Separados de propósito: compartilhar o
 * mesmo tipo convidaria a confundir os dois para sempre.
 *
 * `nao_realizado` é TERMINAL: a viagem morreu. O saldo volta sozinho para o
 * pedido (a entrega deixa de consumir saldo) e remarcar é criar uma entrega
 * nova — o registro da que falhou fica no histórico.
 */
export type StatusEntrega =
  | 'agendada'
  | 'em_rota'
  | 'entregue'
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

// ---------------------------------------------------------------------------
// Entregas (Onda 2): um pedido → N viagens
// ---------------------------------------------------------------------------

/** Um produto dentro de uma viagem, com a quantidade QUE VAI nesta viagem. */
export interface EntregaItem {
  id: string;
  produtoCodigo: string;
  nomeProduto: string;
  /** Quanto deste produto sai NESTA entrega (não é o total do pedido). */
  qtd: number;
  separado: boolean;
  separadoEm: string | null;
  /**
   * Peso unitário do produto em kg, ou null quando ainda não se sabe.
   * Resolvido fora da tabela (produtos_peso), igual ao ItemPedido.
   */
  pesoUnitKg: number | null;
}

/**
 * Uma ENTREGA: uma viagem de parte (ou de tudo) de um pedido.
 *
 * Carrega os dados do pedido/cliente já resolvidos porque é assim que o cartão
 * do quadro precisa deles — o front não faz uma segunda chamada só para saber
 * de quem é a carga.
 */
export interface Entrega {
  id: string;
  pedidoId: string;
  status: StatusEntrega;

  dataAgendada: string;
  periodo: PeriodoEntrega | null;
  motoristaId: string | null;
  motoristaNome: string | null;
  caminhaoId: string | null;
  caminhaoNome: string | null;
  propriedadeCodigo: string | null;

  dataEntregue: string | null;
  motivoNaoEntrega: string | null;
  observacoes: string | null;

  // --- dados do pedido, resolvidos para o cartão ---
  orixNumero: string;
  clienteCodigo: string;
  clienteNome: string;
  cidadeCliente: string;
  bairro: string | null;
  /** Data de ENTRADA da ordem de venda (o cartão mostra; a fila ordena por ela). */
  dataPedido: string | null;

  /** Σ(pesoUnitKg × qtd) desta viagem; null se algum item está sem peso. */
  pesoTotalKg: number | null;
  /**
   * Destino resolvido (propriedade preferida; senão o cliente). Só preenchido
   * na rota do motorista — é o que alimenta o link do Google Maps.
   */
  destino?: DestinoEntrega | null;
  itens: EntregaItem[];

  criadoEm: string;
  atualizadoEm: string;
}

/**
 * Saldo de um produto de um pedido: o que ainda não foi para nenhuma viagem.
 * É o que a coluna "Pendente" do quadro mostra.
 */
export interface SaldoItem {
  produtoCodigo: string;
  nomeProduto: string;
  /** Quantidade total do produto no pedido (o que o Órix diz). */
  qtdPedido: number;
  /** Quanto já está comprometido com entregas que consomem saldo. */
  qtdComprometida: number;
  /** qtdPedido − qtdComprometida (nunca negativo). */
  qtdSaldo: number;
  pesoUnitKg: number | null;
  /**
   * De onde veio o peso: 'auto' (extraído do nome do produto) ou 'manual'
   * (digitado pela equipe). null quando não há peso. O agendamento pede
   * conferência do 'manual' — é o peso que muda a cada compra, como a soja.
   */
  pesoOrigem?: OrigemPeso | null;
  /** Quando o peso foi informado (ISO) — a tela mostra a data na conferência. */
  pesoAtualizadoEm?: string | null;
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

/** De onde veio o peso: 'auto' = parser do nome; 'manual' = digitado pela equipe. */
export type OrigemPeso = 'auto' | 'manual';

/** Peso unitário conhecido de um produto (tabela produtos_peso). */
export interface PesoProduto {
  produtoCodigo: string;
  nomeProduto: string | null;
  pesoKg: number;
  origem: OrigemPeso;
  atualizadoEm: string;
}

// ---------------------------------------------------------------------------
// Agenda (calendário de entregas — mês/semana/dia)
// ---------------------------------------------------------------------------

/**
 * Janela de limite de entregas de um caminhão (migração 0020).
 *
 * O TETO é por dia; a janela diz em que período do calendário ele vale. A regra
 * que escolhe a janela vigente e decide se cabe mais uma entrega está em
 * limite-entregas.ts, compartilhada pela tela e pelo servidor.
 */
export interface LimiteEntregasCaminhao {
  id: string;
  caminhaoId: string;
  /** Data ISO inicial, inclusiva. */
  validoDe: string;
  /** Data ISO final, inclusiva. null = vigência aberta. */
  validoAte: string | null;
  maxEntregasDia: number;
  observacoes: string | null;
  criadoEm: string;
}

/** Uma VIAGEM como aparece no card da agenda (Onda 2: entrega, não pedido). */
export interface AgendaEntrega {
  entregaId: string;
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
  status: StatusEntrega;
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
// Motivos de não entrega (cadastro da logística)
// ---------------------------------------------------------------------------

/**
 * Um motivo pelo qual uma entrega pode não ser realizada.
 *
 * A lista é FECHADA e cadastrada pela logística: quem registra a não entrega
 * escolhe daqui, não digita. É o que mantém o filtro por motivo utilizável
 * (reunião de 16/07/2026).
 */
export interface MotivoNaoEntrega {
  id: string;
  descricao: string;
  /** Desativado sai da lista de escolha, mas não some do histórico. */
  ativo: boolean;
  /** Ordem de exibição; empate desempata por descrição. */
  ordem: number;
  criadoEm: string;
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

/**
 * Estado de um link curto de acesso, consultado pela página /acesso ANTES de
 * qualquer coisa ser consumida. É o que permite o robô de pré-visualização do
 * WhatsApp abrir o link sem queimá-lo.
 */
export interface EstadoLinkAcesso {
  valido: boolean;
  /** Primeiro nome de quem vai criar a senha, para a página cumprimentar. */
  nome?: string;
  /** Por que não vale. Ausente quando `valido`. */
  motivo?: 'expirado' | 'invalido';
}

/** Resposta ao confirmar o link: para onde o navegador deve ir. */
export interface AcessoConfirmadoResposta {
  url: string;
}
