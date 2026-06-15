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

import type {
  DestinoEntrega,
  MotoristaResumo,
  Pedido,
  Propriedade,
  StatusLogistico,
} from '@pastobom/shared';

import { supabase } from '../../db/supabase.js';
import { log } from '../../log.js';
import {
  aplicarTransicao,
  carregarPedido,
  definirMotorista,
  definirSeparacaoItem,
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
  observacao: z.string().max(1000).optional(),
  motoristaId: z.string().uuid().nullable().optional(),
});

const reenviarBodySchema = z.object({
  template: z.string().min(1),
});

const separacaoBodySchema = z.object({
  separado: z.boolean(),
});

const motoristaBodySchema = z.object({
  motoristaId: z.string().uuid().nullable(),
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
  motorista_id: string | null;
  observacoes: string | null;
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
        separado?: boolean | null;
      }[]
    | null;
}

const SELECT_LISTA =
  'id, orix_id_pedido, orix_numero, empresa, cliente_codigo, cliente_nome, ' +
  'cidade_cliente, vendedor_codigo, vendedor_nome, propriedade_codigo, ' +
  'valor_total, data_pedido, status_orix, status_orix_nome, status_logistico, ' +
  'data_agendada, data_entregue, motorista_id, observacoes, criado_em, atualizado_em, ' +
  'itens_pedido(id, produto_codigo, nome_produto, qtd, valor_unit, total, separado)';

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

/** 403 se o usuário autenticado não for logística (rotas restritas). */
function exigirLogistica(
  req: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
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

/**
 * 403 se não for logística nem motorista. A logística faz qualquer transição;
 * o motorista só CONFIRMA a entrega dos próprios pedidos (regra fina no serviço).
 */
function exigirTransicao(
  req: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
): boolean {
  const papel = req.usuario?.papel;
  if (papel === 'logistica' || papel === 'motorista') return true;
  reply.code(403).send({
    error: 'sem_permissao',
    message: 'Sem permissão para aplicar transições.',
  });
  return false;
}

/** Resolve nomes de motorista em lote (não há FK pedidos->profiles). */
async function resolverNomesMotorista(
  linhas: { motorista_id: string | null }[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      linhas
        .map((l) => l.motorista_id)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, nome')
    .in('id', ids);
  if (error) {
    log.warn(`[pedidos] Falha ao resolver nomes de motorista: ${error.message}`);
    return new Map();
  }
  const mapa = new Map<string, string>();
  for (const r of data ?? []) {
    mapa.set(r.id as string, (r.nome as string) ?? '');
  }
  return mapa;
}

function toDestino(r: Record<string, unknown>): DestinoEntrega {
  return {
    latitude: (r.latitude as string) ?? '',
    longitude: (r.longitude as string) ?? '',
    endereco: (r.endereco as string) ?? '',
    cidade: (r.cidade as string) ?? '',
    uf: (r.uf as string) ?? '',
  };
}

/**
 * Anexa o destino de cada pedido (propriedade preferida; senão o cliente).
 * Usado só na "rota do dia" do motorista. Duas queries em lote, sem N+1.
 */
async function anexarDestinos(
  pedidos: Pedido[],
  linhas: PedidoRowLista[],
): Promise<Pedido[]> {
  const propCodigos = [
    ...new Set(
      linhas
        .map((l) => l.propriedade_codigo)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];
  const cliCodigos = [
    ...new Set(
      linhas
        .map((l) => l.cliente_codigo)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];

  const props = new Map<string, DestinoEntrega>();
  if (propCodigos.length > 0) {
    const { data } = await supabase
      .from('propriedades')
      .select('codigo, endereco, cidade, uf, latitude, longitude')
      .in('codigo', propCodigos);
    for (const r of data ?? []) props.set(r.codigo as string, toDestino(r));
  }

  const clis = new Map<string, DestinoEntrega>();
  if (cliCodigos.length > 0) {
    const { data } = await supabase
      .from('clientes')
      .select('codigo, endereco, cidade, uf, latitude, longitude')
      .in('codigo', cliCodigos);
    for (const r of data ?? []) clis.set(r.codigo as string, toDestino(r));
  }

  return pedidos.map((p) => {
    const destino =
      (p.propriedadeCodigo ? props.get(p.propriedadeCodigo) : undefined) ??
      clis.get(p.clienteCodigo) ??
      null;
    return { ...p, destino };
  });
}

export async function pedidosRoutes(app: FastifyInstance): Promise<void> {
  // GET /pedidos?status=pendente,agendada  ou  GET /pedidos?meus=1 (motorista)
  app.get('/pedidos', async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const meus = query.meus === '1' || query.meus === 'true';

    let consulta = supabase.from('pedidos').select(SELECT_LISTA);

    if (meus) {
      // Rota do dia do motorista: só os PRÓPRIOS pedidos em rota.
      const motoristaId = req.usuario?.id;
      if (!motoristaId) return reply.send([]); // sem usuário (ex.: ALLOW_NO_AUTH)
      consulta = consulta
        .eq('motorista_id', motoristaId)
        .eq('status_logistico', 'em_rota');
    } else {
      const filtro = parseStatusQuery(query.status);
      consulta = consulta.in('status_logistico', filtro ?? NAO_FINALIZADOS);
    }

    const { data, error } = await consulta.order('data_pedido', {
      ascending: false,
    });

    if (error) {
      log.error(`[GET /pedidos] erro: ${error.message}`);
      return reply
        .code(500)
        .send({ error: 'erro_banco', message: error.message });
    }

    const linhas = (data ?? []) as unknown as PedidoRowLista[];
    const nomes = await resolverNomesMotorista(linhas);
    let pedidos: Pedido[] = linhas.map((row) =>
      mapearPedido(
        row,
        row.itens_pedido ?? [],
        row.motorista_id ? nomes.get(row.motorista_id) ?? '' : null,
      ),
    );

    // Na rota do motorista, anexa o destino (lat/long ou endereço) p/ o mapa.
    if (meus) {
      pedidos = await anexarDestinos(pedidos, linhas);
    }

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
    if (!exigirTransicao(req, reply)) return reply;
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
        observacao: parsed.data.observacao,
        motoristaId: parsed.data.motoristaId,
        atorUserId: req.usuario?.id ?? undefined,
        atorPapel: req.usuario?.papel,
      });
      return reply.send(pedido);
    } catch (err) {
      return responderErro(reply, err, `[POST /pedidos/${id}/transicao]`);
    }
  });

  // PATCH /pedidos/:id/itens/:itemId/separacao  (RF-2.2)
  app.patch('/pedidos/:id/itens/:itemId/separacao', async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const parsed = separacaoBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Informe separado: boolean.',
        detalhes: parsed.error.issues,
      });
    }

    try {
      const pedido = await definirSeparacaoItem({
        pedidoId: id,
        itemId,
        separado: parsed.data.separado,
      });
      return reply.send(pedido);
    } catch (err) {
      return responderErro(
        reply,
        err,
        `[PATCH /pedidos/${id}/itens/${itemId}/separacao]`,
      );
    }
  });

  // PATCH /pedidos/:id/motorista  (Fase 3 — atribuição pela logística)
  app.patch('/pedidos/:id/motorista', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!exigirLogistica(req, reply)) return reply;
    const parsed = motoristaBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Informe motoristaId: uuid | null.',
        detalhes: parsed.error.issues,
      });
    }

    try {
      const pedido = await definirMotorista({
        pedidoId: id,
        motoristaId: parsed.data.motoristaId,
      });
      return reply.send(pedido);
    } catch (err) {
      return responderErro(reply, err, `[PATCH /pedidos/${id}/motorista]`);
    }
  });

  // GET /motoristas  (Fase 3 — lista p/ a logística atribuir)
  app.get('/motoristas', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, nome')
      .eq('papel', 'motorista')
      .order('nome', { ascending: true });

    if (error) {
      log.error(`[GET /motoristas] erro: ${error.message}`);
      return reply
        .code(500)
        .send({ error: 'erro_banco', message: error.message });
    }

    const motoristas: MotoristaResumo[] = (data ?? []).map((r) => ({
      id: r.id as string,
      nome: (r.nome as string) ?? '',
    }));
    return reply.send(motoristas);
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
    if (!exigirLogistica(req, reply)) return reply;
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
