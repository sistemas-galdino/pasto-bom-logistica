// Cliente HTTP da API de logística.
// Usa VITE_API_URL como base e injeta o access_token do Supabase (Bearer)
// no header Authorization de cada requisição.

import type {
  Pedido,
  Propriedade,
  ConfigResponse,
  TransicaoRequest,
  StatusLogistico,
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
};
