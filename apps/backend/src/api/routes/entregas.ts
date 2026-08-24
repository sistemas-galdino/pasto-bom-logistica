// [AGENTE API] Rotas de ENTREGAS (a viagem) — Onda 2.
//
//   GET   /api/entregas                      -> Entrega[]   (filtros por query)
//   GET   /api/entregas/:id                  -> Entrega
//   GET   /api/pedidos/:id/saldo             -> SaldoItem[]
//   POST  /api/entregas                      -> 201 Entrega (o "agendar")
//   POST  /api/entregas/:id/transicao        -> Entrega
//   POST  /api/entregas/:id/reverter         -> Entrega
//   PATCH /api/entregas/:id/separacao        -> Entrega     ("dar OK" na viagem)
//   PATCH /api/entregas/:id/itens/:itemId/separacao -> Entrega
//   GET   /api/minhas-entregas               -> Entrega[]   (app do motorista)
//
// A autorização "grossa" (leitura x escrita por papel) é do porteiro global
// (auth.ts). Aqui ficam as guardas finas: só logística agenda e reverte; o
// motorista só enxerga e encerra as próprias viagens.
//
// O prefixo /api é aplicado no registro do plugin (server.ts).

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { StatusEntrega } from '@pastobom/shared';

import { log } from '../../log.js';
import { exigirLogistica } from '../guards.js';
import { TransicaoError } from '../../services/erros.js';
import {
  carregarEntrega,
  criarEntrega,
  definirSeparacaoEntrega,
  definirSeparacaoItemEntrega,
  listarEntregas,
  reagendarEntrega,
  reverterEntrega,
  saldoDoPedido,
  transicionarEntrega,
} from '../../services/entregas.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const STATUS: readonly StatusEntrega[] = [
  'agendada',
  'em_rota',
  'entregue',
  'nao_realizado',
  'cancelada',
];

const statusEnum = z.enum([
  'agendada',
  'em_rota',
  'entregue',
  'nao_realizado',
  'cancelada',
]);

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const criarSchema = z.object({
  pedidoId: z.string().uuid(),
  dataAgendada: z.string().regex(DATA_ISO, 'Use o formato YYYY-MM-DD.'),
  periodo: z.enum(['manha', 'tarde']),
  motoristaId: z.string().uuid(),
  caminhaoId: z.string().uuid(),
  propriedadeCodigo: z.string().optional(),
  /** produto_codigo -> quantidade desta viagem. */
  quantidades: z.record(z.string(), z.number().finite().nonnegative()),
  /**
   * produto_codigo -> peso unitário em kg, digitado na tela. Opcional: só vem
   * quando falta peso ou quando a equipe alterou um peso que ela mesma informou
   * antes (o caso da soja, que muda a cada compra).
   */
  pesos: z.record(z.string(), z.number().finite().positive()).optional(),
});

/**
 * Reagendamento: tudo opcional, mas ao menos um campo.
 *
 * O que NÃO está aqui não pode ser reinterpretado depois: quantidades, pesos,
 * propriedade e status ficam fora de propósito — mudar carga ou destino é uma
 * viagem nova, não a mesma noutro dia.
 */
const reagendarSchema = z
  .object({
    dataAgendada: z.string().regex(DATA_ISO, 'Use o formato YYYY-MM-DD.').optional(),
    periodo: z.enum(['manha', 'tarde']).optional(),
    motoristaId: z.string().uuid().optional(),
    caminhaoId: z.string().uuid().optional(),
    motivo: z.string().trim().min(3).max(500).optional(),
    /** Reenviar o aviso ao cliente. Falso por padrão: ver reagendarEntrega. */
    avisarCliente: z.boolean().optional(),
  })
  .refine(
    (o) =>
      o.dataAgendada !== undefined ||
      o.periodo !== undefined ||
      o.motoristaId !== undefined ||
      o.caminhaoId !== undefined,
    { message: 'Informe ao menos um campo a alterar.' },
  );

const transicaoSchema = z.object({
  para: statusEnum,
  observacao: z.string().max(2000).optional(),
  motivo: z.string().max(1000).optional(),
});

const reverterSchema = z.object({ para: statusEnum });

const separacaoSchema = z.object({ separado: z.boolean() });

/** CSV de status ('agendada,em_rota') -> lista validada. */
function parseStatus(bruto: unknown): StatusEntrega[] | undefined {
  if (typeof bruto !== 'string' || bruto.trim() === '') return undefined;
  const lista = bruto
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is StatusEntrega => STATUS.includes(s as StatusEntrega));
  return lista.length > 0 ? lista : undefined;
}

/** Data ISO válida ou undefined (nunca deixa string arbitrária virar filtro). */
function parseData(bruto: unknown): string | undefined {
  if (typeof bruto !== 'string' || !DATA_ISO.test(bruto)) return undefined;
  return bruto;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function entregasRoutes(app: FastifyInstance): Promise<void> {
  // GET /entregas?status=&de=&ate=&motoristaId=&pedidoId=&naoRealizadoDias=
  app.get('/entregas', async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    try {
      const entregas = await listarEntregas({
        status: parseStatus(q.status),
        de: parseData(q.de),
        ate: parseData(q.ate),
        motoristaId:
          typeof q.motoristaId === 'string' ? q.motoristaId : undefined,
        pedidoId: typeof q.pedidoId === 'string' ? q.pedidoId : undefined,
        naoRealizadoDesde: janelaNaoRealizado(q.naoRealizadoDias),
      });
      return reply.send(entregas);
    } catch (err) {
      return responderErro(reply, err, '[GET /entregas]');
    }
  });

  // GET /entregas/:id
  app.get('/entregas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.send(await carregarEntrega(id));
    } catch (err) {
      return responderErro(reply, err, `[GET /entregas/${id}]`);
    }
  });

  // GET /pedidos/:id/saldo — o que ainda falta entregar de um pedido.
  app.get('/pedidos/:id/saldo', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.send(await saldoDoPedido(id));
    } catch (err) {
      return responderErro(reply, err, `[GET /pedidos/${id}/saldo]`);
    }
  });

  // POST /entregas — o "agendar" do quadro. Só logística.
  app.post('/entregas', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const parsed = criarSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message:
          'Informe pedidoId, dataAgendada, periodo, motoristaId, caminhaoId e as quantidades.',
        detalhes: parsed.error.issues,
      });
    }

    try {
      const entrega = await criarEntrega({
        ...parsed.data,
        atorUserId: req.usuario?.id ?? undefined,
      });
      return reply.code(201).send(entrega);
    } catch (err) {
      return responderErro(reply, err, '[POST /entregas]');
    }
  });

  // PATCH /entregas/:id/agendamento — reagendar sem voltar o card. Só logística.
  //
  // Rota com nome próprio, e não um PATCH /entregas/:id genérico: aquilo viraria
  // porta de entrada para editar status, itens e o que mais aparecesse.
  app.patch('/entregas/:id/agendamento', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const parsed = reagendarSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message:
          'Informe ao menos um de: dataAgendada, periodo, motoristaId, caminhaoId.',
        detalhes: parsed.error.issues,
      });
    }

    try {
      const entrega = await reagendarEntrega({
        entregaId: id,
        ...parsed.data,
        atorUserId: req.usuario?.id ?? undefined,
      });
      return reply.send(entrega);
    } catch (err) {
      return responderErro(reply, err, `[PATCH /entregas/${id}/agendamento]`);
    }
  });

  // POST /entregas/:id/transicao
  app.post('/entregas/:id/transicao', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = transicaoSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Corpo da transição inválido.',
        detalhes: parsed.error.issues,
      });
    }

    try {
      const entrega = await transicionarEntrega({
        entregaId: id,
        para: parsed.data.para,
        observacao: parsed.data.observacao,
        motivo: parsed.data.motivo,
        atorUserId: req.usuario?.id ?? undefined,
        atorPapel: req.usuario?.papel,
      });
      return reply.send(entrega);
    } catch (err) {
      return responderErro(reply, err, `[POST /entregas/${id}/transicao]`);
    }
  });

  // POST /entregas/:id/reverter — só logística.
  app.post('/entregas/:id/reverter', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const parsed = reverterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Informe o status de destino da reversão.',
        detalhes: parsed.error.issues,
      });
    }

    try {
      const entrega = await reverterEntrega({
        entregaId: id,
        para: parsed.data.para,
        atorUserId: req.usuario?.id ?? undefined,
        atorPapel: req.usuario?.papel,
      });
      return reply.send(entrega);
    } catch (err) {
      return responderErro(reply, err, `[POST /entregas/${id}/reverter]`);
    }
  });

  // PATCH /entregas/:id/separacao — "dar OK" na viagem inteira.
  // Escrita já restrita a logística + almoxarifado pelo write-gate global.
  app.patch('/entregas/:id/separacao', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = separacaoSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Informe separado: true|false.',
        detalhes: parsed.error.issues,
      });
    }

    try {
      const entrega = await definirSeparacaoEntrega({
        entregaId: id,
        separado: parsed.data.separado,
      });
      return reply.send(entrega);
    } catch (err) {
      return responderErro(reply, err, `[PATCH /entregas/${id}/separacao]`);
    }
  });

  // PATCH /entregas/:id/itens/:itemId/separacao — item a item.
  app.patch('/entregas/:id/itens/:itemId/separacao', async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const parsed = separacaoSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Informe separado: true|false.',
        detalhes: parsed.error.issues,
      });
    }

    try {
      const entrega = await definirSeparacaoItemEntrega({
        entregaId: id,
        itemId,
        separado: parsed.data.separado,
      });
      return reply.send(entrega);
    } catch (err) {
      return responderErro(
        reply,
        err,
        `[PATCH /entregas/${id}/itens/${itemId}/separacao]`,
      );
    }
  });

  // GET /minhas-entregas — a rota do motorista logado.
  //
  // O motorista NUNCA escolhe de quem é a viagem: o filtro é o próprio uid,
  // vindo do token. É a mesma garantia que a rota antiga /minha-rota dava.
  app.get('/minhas-entregas', async (req, reply) => {
    const usuario = req.usuario;
    if (!usuario) {
      // Sem usuário resolvido (ALLOW_NO_AUTH em desenvolvimento) não há "meu".
      return reply.send([]);
    }

    try {
      const entregas = await listarEntregas(
        { motoristaId: usuario.id ?? undefined, status: ['agendada', 'em_rota'] },
        true, // com destino: é o link do Maps do motorista
      );
      return reply.send(entregas);
    } catch (err) {
      return responderErro(reply, err, '[GET /minhas-entregas]');
    }
  });
}

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

/**
 * Converte "?naoRealizadoDias=7" na data de corte das falhas exibidas.
 *
 * A coluna "Não realizado" do quadro é lista de trabalho, não arquivo: o saldo
 * já voltou para a fila sozinho, então a viagem de dois meses atrás ali é só
 * histórico e empurra para fora o que ainda precisa de atenção. Sem o
 * parâmetro, não corta nada.
 */
function janelaNaoRealizado(bruto: unknown): string | undefined {
  const dias = Number(bruto);
  if (!Number.isFinite(dias) || dias <= 0) return undefined;
  const corte = new Date();
  corte.setDate(corte.getDate() - Math.floor(dias));
  const mm = String(corte.getMonth() + 1).padStart(2, '0');
  const dd = String(corte.getDate()).padStart(2, '0');
  return `${corte.getFullYear()}-${mm}-${dd}`;
}

function responderErro(reply: FastifyReply, err: unknown, contexto: string) {
  if (err instanceof TransicaoError) {
    return reply
      .code(err.statusCode)
      .send({ error: err.codigo, message: err.message });
  }
  const mensagem = err instanceof Error ? err.message : String(err);
  log.error(`${contexto} erro inesperado: ${mensagem}`);
  return reply.code(500).send({ error: 'erro_interno', message: mensagem });
}
