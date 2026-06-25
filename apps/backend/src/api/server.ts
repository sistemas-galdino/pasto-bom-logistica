// [AGENTE API] Servidor Fastify.
//
//   - Prefixo /api em todas as rotas de domínio.
//   - CORS liberado para o frontend (VITE em http://localhost:5173 por padrão).
//   - Autenticação (auth.ts) registrada no escopo das rotas /api.
//   - GET /api/health fora do escopo autenticado.
//   - Porta = env.API_PORT.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

import { env } from '../config/env.js';
import { log } from '../log.js';
import { registrarAuth } from './auth.js';
import { pedidosRoutes } from './routes/pedidos.js';
import { configRoutes } from './routes/config.js';
import { usuariosRoutes } from './routes/usuarios.js';
import { climaRoutes } from './routes/clima.js';

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
 * Modo "serviço único": serve o frontend React buildado (apps/frontend/dist)
 * no mesmo processo/porta da API. Resolve o caminho a partir deste arquivo
 * (independe do cwd), e só ativa se o build existir — em dev o front roda no
 * Vite (5173) e o dist não existe, então a API segue só como API.
 *
 * Fallback SPA: qualquer GET que não seja /api e não bata num arquivo estático
 * devolve index.html (o React Router resolve a rota no cliente). Rotas /api
 * desconhecidas continuam 404 JSON.
 */
function servirFrontend(app: FastifyInstance): void {
  const frontendDist = fileURLToPath(
    new URL('../../../frontend/dist', import.meta.url),
  );

  if (!existsSync(frontendDist)) {
    log.warn(
      `[api] Frontend buildado não encontrado em ${frontendDist}; servindo apenas a API.`,
    );
    return;
  }

  app.register(fastifyStatic, { root: frontendDist, wildcard: false });

  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found' });
  });

  log.info(`[api] Servindo frontend de ${frontendDist}`);
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
      await api.register(climaRoutes);
    },
    { prefix: '/api' },
  );

  // Serviço único: front + API no mesmo domínio (no-op em dev sem build).
  servirFrontend(app);

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
