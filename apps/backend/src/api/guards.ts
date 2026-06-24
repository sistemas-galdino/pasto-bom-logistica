// [AGENTE API] Guards de autorização compartilhados entre os plugins de rotas.
//
// A autorização "grossa" (método x papel) é feita no porteiro global (auth.ts).
// Aqui ficam as guardas "finas" reutilizáveis pelas rotas restritas.

import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * 403 se o usuário autenticado não for logística (rotas restritas).
 *
 * Quando não há usuário resolvido (ex.: ALLOW_NO_AUTH), libera — o porteiro
 * global já assume papel 'logistica' nesse modo.
 */
export function exigirLogistica(
  req: FastifyRequest,
  reply: FastifyReply,
): boolean {
  if (req.usuario && req.usuario.papel !== 'logistica') {
    reply.code(403).send({
      error: 'sem_permissao',
      message: 'Apenas a equipe de logística pode executar esta ação.',
    });
    return false;
  }
  return true;
}
