// Cliente HTTP da API de logística.
// Usa VITE_API_URL como base e injeta o access_token do Supabase (Bearer)
// no header Authorization de cada requisição.

import type {
  Pedido,
  Propriedade,
  ConfigResponse,
  SyncStatusResponse,
  TransicaoRequest,
  ReverterRequest,
  StatusLogistico,
  MotoristaResumo,
  UsuarioAdmin,
  ConviteUsuarioRequest,
  ConviteUsuarioResposta,
  LinkAcessoResposta,
  EstadoLinkAcesso,
  AcessoConfirmadoResposta,
  AtualizarUsuarioRequest,
  PrevisaoClima,
  Caminhao,
  CriarCaminhaoRequest,
  AtualizarCaminhaoRequest,
  AgendaResposta,
  PesoProduto,
  MotivoNaoEntrega,
  Entrega,
  StatusEntrega,
  SaldoItem,
  PeriodoEntrega,
  LimiteEntregasCaminhao,
} from '@pastobom/shared';
import { supabase } from './supabase';

const BASE_URL = (
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'http://localhost:3333'
).replace(/\/$/, '');

/** Erro HTTP enriquecido com status e payload do servidor. */
export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

/** Mensagens amigáveis por status para os erros mais relevantes do board. */
function mensagemPadrao(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const msg = obj.message ?? obj.error;
    if (typeof msg === 'string' && msg.trim().length > 0) {
      return msg;
    }
  }
  if (status === 401) return 'Sessão expirada. Faça login novamente.';
  if (status === 403) return 'Você não tem permissão para esta ação.';
  if (status === 409) return 'Transição inválida para este pedido.';
  if (status === 422) return 'Selecione a propriedade de entrega.';
  return `Falha na requisição (HTTP ${status}).`;
}

/** Recupera o access_token atual da sessão Supabase (ou undefined). */
async function obterToken(): Promise<string | undefined> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const token = await obterToken();
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  const texto = await res.text();
  let payload: unknown = undefined;
  if (texto.length > 0) {
    try {
      payload = JSON.parse(texto);
    } catch {
      payload = texto;
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, mensagemPadrao(res.status, payload), payload);
  }

  return payload as T;
}

/** Filtros da listagem de VIAGENS (todos opcionais). */
export interface FiltrosEntregas {
  status?: StatusEntrega[];
  /** Janela por data AGENDADA, 'YYYY-MM-DD'. */
  de?: string;
  ate?: string;
  motoristaId?: string;
  pedidoId?: string;
  /**
   * Corta as viagens não realizadas mais antigas que N dias. A coluna do quadro
   * é lista de trabalho: o saldo já voltou para a fila sozinho, então a falha
   * de dois meses atrás ali só empurra para fora o que precisa de atenção.
   */
  naoRealizadoDias?: number;
}

/** Corpo do agendamento de uma viagem. */
export interface CriarEntregaBody {
  pedidoId: string;
  dataAgendada: string;
  periodo: PeriodoEntrega;
  motoristaId: string;
  caminhaoId: string;
  propriedadeCodigo?: string;
  /** produto_codigo -> quantidade desta viagem. */
  quantidades: Record<string, number>;
  /**
   * produto_codigo -> peso unitário (kg) digitado no modal. Só vem quando
   * faltava peso ou quando a equipe alterou um peso informado antes. O backend
   * congela esse peso NA VIAGEM e guarda o valor como sugestão do produto.
   */
  pesos?: Record<string, number>;
}

/**
 * Corpo do reagendamento. Todos opcionais: manda-se só o que mudou, e o backend
 * exige ao menos um dos quatro primeiros.
 */
export interface ReagendarEntregaBody {
  dataAgendada?: string;
  periodo?: PeriodoEntrega;
  motoristaId?: string;
  caminhaoId?: string;
  motivo?: string;
  /** Reenvia o aviso ao cliente. Só faz efeito quando a data/período muda. */
  avisarCliente?: boolean;
}

/** Filtros server-side da lista de PEDIDOS (todos opcionais). */
export interface FiltrosPedidos {
  /** Data de ENTRADA do pedido (data_pedido), 'YYYY-MM-DD'. */
  de?: string;
  ate?: string;
  /** Status do Órix ('00041', '00045', '00027'). */
  statusOrix?: string[];
}

export const api = {
  /** Lista pedidos; opcionalmente filtra por status logístico, período e status Órix. */
  async listarPedidos(
    status?: StatusLogistico[],
    signal?: AbortSignal,
    filtros?: FiltrosPedidos,
  ): Promise<Pedido[]> {
    const params = new URLSearchParams();
    if (status && status.length > 0) params.set('status', status.join(','));
    if (filtros?.de) params.set('de', filtros.de);
    if (filtros?.ate) params.set('ate', filtros.ate);
    if (filtros?.statusOrix && filtros.statusOrix.length > 0) {
      params.set('statusOrix', filtros.statusOrix.join(','));
    }
    const qs = params.toString();
    return request<Pedido[]>(`/api/pedidos${qs ? `?${qs}` : ''}`, { signal });
  },

  /** Detalhe de um pedido. */
  async obterPedido(id: string, signal?: AbortSignal): Promise<Pedido> {
    return request<Pedido>(`/api/pedidos/${encodeURIComponent(id)}`, { signal });
  },

  /** Aplica uma transição de status; devolve o pedido atualizado. */
  async transicionar(id: string, body: TransicaoRequest): Promise<Pedido> {
    return request<Pedido>(`/api/pedidos/${encodeURIComponent(id)}/transicao`, {
      method: 'POST',
      body,
    });
  },

  /** Reverte o status uma etapa (logística); devolve o pedido atualizado. */
  async reverter(id: string, para: StatusLogistico): Promise<Pedido> {
    return request<Pedido>(`/api/pedidos/${encodeURIComponent(id)}/reverter`, {
      method: 'POST',
      body: { para } satisfies ReverterRequest,
    });
  },

  // -------------------------------------------------------------------------
  // ENTREGAS (a viagem) — Onda 2
  // -------------------------------------------------------------------------

  /** Lista viagens. Sem filtro de status, traz todas. */
  async listarEntregas(
    filtros: FiltrosEntregas = {},
    signal?: AbortSignal,
  ): Promise<Entrega[]> {
    const params = new URLSearchParams();
    if (filtros.status && filtros.status.length > 0) {
      params.set('status', filtros.status.join(','));
    }
    if (filtros.de) params.set('de', filtros.de);
    if (filtros.ate) params.set('ate', filtros.ate);
    if (filtros.motoristaId) params.set('motoristaId', filtros.motoristaId);
    if (filtros.pedidoId) params.set('pedidoId', filtros.pedidoId);
    if (filtros.naoRealizadoDias !== undefined) {
      params.set('naoRealizadoDias', String(filtros.naoRealizadoDias));
    }
    const qs = params.toString();
    return request<Entrega[]>(`/api/entregas${qs ? `?${qs}` : ''}`, { signal });
  },

  /**
   * Reagenda uma viagem AGENDADA: data, período, motorista, caminhão.
   *
   * Manda só o que mudou. Quantidades, peso e destino não passam por aqui de
   * propósito — mudar carga é uma viagem nova, não a mesma noutro dia.
   */
  async reagendarEntrega(
    entregaId: string,
    body: ReagendarEntregaBody,
  ): Promise<Entrega> {
    return request<Entrega>(
      `/api/entregas/${encodeURIComponent(entregaId)}/agendamento`,
      { method: 'PATCH', body },
    );
  },

  /** Janelas de limite de entregas por dia de um caminhão. */
  async limitesDoCaminhao(
    caminhaoId: string,
    signal?: AbortSignal,
  ): Promise<LimiteEntregasCaminhao[]> {
    return request<LimiteEntregasCaminhao[]>(
      `/api/caminhoes/${encodeURIComponent(caminhaoId)}/limites`,
      { signal },
    );
  },

  async criarLimiteCaminhao(
    caminhaoId: string,
    body: {
      validoDe: string;
      validoAte?: string | null;
      maxEntregasDia: number;
      observacoes?: string;
    },
  ): Promise<LimiteEntregasCaminhao> {
    return request<LimiteEntregasCaminhao>(
      `/api/caminhoes/${encodeURIComponent(caminhaoId)}/limites`,
      { method: 'POST', body },
    );
  },

  async removerLimiteCaminhao(
    caminhaoId: string,
    limiteId: string,
  ): Promise<void> {
    await request<void>(
      `/api/caminhoes/${encodeURIComponent(caminhaoId)}/limites/${encodeURIComponent(limiteId)}`,
      { method: 'DELETE' },
    );
  },

  /** Uma viagem só, com itens e quantidades — o detalhe do card da agenda. */
  async obterEntrega(id: string, signal?: AbortSignal): Promise<Entrega> {
    return request<Entrega>(`/api/entregas/${encodeURIComponent(id)}`, {
      signal,
    });
  },

  /** O que ainda falta entregar de um pedido (o que a coluna Pendente mostra). */
  async saldoDoPedido(
    pedidoId: string,
    signal?: AbortSignal,
  ): Promise<SaldoItem[]> {
    return request<SaldoItem[]>(
      `/api/pedidos/${encodeURIComponent(pedidoId)}/saldo`,
      { signal },
    );
  },

  /** Agenda uma viagem: data, período, motorista, caminhão e as quantidades. */
  async criarEntrega(body: CriarEntregaBody): Promise<Entrega> {
    return request<Entrega>('/api/entregas', { method: 'POST', body });
  },

  /** Avança a viagem (em rota, entregue, não realizado, cancelada). */
  async transicionarEntrega(
    entregaId: string,
    body: { para: StatusEntrega; observacao?: string; motivo?: string },
  ): Promise<Entrega> {
    return request<Entrega>(
      `/api/entregas/${encodeURIComponent(entregaId)}/transicao`,
      { method: 'POST', body },
    );
  },

  /** Volta a viagem uma etapa (hoje: só em rota -> agendada). */
  async reverterEntrega(
    entregaId: string,
    para: StatusEntrega,
  ): Promise<Entrega> {
    return request<Entrega>(
      `/api/entregas/${encodeURIComponent(entregaId)}/reverter`,
      { method: 'POST', body: { para } },
    );
  },

  /** Marca/desmarca UM item da viagem como separado. */
  async definirSeparacaoItemEntrega(
    entregaId: string,
    itemId: string,
    separado: boolean,
  ): Promise<Entrega> {
    return request<Entrega>(
      `/api/entregas/${encodeURIComponent(entregaId)}/itens/${encodeURIComponent(
        itemId,
      )}/separacao`,
      { method: 'PATCH', body: { separado } },
    );
  },

  /** "Dar OK na separação": marca todos os itens da viagem de uma vez. */
  async definirSeparacaoEntrega(
    entregaId: string,
    separado: boolean,
  ): Promise<Entrega> {
    return request<Entrega>(
      `/api/entregas/${encodeURIComponent(entregaId)}/separacao`,
      { method: 'PATCH', body: { separado } },
    );
  },

  /** App do motorista: as viagens dele (agendadas e em rota). */
  async listarMinhasEntregas(signal?: AbortSignal): Promise<Entrega[]> {
    return request<Entrega[]>('/api/minhas-entregas', { signal });
  },

  /** Fase 3: lista de motoristas (logística atribui). */
  async listarMotoristas(signal?: AbortSignal): Promise<MotoristaResumo[]> {
    return request<MotoristaResumo[]>('/api/motoristas', { signal });
  },

  /** Propriedades de um cliente (para escolha na transição de agendamento). */
  async propriedadesDoCliente(
    clienteCodigo: string,
    signal?: AbortSignal,
  ): Promise<Propriedade[]> {
    return request<Propriedade[]>(
      `/api/clientes/${encodeURIComponent(clienteCodigo)}/propriedades`,
      { signal },
    );
  },

  /** Configuração pública (status gatilho, templates). */
  async config(signal?: AbortSignal): Promise<ConfigResponse> {
    return request<ConfigResponse>('/api/config', { signal });
  },

  /** Última sincronização com o Órix (heartbeat do worker de poll). */
  async statusSync(signal?: AbortSignal): Promise<SyncStatusResponse> {
    return request<SyncStatusResponse>('/api/sync', { signal });
  },

  /**
   * Previsão do clima do dia para UM pedido (preview do modal de agendar).
   * `data` e `propriedadeCodigo` (ainda não salvos) sobrepõem os do pedido.
   */
  async climaPedido(
    pedidoId: string,
    data?: string,
    propriedadeCodigo?: string,
    signal?: AbortSignal,
  ): Promise<PrevisaoClima> {
    const params = new URLSearchParams();
    if (data) params.set('data', data);
    if (propriedadeCodigo) params.set('propriedadeCodigo', propriedadeCodigo);
    const qs = params.toString();
    return request<PrevisaoClima>(
      `/api/clima/pedido/${encodeURIComponent(pedidoId)}${qs ? `?${qs}` : ''}`,
      { signal },
    );
  },

  /** Clima em lote (board/rota): mapa pedidoId -> previsão (ou null). */
  async climaLote(
    pedidoIds: string[],
    signal?: AbortSignal,
  ): Promise<Record<string, PrevisaoClima | null>> {
    if (pedidoIds.length === 0) return {};
    const qs = `?pedidos=${encodeURIComponent(pedidoIds.join(','))}`;
    return request<Record<string, PrevisaoClima | null>>(`/api/clima${qs}`, {
      signal,
    });
  },

  /** Frota: lista os caminhões (leitura liberada; escrita só logística). */
  async listarCaminhoes(signal?: AbortSignal): Promise<Caminhao[]> {
    return request<Caminhao[]>('/api/caminhoes', { signal });
  },

  /** Frota: cadastra um caminhão. */
  async criarCaminhao(body: CriarCaminhaoRequest): Promise<Caminhao> {
    return request<Caminhao>('/api/caminhoes', { method: 'POST', body });
  },

  /** Frota: atualiza nome, placa, capacidade ou o flag de ativo. */
  async atualizarCaminhao(
    id: string,
    body: AtualizarCaminhaoRequest,
  ): Promise<Caminhao> {
    return request<Caminhao>(`/api/caminhoes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
    });
  },

  /**
   * Motivos de não entrega. Por padrão traz só os ATIVOS (é a lista que o
   * modal oferece); `todos` inclui os desativados, para a tela de cadastro
   * poder reativá-los.
   */
  async listarMotivos(
    todos = false,
    signal?: AbortSignal,
  ): Promise<MotivoNaoEntrega[]> {
    return request<MotivoNaoEntrega[]>(
      `/api/motivos${todos ? '?todos=1' : ''}`,
      { signal },
    );
  },

  /** Cadastra um motivo de não entrega (somente logística). */
  async criarMotivo(descricao: string): Promise<MotivoNaoEntrega> {
    return request<MotivoNaoEntrega>('/api/motivos', {
      method: 'POST',
      body: { descricao },
    });
  },

  /** Renomeia, reordena ou (des)ativa um motivo (somente logística). */
  async atualizarMotivo(
    id: string,
    body: { descricao?: string; ativo?: boolean; ordem?: number },
  ): Promise<MotivoNaoEntrega> {
    return request<MotivoNaoEntrega>(`/api/motivos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
    });
  },

  /**
   * Peso: grava o peso unitário de um produto (origem 'manual'). Fica salvo NO
   * PRODUTO — os próximos pedidos com esse item já vêm com o peso preenchido.
   */
  async definirPesoProduto(
    produtoCodigo: string,
    pesoKg: number,
  ): Promise<PesoProduto> {
    return request<PesoProduto>(
      `/api/produtos/${encodeURIComponent(produtoCodigo)}/peso`,
      { method: 'PUT', body: { pesoKg } },
    );
  },

  /** Agenda: entregas agrupadas por (data, período), com ocupação dos caminhões. */
  async agenda(
    de: string,
    ate: string,
    signal?: AbortSignal,
  ): Promise<AgendaResposta> {
    const qs = `?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`;
    return request<AgendaResposta>(`/api/agenda${qs}`, { signal });
  },

  /** Administração: lista todos os usuários do sistema (somente logística). */
  async listarUsuarios(signal?: AbortSignal): Promise<UsuarioAdmin[]> {
    return request<UsuarioAdmin[]>('/api/usuarios', { signal });
  },

  /** Administração: gera o link de acesso de um novo usuário (não envia e-mail). */
  async convidarUsuario(
    body: ConviteUsuarioRequest,
  ): Promise<ConviteUsuarioResposta> {
    return request<ConviteUsuarioResposta>('/api/usuarios/convite', {
      method: 'POST',
      body,
    });
  },

  /** Administração: atualiza papel e/ou nome de um usuário existente. */
  async atualizarUsuario(
    id: string,
    body: AtualizarUsuarioRequest,
  ): Promise<UsuarioAdmin> {
    return request<UsuarioAdmin>(`/api/usuarios/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
    });
  },

  /** Administração: ativa (true) ou desativa (false) o acesso de um usuário. */
  async definirStatusUsuario(
    id: string,
    ativo: boolean,
  ): Promise<UsuarioAdmin> {
    return request<UsuarioAdmin>(
      `/api/usuarios/${encodeURIComponent(id)}/status`,
      { method: 'PATCH', body: { ativo } },
    );
  },

  /** Administração: (re)gera um link de acesso para um usuário existente. */
  async regenerarLink(id: string): Promise<LinkAcessoResposta> {
    return request<LinkAcessoResposta>(
      `/api/usuarios/${encodeURIComponent(id)}/link`,
      { method: 'POST' },
    );
  },

  /**
   * Consulta o estado de um link de acesso. Rota PÚBLICA e somente leitura:
   * abrir a página não consome o link (é o que faz a pré-visualização do
   * WhatsApp deixar de queimá-lo).
   */
  async estadoLinkAcesso(
    token: string,
    signal?: AbortSignal,
  ): Promise<EstadoLinkAcesso> {
    return request<EstadoLinkAcesso>(
      `/api/acesso/${encodeURIComponent(token)}`,
      { signal },
    );
  },

  /** Confirma o link de acesso: devolve para onde o navegador deve ir. */
  async confirmarLinkAcesso(token: string): Promise<AcessoConfirmadoResposta> {
    return request<AcessoConfirmadoResposta>(
      `/api/acesso/${encodeURIComponent(token)}`,
      { method: 'POST' },
    );
  },

  /** Encerra o próprio link de acesso, depois que a senha foi criada. */
  async concluirAcesso(): Promise<void> {
    await request<void>('/api/usuarios/eu/acesso-concluido', {
      method: 'POST',
    });
  },
};
