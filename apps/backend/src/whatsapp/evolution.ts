// [AGENTE WHATSAPP] Integração com a Evolution API v2 (envio de texto)
// e normalização de números de telefone brasileiros.
//
// Contrato (a API depende destas assinaturas EXATAS):
//   export function normalizarNumeroBR(raw: string): string | null
//   export async function enviarTexto(args: { numero: string; texto: string })
//       : Promise<{ ok: boolean; status: number; resposta: unknown }>
//
// Quando faltar configuração de env (EVOLUTION_URL / EVOLUTION_INSTANCE /
// EVOLUTION_API_KEY) operamos em modo "dry-run": logamos e retornamos
// { ok: false, ... } sem lançar.

import { normalizarWhatsApp } from '@pastobom/shared';

import { env } from '../config/env.js';
import { log } from '../log.js';

/** Timeout (ms) para a requisição HTTP ao provedor Evolution. */
const TIMEOUT_MS = 15_000;

/**
 * Normaliza um número brasileiro para o formato exigido pela Evolution API
 * (somente dígitos "55DDD9XXXXXXXX"), ou null quando não há móvel alcançável.
 *
 * Mantida por compatibilidade com a assinatura histórica; delega para a FONTE
 * ÚNICA de regra de número em @pastobom/shared (`normalizarWhatsApp`), que
 * distingue móvel × fixo — fixo agora retorna null, pois não recebe WhatsApp.
 */
export function normalizarNumeroBR(raw: string): string | null {
  return normalizarWhatsApp(raw).e164;
}

/** Verifica se a integração Evolution está configurada (env completo). */
function evolutionConfigurada(): boolean {
  return Boolean(env.EVOLUTION_URL && env.EVOLUTION_INSTANCE && env.EVOLUTION_API_KEY);
}

/** Monta a URL de envio de texto da Evolution API v2 (sem barras duplicadas). */
function montarUrlSendText(): string {
  const base = env.EVOLUTION_URL.replace(/\/+$/, '');
  const instancia = encodeURIComponent(env.EVOLUTION_INSTANCE);
  return `${base}/message/sendText/${instancia}`;
}

/**
 * Envia uma mensagem de texto via Evolution API v2.
 *
 * POST {EVOLUTION_URL}/message/sendText/{EVOLUTION_INSTANCE}
 * headers: { apikey: EVOLUTION_API_KEY, "Content-Type": "application/json" }
 * body:    { number: "55DDDNUMERO", text: "..." }
 *
 * - Em modo dry-run (env ausente): loga e retorna { ok: false, status: 0, resposta }.
 * - Nunca lança: erros de rede/timeout viram { ok: false, status: 0, resposta }.
 * - status reflete o HTTP status quando há resposta; ok = response.ok.
 */
export async function enviarTexto(args: {
  numero: string;
  texto: string;
}): Promise<{ ok: boolean; status: number; resposta: unknown }> {
  const { numero, texto } = args;

  // Modo dry-run: configuração ausente.
  if (!evolutionConfigurada()) {
    log.warn(
      '[whatsapp] Evolution não configurada (EVOLUTION_URL/INSTANCE/API_KEY ausentes). ' +
        'Modo dry-run: mensagem NÃO enviada.',
      { numero, texto },
    );
    return {
      ok: false,
      status: 0,
      resposta: { dryRun: true, motivo: 'Evolution API não configurada' },
    };
  }

  const url = montarUrlSendText();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: env.EVOLUTION_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ number: numero, text: texto }),
      signal: controller.signal,
    });

    // Tenta interpretar como JSON; cai para texto bruto se não for JSON.
    let resposta: unknown;
    const corpoTexto = await resp.text();
    try {
      resposta = corpoTexto ? JSON.parse(corpoTexto) : null;
    } catch {
      resposta = corpoTexto;
    }

    if (!resp.ok) {
      log.error(
        `[whatsapp] Falha no envio (HTTP ${resp.status}) para ${numero}`,
        resposta,
      );
    } else {
      log.info(`[whatsapp] Mensagem enviada para ${numero} (HTTP ${resp.status})`);
    }

    return { ok: resp.ok, status: resp.status, resposta };
  } catch (erro) {
    const abortado =
      erro instanceof Error && (erro.name === 'AbortError' || erro.name === 'TimeoutError');
    const mensagem = abortado
      ? `timeout após ${TIMEOUT_MS}ms`
      : erro instanceof Error
        ? erro.message
        : String(erro);

    log.error(`[whatsapp] Erro ao enviar para ${numero}: ${mensagem}`);
    return {
      ok: false,
      status: 0,
      resposta: { erro: mensagem, timeout: abortado },
    };
  } finally {
    clearTimeout(timer);
  }
}
