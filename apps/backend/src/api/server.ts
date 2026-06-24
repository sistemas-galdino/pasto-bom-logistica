// [AGENTE API] Servidor Fastify.
//
//   - Prefixo /api em todas as rotas de domínio.
//   - CORS liberado para o frontend (VITE em http://localhost:5173 por padrão).
//   - Autenticação (auth.ts) registrada no escopo das rotas /api.
//   - GET /api/health fora do escopo autenticado.
//   - Porta = env.API_PORT.

import Fastify, { type FastifyInstance } from 'fastify';

import { env } from '../config/env.js';
import { log } from '../log.js';
import { registrarAuth } from './auth.js';
import { pedidosRoutes } from './routes/pedidos.js';
import { configRoutes } from './routes/config.js';
import { usuariosRoutes } from './routes/usuarios.js';

// Origens permitidas para CORS. Por padrão o dev server do Vite (5173).
const ORIGENS_PERMITIDAS = new Set<string>([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

/**
 * Plugin de CORS sem dependência externa: ecoa a origem permitida e trata
 * o preflight OPTIONS. Mantém o conjunto de dependências do contrato.
 */
function aplicarCors(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    const origem = req.headers.origin;
    if (origem && ORIGENS_PERMITIDAS.has(origem)) {
      reply.header('Access-Control-Allow-Origin', origem);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header(
        'Access-Control-Allow-Methods',
        'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      );
      reply.header(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type',
      );
    }

    if (req.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });
}

/**
 * Constrói a instância Fastify com rotas, CORS e autenticação registradas.
 */
export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 5 * 1024 * 1024,
  });

  aplicarCors(app);

  // Health check público (sem prefixo de domínio autenticado).
  app.get('/api/health', async () => ({ ok: true }));

  // Plugin com prefixo /api + auth + rotas de domínio.
  app.register(
    async (api) => {
      registrarAuth(api);
      await api.register(pedidosRoutes);
      await api.register(configRoutes);
      await api.register(usuariosRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}

/**
 * Sobe o servidor HTTP na porta configurada.
 */
export async function startServer(): Promise<void> {
  const app = buildServer();
  try {
    await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
    log.info(`[api] Servidor Fastify ouvindo em http://0.0.0.0:${env.API_PORT}`);
  } catch (err) {
    log.error('[api] Falha ao iniciar o servidor Fastify:', err);
    throw err;
  }
}
