// [AGENTE API] Rotas de previsão do clima para o dia da entrega.
//
//   GET /api/clima/pedido/:id?data=YYYY-MM-DD&propriedadeCodigo=  -> PrevisaoClima
//   GET /api/clima?pedidos=id1,id2,...                            -> Record<id, PrevisaoClima|null>
//
// O prefixo /api e a autenticação são aplicados no registro do plugin (server.ts).
// Sem guard de papel: logística (modal/board) e motorista (rota) consultam o clima.
// O serviço é best-effort — nunca lança; indisponibilidade vira disponivel:false.

import type { FastifyInstance } from 'fastify';

import { climaDoPedido, climaLote } from '../../services/clima.js';

const MAX_LOTE = 200;

export async function climaRoutes(app: FastifyInstance): Promise<void> {
  // Preview no modal de agendar: data escolhida (ainda não salva) + propriedade
  // selecionada têm prioridade sobre os valores armazenados do pedido.
  app.get('/clima/pedido/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, unknown>;
    const data = typeof q.data === 'string' && q.data ? q.data : undefined;
    const propriedadeCodigo =
      typeof q.propriedadeCodigo === 'string' && q.propriedadeCodigo
        ? q.propriedadeCodigo
        : undefined;

    const previsao = await climaDoPedido(id, data, propriedadeCodigo);
    return reply.send(previsao);
  });

  // Lote para o board e a rota do motorista: usa data_agendada + destino salvos.
  app.get('/clima', async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const ids = String(q.pedidos ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) return reply.send({});
    if (ids.length > MAX_LOTE) {
      return reply.code(400).send({
        error: 'muitos_pedidos',
        message: `Máximo de ${MAX_LOTE} pedidos por consulta.`,
      });
    }

    const mapa = await climaLote(ids);
    return reply.send(mapa);
  });
}
