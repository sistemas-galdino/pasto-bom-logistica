// [AGENTE API] Rotas de pedidos, propriedades e reenvio de WhatsApp.
//
//   GET  /api/pedidos?status=pendente,agendada   -> Pedido[]
//   GET  /api/pedidos/:id                         -> Pedido
//   POST /api/pedidos/:id/transicao               -> Pedido | 409 | 422
//   GET  /api/clientes/:codigo/propriedades       -> Propriedade[]
//   POST /api/pedidos/:id/reenviar-whatsapp       -> { ok }
//
// O prefixo /api é aplicado no registro do plugin (server.ts).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Pedido, Propriedade, StatusLogistico } from '@pastobom/shared';

import { supabase } from '../../db/supabase.js';
import { log } from '../../log.js';
import {
  aplicarTransicao,
  carregarPedido,
  mapearPedido,
  reenviarWhatsapp,
  TransicaoError,
} from '../../services/transitions.js';

// ---------------------------------------------------------------------------
// Schemas de validação (zod)
// ---------------------------------------------------------------------------

const STATUS_VALIDOS: StatusLogistico[] = [
  'pendente',
  'agendada',
  'em_rota',
  'entregue',
  'cancelada',
];

const statusEnum = z.enum([
  'pendente',
  'agendada',
  'em_rota',
  'entregue',
  'cancelada',
]);

const transicaoBodySchema = z.object({
  para: statusEnum,
  propriedadeCodigo: z.string().min(1).optional(),
  dataAgendada: z.string().min(1).optional(),
});

const reenviarBodySchema = z.object({
  template: z.string().min(1),
});

// Status considerados "finalizados" (excluídos da listagem padrão).
const FINALIZADOS: StatusLogistico[] = ['entregue', 'cancelada'];
const NAO_FINALIZADOS: StatusLogistico[] = STATUS_VALIDOS.filter(
  (s) => !FINALIZADOS.includes(s),
);

// ---------------------------------------------------------------------------
// Helpers de mapeamento de lista
// ---------------------------------------------------------------------------

interface PedidoRowLista {
  id: string;
  orix_id_pedido: string;
  orix_numero: string | null;
  empresa: number | null;
  cliente_codigo: string | null;
  cliente_nome: string | null;
  cidade_cliente: string | null;
  vendedor_codigo: string | null;
  vendedor_nome: string | null;
  propriedade_codigo: string | null;
  valor_total: number | string | null;
  data_pedido: string | null;
  status_orix: string | null;
  status_orix_nome: string | null;
  status_logistico: StatusLogistico;
  data_agendada: string | null;
  data_entregue: string | null;
  criado_em: string;
  atualizado_em: string;
  itens_pedido?:
    | {
        id: string;
        produto_codigo: string | null;
        nome_produto: string | null;
        qtd: number | string | null;
        valor_unit: number | string | null;
        total: number | string | null;
      }[]
    | null;
}

const SELECT_LISTA =
  'id, orix_id_pedido, orix_numero, empresa, cliente_codigo, cliente_nome, ' +
  'cidade_cliente, vendedor_codigo, vendedor_nome, propriedade_codigo, ' +
  'valor_total, data_pedido, status_orix, status_orix_nome, status_logistico, ' +
  'data_agendada, data_entregue, criado_em, atualizado_em, ' +
  'itens_pedido(id, produto_codigo, nome_produto, qtd, valor_unit, total)';

function parseStatusQuery(raw: unknown): StatusLogistico[] | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const partes = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const validos = partes.filter((p): p is StatusLogistico =>
    (STATUS_VALIDOS as string[]).includes(p),
  );
  return validos.length > 0 ? validos : null;
}

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export async function pedidosRoutes(app: FastifyInstance): Promise<void> {
  // GET /pedidos?status=pendente,agendada
  app.get('/pedidos', async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const filtro = parseStatusQuery(query.status);
    const statusFinal = filtro ?? NAO_FINALIZADOS;

    const { data, error } = await supabase
      .from('pedidos')
      .select(SELECT_LISTA)
      .in('status_logistico', statusFinal)
      .order('data_pedido', { ascending: false });

    if (error) {
      log.error(`[GET /pedidos] erro: ${error.message}`);
      return reply
        .code(500)
        .send({ error: 'erro_banco', message: error.message });
    }

    const linhas = (data ?? []) as unknown as PedidoRowLista[];
    const pedidos: Pedido[] = linhas.map((row) =>
      mapearPedido(row, row.itens_pedido ?? []),
    );
    return reply.send(pedidos);
  });

  // GET /pedidos/:id
  app.get('/pedidos/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const pedido = await carregarPedido(id);
      return reply.send(pedido);
    } catch (err) {
      return responderErro(reply, err, `[GET /pedidos/${id}]`);
    }
  });

  // POST /pedidos/:id/transicao
  app.post('/pedidos/:id/transicao', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = transicaoBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Corpo da transição inválido.',
        detalhes: parsed.error.issues,
      });
    }

    try {
      const pedido = await aplicarTransicao({
        pedidoId: id,
        para: parsed.data.para,
        propriedadeCodigo: parsed.data.propriedadeCodigo,
        dataAgendada: parsed.data.dataAgendada,
        atorUserId: req.usuario?.id ?? undefined,
      });
      return reply.send(pedido);
    } catch (err) {
      return responderErro(reply, err, `[POST /pedidos/${id}/transicao]`);
    }
  });

  // GET /clientes/:codigo/propriedades
  app.get('/clientes/:codigo/propriedades', async (req, reply) => {
    const { codigo } = req.params as { codigo: string };

    const { data, error } = await supabase
      .from('propriedades')
      .select(
        'codigo, cliente_codigo, nome, endereco, cidade, uf, latitude, longitude',
      )
      .eq('cliente_codigo', codigo)
      .order('codigo', { ascending: true });

    if (error) {
      log.error(`[GET /clientes/${codigo}/propriedades] erro: ${error.message}`);
      return reply
        .code(500)
        .send({ error: 'erro_banco', message: error.message });
    }

    const propriedades: Propriedade[] = (data ?? []).map((r) => ({
      codigo: r.codigo as string,
      clienteCodigo: (r.cliente_codigo as string) ?? '',
      nome: (r.nome as string) ?? '',
      endereco: (r.endereco as string) ?? '',
      cidade: (r.cidade as string) ?? '',
      uf: (r.uf as string) ?? '',
      latitude: (r.latitude as string) ?? '',
      longitude: (r.longitude as string) ?? '',
    }));
    return reply.send(propriedades);
  });

  // POST /pedidos/:id/reenviar-whatsapp
  app.post('/pedidos/:id/reenviar-whatsapp', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = reenviarBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Informe o template a reenviar.',
        detalhes: parsed.error.issues,
      });
    }

    try {
      const resultado = await reenviarWhatsapp({
        pedidoId: id,
        template: parsed.data.template,
      });
      return reply.send(resultado);
    } catch (err) {
      return responderErro(
        reply,
        err,
        `[POST /pedidos/${id}/reenviar-whatsapp]`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Tratamento de erro centralizado (mapeia TransicaoError -> HTTP)
// ---------------------------------------------------------------------------

function responderErro(
  reply: import('fastify').FastifyReply,
  err: unknown,
  contexto: string,
) {
  if (err instanceof TransicaoError) {
    if (err.statusCode >= 500) {
      log.error(`${contexto} ${err.codigo}: ${err.message}`);
    }
    return reply
      .code(err.statusCode)
      .send({ error: err.codigo, message: err.message });
  }
  const mensagem = err instanceof Error ? err.message : String(err);
  log.error(`${contexto} erro inesperado: ${mensagem}`);
  return reply
    .code(500)
    .send({ error: 'erro_interno', message: mensagem });
}
