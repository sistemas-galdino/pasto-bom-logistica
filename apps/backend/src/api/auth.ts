// [AGENTE API] Autenticação/autorização das rotas.
//
// Valida o JWT do Supabase enviado no header Authorization: Bearer <token>,
// resolve o papel do usuário via tabela `profiles` e o anexa ao request.
//
// Regras de papel (Fase 1):
//   - logistica : leitura + escrita (todas as rotas).
//   - vendedor  : somente leitura (apenas GET).
//   - motorista : leitura mínima (tratado como leitura por enquanto).
//
// Em desenvolvimento, ALLOW_NO_AUTH=true libera as rotas sem token
// (loga aviso e assume papel 'logistica').

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';

import { env } from '../config/env.js';
import { log } from '../log.js';
import { supabase } from '../db/supabase.js';

export type Papel = 'logistica' | 'vendedor' | 'motorista';

export interface UsuarioAutenticado {
  id: string | null;
  papel: Papel;
  semAuth: boolean;
}

// Augmenta o FastifyRequest para carregar o usuário resolvido.
declare module 'fastify' {
  interface FastifyRequest {
    usuario?: UsuarioAutenticado;
  }
}

const METODOS_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

let avisoNoAuthEmitido = false;

/**
 * Extrai o token Bearer do header Authorization.
 */
function extrairToken(req: FastifyRequest): string | null {
  const header = req.headers['authorization'];
  if (!header || typeof header !== 'string') return null;
  const [esquema, token] = header.split(' ');
  if (esquema?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

/**
 * Resolve o papel do usuário a partir da tabela profiles (via service-role).
 * Default seguro: 'vendedor' (somente leitura) quando não há profile.
 */
async function resolverPapel(userId: string): Promise<Papel> {
  const { data, error } = await supabase
    .from('profiles')
    .select('papel')
    .eq('id', userId)
    .maybeSingle<{ papel: Papel }>();

  if (error) {
    log.warn(`[auth] Falha ao ler profile ${userId}: ${error.message}`);
    return 'vendedor';
  }
  return data?.papel ?? 'vendedor';
}

/**
 * preHandler: autentica e autoriza. Deve ser registrado nas rotas /api.
 */
export const autenticar: preHandlerHookHandler = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  // Health check e preflight não exigem autenticação.
  // (O hook só é registrado no escopo /api; health vive fora dele, mas
  //  mantemos a guarda por segurança.)
  if (req.method === 'OPTIONS') return;
  if (req.url === '/api/health' || req.url.startsWith('/api/health?')) {
    return;
  }

  // Modo dev sem auth.
  if (env.ALLOW_NO_AUTH) {
    if (!avisoNoAuthEmitido) {
      log.warn(
        '[auth] ALLOW_NO_AUTH=true — rotas liberadas sem autenticação (assumindo papel "logistica"). NÃO usar em produção.',
      );
      avisoNoAuthEmitido = true;
    }
    req.usuario = { id: null, papel: 'logistica', semAuth: true };
    return;
  }

  const token = extrairToken(req);
  if (!token) {
    return reply
      .code(401)
      .send({ error: 'nao_autenticado', message: 'Token ausente.' });
  }

  // Valida o JWT do Supabase resolvendo o usuário a partir do token.
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return reply
      .code(401)
      .send({ error: 'token_invalido', message: 'Token inválido ou expirado.' });
  }

  const papel = await resolverPapel(data.user.id);
  req.usuario = { id: data.user.id, papel, semAuth: false };

  // Autorização por método: somente 'logistica' escreve.
  const ehEscrita = !METODOS_LEITURA.has(req.method);
  if (ehEscrita && papel !== 'logistica') {
    return reply.code(403).send({
      error: 'sem_permissao',
      message: `Papel "${papel}" não tem permissão de escrita.`,
    });
  }
};

/**
 * Registra o hook de autenticação na instância (escopo do plugin de rotas).
 */
export function registrarAuth(app: FastifyInstance): void {
  app.addHook('preHandler', autenticar);
}
