// [AGENTE ORIX] Cliente HTTP da API Órix.
//
// Responsabilidades:
//  - Login com cache de token + renovação automática (validade ~24h; renova
//    quando faltar < 2h ou em resposta 401).
//  - getPedidos (POST /PedidosPorProdutos) — UMA chamada de janela; NÃO faz
//    chunking de datas (isso é responsabilidade do worker).
//  - getCliente (GET /Cliente/{codigo}).
//  - getPropriedades (GET /Propriedades/{codigo_cliente}).
//
// Detalhes de robustez:
//  - fetch nativo do Node (>= 20), timeout de 30s por requisição.
//  - retry com backoff exponencial (3 tentativas) em erro de rede / 5xx.
//  - {valid:false} no login é tratado como erro de credencial.

import type {
  OrixCliente,
  OrixLoginResp,
  OrixPedidoItem,
  OrixPropriedade,
} from '@pastobom/shared';
import { log } from '../log.js';

const TIMEOUT_MS = 30_000;
const MAX_TENTATIVAS = 3;
const BACKOFF_BASE_MS = 500;

// JWT exp aproximado: a validade é ~24h; renovamos quando faltar < 2h.
const RENOVAR_ANTES_MS = 2 * 60 * 60 * 1000;
// Fallback caso não consigamos ler o exp do JWT (assume validade de 24h).
const VALIDADE_PADRAO_MS = 24 * 60 * 60 * 1000;

export interface OrixClientOpts {
  baseUrl: string;
  login: string;
  senha: string;
}

export interface GetPedidosParams {
  dataInicial: string; // yyyy-mm-dd
  dataFinal: string; // yyyy-mm-dd
  status?: string[];
  somenteVendas?: boolean;
  empresas?: number[];
}

interface RespostaRegistros<T> {
  registros?: T[];
}

/** Erro de credencial Órix (login {valid:false} ou senha inválida). */
export class OrixCredencialError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'OrixCredencialError';
  }
}

/** Erro HTTP da API Órix (status fora de 2xx que não é retry-ável). */
export class OrixHttpError extends Error {
  readonly status: number;
  readonly corpo: string;
  constructor(status: number, corpo: string) {
    super(`Órix HTTP ${status}: ${corpo}`);
    this.name = 'OrixHttpError';
    this.status = status;
    this.corpo = corpo;
  }
}

/** Erro interno usado para sinalizar que o token expirou (401) e deve renovar. */
class TokenExpiradoError extends Error {
  constructor() {
    super('Token Órix expirado (401)');
    this.name = 'TokenExpiradoError';
  }
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decodifica o campo `exp` (epoch em segundos) do payload de um JWT, se houver.
 * Retorna o instante de expiração em ms, ou null se não for possível ler.
 */
function lerExpiracaoJwt(token: string): number | null {
  const partes = token.split('.');
  const payloadParte = partes[1];
  if (!payloadParte) return null;
  try {
    const payloadB64 = payloadParte.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(payloadB64, 'base64').toString('utf8');
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp === 'number') {
      return payload.exp * 1000;
    }
  } catch {
    // payload não decodificável — usa fallback
  }
  return null;
}

export class OrixClient {
  private readonly baseUrl: string;
  private readonly loginUser: string;
  private readonly senha: string;

  private token: string | null = null;
  private expiraEmMs = 0;
  // Garante que logins concorrentes compartilhem a mesma promessa.
  private loginEmAndamento: Promise<string> | null = null;

  constructor(opts: OrixClientOpts) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.loginUser = opts.login;
    this.senha = opts.senha;
  }

  /**
   * Autentica e cacheia o token. Reaproveita o token em cache enquanto válido
   * (renova quando faltar < 2h para expirar). Retorna o token (JWT).
   */
  async login(): Promise<string> {
    if (this.tokenValido()) {
      return this.token as string;
    }
    // Coalesce logins concorrentes.
    if (this.loginEmAndamento) {
      return this.loginEmAndamento;
    }
    this.loginEmAndamento = this.realizarLogin();
    try {
      return await this.loginEmAndamento;
    } finally {
      this.loginEmAndamento = null;
    }
  }

  private tokenValido(): boolean {
    return (
      this.token !== null && Date.now() < this.expiraEmMs - RENOVAR_ANTES_MS
    );
  }

  private async realizarLogin(): Promise<string> {
    const resp = await this.requestComRetry('/Login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: this.loginUser, senha: this.senha }),
    });

    const corpo = await this.parseJson<OrixLoginResp>(resp);

    if (!corpo || corpo.valid !== true || !corpo.token) {
      throw new OrixCredencialError(
        'Login Órix falhou: resposta {valid:false} ou sem token (credenciais inválidas).',
      );
    }

    this.token = corpo.token;
    const exp = lerExpiracaoJwt(corpo.token);
    this.expiraEmMs = exp ?? Date.now() + VALIDADE_PADRAO_MS;
    log.info('[orix] Login efetuado; token em cache.');
    return this.token;
  }

  /** Força renovação do token (descarta cache e faz login de novo). */
  private async renovarToken(): Promise<string> {
    this.token = null;
    this.expiraEmMs = 0;
    return this.login();
  }

  /**
   * POST /PedidosPorProdutos — retorna UMA LINHA POR PRODUTO. O agrupamento por
   * id_pedido é feito pelo worker. NÃO faz chunking de datas aqui.
   */
  async getPedidos(p: GetPedidosParams): Promise<OrixPedidoItem[]> {
    const body: Record<string, unknown> = {
      data_inicial: p.dataInicial,
      data_final: p.dataFinal,
      somente_vendas: p.somenteVendas ?? false,
      empresas: p.empresas ?? [2],
    };
    if (p.status && p.status.length > 0) {
      body.status = p.status;
    }

    const resp = await this.requestAutenticada('/PedidosPorProdutos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const corpo = await this.parseJson<RespostaRegistros<OrixPedidoItem>>(resp);
    return corpo?.registros ?? [];
  }

  /** GET /Cliente/{codigo} — dados do cliente. Retorna null se não existir. */
  async getCliente(codigo: string): Promise<OrixCliente | null> {
    const resp = await this.requestAutenticada(
      `/Cliente/${encodeURIComponent(codigo)}`,
      { method: 'GET' },
    );

    if (resp.status === 404) {
      return null;
    }

    const corpo = await this.parseJson<unknown>(resp);
    if (corpo === null || corpo === undefined) {
      return null;
    }

    // A API pode responder o cliente diretamente ou dentro de {registros:[...]}.
    if (typeof corpo === 'object' && 'registros' in (corpo as object)) {
      const lista = (corpo as RespostaRegistros<OrixCliente>).registros ?? [];
      return lista[0] ?? null;
    }

    return corpo as OrixCliente;
  }

  /** GET /Propriedades/{codigo_cliente} — propriedades do cliente. */
  async getPropriedades(clienteCodigo: string): Promise<OrixPropriedade[]> {
    const resp = await this.requestAutenticada(
      `/Propriedades/${encodeURIComponent(clienteCodigo)}`,
      { method: 'GET' },
    );

    if (resp.status === 404) {
      return [];
    }

    const corpo =
      await this.parseJson<RespostaRegistros<OrixPropriedade>>(resp);
    return corpo?.registros ?? [];
  }

  // --------------------------------------------------------------------------
  // Infraestrutura HTTP
  // --------------------------------------------------------------------------

  /**
   * Faz uma requisição autenticada: garante token, injeta Bearer e, em caso de
   * 401, renova o token UMA vez e tenta de novo.
   */
  private async requestAutenticada(
    caminho: string,
    init: RequestInit,
  ): Promise<Response> {
    let token = await this.login();
    try {
      return await this.requestComRetry(caminho, this.comBearer(init, token));
    } catch (err) {
      if (err instanceof TokenExpiradoError) {
        log.warn('[orix] 401 recebido; renovando token e repetindo.');
        token = await this.renovarToken();
        return this.requestComRetry(caminho, this.comBearer(init, token));
      }
      throw err;
    }
  }

  private comBearer(init: RequestInit, token: string): RequestInit {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return { ...init, headers };
  }

  /**
   * Executa fetch com timeout de 30s e retry com backoff exponencial
   * (até 3 tentativas) em erro de rede ou 5xx. Em 401 lança TokenExpiradoError
   * (sem consumir tentativas) para o chamador renovar o token. Outros 4xx
   * lançam OrixHttpError imediatamente (não retry-ável).
   */
  private async requestComRetry(
    caminho: string,
    init: RequestInit,
  ): Promise<Response> {
    const url = `${this.baseUrl}${caminho}`;
    let ultimoErro: unknown;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const resp = await fetch(url, { ...init, signal: controller.signal });
        clearTimeout(timer);

        if (resp.status === 401) {
          // Deixa o chamador decidir renovar o token; não conta como retry.
          throw new TokenExpiradoError();
        }

        if (resp.status >= 500) {
          const corpo = await this.lerCorpoSeguro(resp);
          ultimoErro = new OrixHttpError(resp.status, corpo);
          log.warn(
            `[orix] ${init.method ?? 'GET'} ${caminho} -> ${resp.status} (tentativa ${tentativa}/${MAX_TENTATIVAS})`,
          );
          if (tentativa < MAX_TENTATIVAS) {
            await dormir(BACKOFF_BASE_MS * 2 ** (tentativa - 1));
            continue;
          }
          throw ultimoErro;
        }

        if (!resp.ok) {
          // 4xx não retry-ável (ex.: 400 "Faltando Parâmetros").
          const corpo = await this.lerCorpoSeguro(resp);
          throw new OrixHttpError(resp.status, corpo);
        }

        return resp;
      } catch (err) {
        clearTimeout(timer);

        // Erros que não devem ser retry-ados pelo loop:
        if (err instanceof TokenExpiradoError) throw err;
        if (err instanceof OrixHttpError && err.status < 500) throw err;
        if (err instanceof OrixCredencialError) throw err;

        // Erro de rede / abort (timeout) / 5xx propagado: retry com backoff.
        ultimoErro = err;
        const motivo =
          err instanceof Error && err.name === 'AbortError'
            ? `timeout ${TIMEOUT_MS}ms`
            : err instanceof Error
              ? err.message
              : String(err);
        log.warn(
          `[orix] ${init.method ?? 'GET'} ${caminho} falhou (${motivo}) (tentativa ${tentativa}/${MAX_TENTATIVAS})`,
        );
        if (tentativa < MAX_TENTATIVAS) {
          await dormir(BACKOFF_BASE_MS * 2 ** (tentativa - 1));
          continue;
        }
      }
    }

    throw ultimoErro instanceof Error
      ? ultimoErro
      : new Error(`Falha ao chamar Órix ${caminho}: ${String(ultimoErro)}`);
  }

  private async parseJson<T>(resp: Response): Promise<T | null> {
    const texto = await resp.text();
    if (!texto) return null;
    try {
      return JSON.parse(texto) as T;
    } catch {
      throw new Error(
        `Resposta Órix não é JSON válido (HTTP ${resp.status}): ${texto.slice(0, 200)}`,
      );
    }
  }

  private async lerCorpoSeguro(resp: Response): Promise<string> {
    try {
      const t = await resp.text();
      return t.slice(0, 500);
    } catch {
      return '<sem corpo>';
    }
  }
}
