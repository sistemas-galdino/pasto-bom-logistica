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
  AtualizarUsuarioRequest,
  PrevisaoClima,
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

export const api = {
  /** Lista pedidos; opcionalmente filtra por uma lista de status. */
  async listarPedidos(
    status?: StatusLogistico[],
    signal?: AbortSignal,
  ): Promise<Pedido[]> {
    const qs =
      status && status.length > 0
        ? `?status=${encodeURIComponent(status.join(','))}`
        : '';
    return request<Pedido[]>(`/api/pedidos${qs}`, { signal });
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

  /** RF-2.2: marca/desmarca um item como separado; devolve o pedido atualizado. */
  async definirSeparacao(
    pedidoId: string,
    itemId: string,
    separado: boolean,
  ): Promise<Pedido> {
    return request<Pedido>(
      `/api/pedidos/${encodeURIComponent(pedidoId)}/itens/${encodeURIComponent(
        itemId,
      )}/separacao`,
      { method: 'PATCH', body: { separado } },
    );
  },

  /** Fase 3: "rota do dia" do motorista (pedidos em_rota atribuídos a ele). */
  async listarMinhaRota(signal?: AbortSignal): Promise<Pedido[]> {
    return request<Pedido[]>('/api/pedidos?meus=1', { signal });
  },

  /** Fase 3: lista de motoristas (logística atribui). */
  async listarMotoristas(signal?: AbortSignal): Promise<MotoristaResumo[]> {
    return request<MotoristaResumo[]>('/api/motoristas', { signal });
  },

  /** Fase 3: atribui (ou remove, com null) o motorista de um pedido. */
  async atribuirMotorista(
    pedidoId: string,
    motoristaId: string | null,
  ): Promise<Pedido> {
    return request<Pedido>(
      `/api/pedidos/${encodeURIComponent(pedidoId)}/motorista`,
      { method: 'PATCH', body: { motoristaId } },
    );
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
};
