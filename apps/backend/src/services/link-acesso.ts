// [AGENTE API] Link curto de acesso — criação e consumo.
//
// O QUE ESTE MÓDULO RESOLVE (queixas da Natália, 12/08/2026: "o link expira
// muito rápido" e "é muito longo e feio")
// ---------------------------------------------------------------------------
// A tela Usuários entregava o `action_link` cru do Supabase
// (.../auth/v1/verify?token=...&redirect_to=...). Três problemas:
//
//   1. o token é de USO ÚNICO e é gasto por QUEM ABRIR A URL — inclusive um
//      robô. O WhatsApp busca o link para montar a pré-visualização, e essa
//      visita queima o token: a pessoa clica depois e vê "link inválido";
//   2. a validade vem do painel do Supabase (o código nunca passou expiry),
//      tipicamente 1 hora — curta demais para um fluxo de WhatsApp;
//   3. o domínio é o do Supabase.
//
// Agora a logística manda um link NOSSO, curto, que só abre uma página com um
// botão. O link do Supabase nasce no INSTANTE do clique — o relógio dele começa
// a correr com a pessoa na tela, e expirar em trânsito deixa de ser possível.
//
// Guardamos o SHA-256 do token, nunca o token: `profiles` é legível via RLS
// pela própria pessoa e pela logística, e o hash torna a coluna inútil para
// quem a ler.

import { createHash, randomBytes } from 'node:crypto';

import {
  avaliarLinkAcesso,
  DIAS_VALIDADE_LINK_ACESSO,
  type SituacaoLinkAcesso,
} from '@pastobom/shared';

import { env } from '../config/env.js';
import { supabase } from '../db/supabase.js';

/** 16 bytes = 128 bits de entropia em 22 caracteres. Curto e inadivinhável. */
const BYTES_TOKEN = 16;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Sorteia um link curto para o usuário e grava o hash + prazo em `profiles`.
 * Sobrescreve qualquer link anterior — é o que a equipe espera do "Regerar
 * link": o antigo deixa de valer na hora.
 *
 * Devolve a URL pronta para copiar.
 */
export async function criarLinkAcesso(userId: string): Promise<string> {
  const token = randomBytes(BYTES_TOKEN).toString('base64url');
  const expiraEm = new Date(
    Date.now() + DIAS_VALIDADE_LINK_ACESSO * 86_400_000,
  ).toISOString();

  const { error } = await supabase
    .from('profiles')
    .update({
      acesso_token_hash: hashToken(token),
      acesso_expira_em: expiraEm,
      acesso_usado_em: null,
    })
    .eq('id', userId);

  if (error) {
    throw new Error(`gravar link de acesso: ${error.message}`);
  }

  return `${env.APP_URL}/acesso/${token}`;
}

export interface PerfilComLink {
  id: string;
  nome: string | null;
  acesso_expira_em: string | null;
  acesso_usado_em: string | null;
}

/**
 * Procura o dono de um token e diz em que situação o link está.
 *
 * Não distingue "token não existe" de "link encerrado": os dois viram
 * 'invalido'. Quem tem o link errado não descobre nada sobre quem existe.
 */
export async function situacaoDoToken(token: string): Promise<{
  situacao: SituacaoLinkAcesso;
  perfil: PerfilComLink | null;
}> {
  if (!token || token.length < 10) {
    return { situacao: 'invalido', perfil: null };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, nome, acesso_expira_em, acesso_usado_em')
    .eq('acesso_token_hash', hashToken(token))
    .maybeSingle();

  if (error || !data) {
    return { situacao: 'invalido', perfil: null };
  }

  const perfil = data as PerfilComLink;
  const situacao = avaliarLinkAcesso({
    expiraEm: perfil.acesso_expira_em,
    agora: new Date().toISOString(),
  });

  return { situacao, perfil };
}

/** Carimba o primeiro uso (auditoria). Não invalida o link — ver o módulo puro. */
export async function marcarUso(userId: string): Promise<void> {
  await supabase
    .from('profiles')
    .update({ acesso_usado_em: new Date().toISOString() })
    .eq('id', userId)
    .is('acesso_usado_em', null);
}

/**
 * Encerra o link: chamado quando a senha é efetivamente definida. É isto que
 * faz o link morrer no sucesso, em vez de morrer no primeiro clique.
 */
export async function encerrarLinkAcesso(userId: string): Promise<void> {
  await supabase
    .from('profiles')
    .update({
      acesso_token_hash: null,
      acesso_expira_em: null,
      acesso_usado_em: null,
    })
    .eq('id', userId);
}
