// [AGENTE API] Frota de caminhões (cadastro da logística, leitura de todos).
//
//   GET   /api/caminhoes       -> Caminhao[]   (qualquer papel autenticado)
//   POST  /api/caminhoes       -> 201 Caminhao (logística)
//   PATCH /api/caminhoes/:id   -> Caminhao     (logística)
//
// Não há DELETE: um caminhão só é DESATIVADO (ativo=false). Os pedidos antigos
// apontam para ele e o histórico precisa continuar legível.
//
// O prefixo /api é aplicado no registro do plugin (server.ts).

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { Caminhao } from '@pastobom/shared';

import { supabase } from '../../db/supabase.js';
import { log } from '../../log.js';
import { exigirLogistica } from '../guards.js';

// ---------------------------------------------------------------------------
// Schemas de validação (zod)
// ---------------------------------------------------------------------------

const criarSchema = z.object({
  nome: z.string().min(1),
  placa: z.string().nullable().optional(),
  capacidadeKg: z.number().finite().positive(),
});

const atualizarSchema = z.object({
  nome: z.string().min(1).optional(),
  placa: z.string().nullable().optional(),
  capacidadeKg: z.number().finite().positive().optional(),
  ativo: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Mapeamento (snake_case -> camelCase)
// ---------------------------------------------------------------------------

interface CaminhaoRow {
  id: string;
  nome: string | null;
  placa: string | null;
  capacidade_kg: number | string | null;
  ativo: boolean | null;
}

const COLUNAS = 'id, nome, placa, capacidade_kg, ativo';

function mapearCaminhao(row: CaminhaoRow): Caminhao {
  const kg = Number(row.capacidade_kg);
  return {
    id: row.id,
    nome: row.nome ?? '',
    placa: row.placa ?? null,
    capacidadeKg: Number.isFinite(kg) ? kg : 0,
    ativo: row.ativo === true,
  };
}

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export async function caminhoesRoutes(app: FastifyInstance): Promise<void> {
  // GET /caminhoes  -> frota completa (inclusive inativos, p/ o histórico).
  // Leitura liberada: a agenda e o modal de agendamento precisam da frota.
  app.get('/caminhoes', async (_req, reply) => {
    const { data, error } = await supabase
      .from('caminhoes')
      .select(COLUNAS)
      .order('nome', { ascending: true });

    if (error) {
      log.error(`[GET /caminhoes] erro: ${error.message}`);
      return reply
        .code(500)
        .send({ error: 'erro_banco', message: error.message });
    }

    const caminhoes: Caminhao[] = ((data ?? []) as CaminhaoRow[]).map(
      mapearCaminhao,
    );
    return reply.send(caminhoes);
  });

  // POST /caminhoes
  app.post('/caminhoes', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const parsed = criarSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Informe nome e capacidadeKg (número positivo).',
        detalhes: parsed.error.issues,
      });
    }

    try {
      const { data, error } = await supabase
        .from('caminhoes')
        .insert({
          nome: parsed.data.nome,
          placa: parsed.data.placa ?? null,
          capacidade_kg: parsed.data.capacidadeKg,
        })
        .select(COLUNAS)
        .single<CaminhaoRow>();

      if (error || !data) {
        const mensagem = error?.message ?? 'Falha ao cadastrar o caminhão.';
        log.error(`[POST /caminhoes] erro: ${mensagem}`);
        return reply.code(500).send({ error: 'erro_banco', message: mensagem });
      }

      return reply.code(201).send(mapearCaminhao(data));
    } catch (err) {
      return responderErro(reply, err, '[POST /caminhoes]');
    }
  });

  // PATCH /caminhoes/:id
  app.patch('/caminhoes/:id', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const parsed = atualizarSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Dados de atualização inválidos (nome, placa, capacidadeKg, ativo).',
        detalhes: parsed.error.issues,
      });
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.nome !== undefined) patch.nome = parsed.data.nome;
    if (parsed.data.placa !== undefined) patch.placa = parsed.data.placa;
    if (parsed.data.capacidadeKg !== undefined) {
      patch.capacidade_kg = parsed.data.capacidadeKg;
    }
    if (parsed.data.ativo !== undefined) patch.ativo = parsed.data.ativo;

    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Informe ao menos um campo para atualizar.',
      });
    }
    patch.atualizado_em = new Date().toISOString();

    try {
      const { data, error } = await supabase
        .from('caminhoes')
        .update(patch)
        .eq('id', id)
        .select(COLUNAS)
        .maybeSingle<CaminhaoRow>();

      if (error) {
        log.error(`[PATCH /caminhoes/${id}] erro: ${error.message}`);
        return reply
          .code(500)
          .send({ error: 'erro_banco', message: error.message });
      }
      if (!data) {
        return reply
          .code(404)
          .send({ error: 'nao_encontrado', message: 'Caminhão não encontrado.' });
      }

      return reply.send(mapearCaminhao(data));
    } catch (err) {
      return responderErro(reply, err, `[PATCH /caminhoes/${id}]`);
    }
  });
}

// ---------------------------------------------------------------------------
// Tratamento de erro inesperado (mesmo padrão de pedidos.ts)
// ---------------------------------------------------------------------------

function responderErro(reply: FastifyReply, err: unknown, contexto: string) {
  const mensagem = err instanceof Error ? err.message : String(err);
  log.error(`${contexto} erro inesperado: ${mensagem}`);
  return reply.code(500).send({ error: 'erro_interno', message: mensagem });
}
