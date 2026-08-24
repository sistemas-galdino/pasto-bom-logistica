// [AGENTE API] Frota de caminhões (cadastro da logística, leitura de todos).
//
//   GET    /api/caminhoes                -> Caminhao[]   (qualquer papel autenticado)
//   POST   /api/caminhoes                -> 201 Caminhao (logística)
//   PATCH  /api/caminhoes/:id            -> Caminhao     (logística)
//   GET    /api/caminhoes/:id/limites    -> LimiteEntregasCaminhao[]
//   POST   /api/caminhoes/:id/limites    -> 201          (logística)
//   DELETE /api/caminhoes/:id/limites/:limiteId          (logística)
//
// Não há DELETE: um caminhão só é DESATIVADO (ativo=false). Os pedidos antigos
// apontam para ele e o histórico precisa continuar legível.
//
// O prefixo /api é aplicado no registro do plugin (server.ts).

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { Caminhao, LimiteEntregasCaminhao } from '@pastobom/shared';
import { janelasSeSobrepoem } from '@pastobom/shared';

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

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Janela de limite de entregas. `validoAte` nulo = vigência aberta ("deste mês
 * em diante"), que é o caso comum.
 */
const criarLimiteSchema = z
  .object({
    validoDe: z.string().regex(DATA_ISO, 'Use o formato YYYY-MM-DD.'),
    validoAte: z
      .string()
      .regex(DATA_ISO, 'Use o formato YYYY-MM-DD.')
      .nullable()
      .optional(),
    maxEntregasDia: z.number().int().positive(),
    observacoes: z.string().trim().max(500).optional(),
  })
  .refine((o) => !o.validoAte || o.validoAte >= o.validoDe, {
    message: 'A data final não pode ser antes da inicial.',
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

  // -------------------------------------------------------------------------
  // Limite de ENTREGAS por dia, por janela de vigência (migração 0020)
  //
  // Pedido da Natália: "Criar um setup por período, permitindo definir a
  // quantidade de entregas permitidas para cada caminhão em determinado
  // período. Exemplo: Caminhão X -> período de 01/09 a 30/09 -> máximo de 5
  // entregas por dia."
  //
  // Este teto SOMA-SE à tonelagem; não a substitui. A trava está em
  // services/carga.ts (validarCargaDoAgendamento), que é o ponto único.
  // -------------------------------------------------------------------------

  // GET /caminhoes/:id/limites — leitura liberada: o modal de agendamento avisa
  // do teto antes do clique.
  app.get('/caminhoes/:id/limites', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { data, error } = await supabase
      .from('caminhao_limites')
      .select(COLUNAS_LIMITE)
      .eq('caminhao_id', id)
      .order('valido_de', { ascending: false });

    if (error) {
      log.error(`[GET /caminhoes/${id}/limites] erro: ${error.message}`);
      return reply
        .code(500)
        .send({ error: 'erro_banco', message: error.message });
    }

    return reply.send(
      ((data ?? []) as LimiteRow[]).map(mapearLimite),
    );
  });

  // POST /caminhoes/:id/limites
  app.post('/caminhoes/:id/limites', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const parsed = criarLimiteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message:
          'Informe validoDe (YYYY-MM-DD) e maxEntregasDia (inteiro positivo).',
        detalhes: parsed.error.issues,
      });
    }

    const nova = {
      validoDe: parsed.data.validoDe,
      validoAte: parsed.data.validoAte ?? null,
      maxEntregasDia: parsed.data.maxEntregasDia,
    };

    try {
      // Sobreposição é barrada aqui, e não por constraint: um EXCLUDE com
      // daterange exigiria a extensão btree_gist num banco compartilhado com
      // produção. Duas janelas cobrindo o mesmo dia deixariam a operação sem
      // saber qual teto vale.
      const { data: existentes, error: erroLeitura } = await supabase
        .from('caminhao_limites')
        .select(COLUNAS_LIMITE)
        .eq('caminhao_id', id);
      if (erroLeitura) {
        log.error(
          `[POST /caminhoes/${id}/limites] erro ao ler: ${erroLeitura.message}`,
        );
        return reply
          .code(500)
          .send({ error: 'erro_banco', message: erroLeitura.message });
      }

      const conflito = ((existentes ?? []) as LimiteRow[])
        .map(mapearLimite)
        .find((l) => janelasSeSobrepoem(l, nova));
      if (conflito) {
        return reply.code(409).send({
          error: 'janela_sobreposta',
          message: `Já existe um limite valendo nesse período (de ${
            conflito.validoDe
          }${conflito.validoAte ? ` até ${conflito.validoAte}` : ' em diante'}). Encerre ou remova o anterior antes de criar outro.`,
        });
      }

      const { data, error } = await supabase
        .from('caminhao_limites')
        .insert({
          caminhao_id: id,
          valido_de: nova.validoDe,
          valido_ate: nova.validoAte,
          max_entregas_dia: nova.maxEntregasDia,
          observacoes: parsed.data.observacoes ?? null,
          criado_por: req.usuario?.id ?? null,
        })
        .select(COLUNAS_LIMITE)
        .single<LimiteRow>();

      if (error) {
        log.error(`[POST /caminhoes/${id}/limites] erro: ${error.message}`);
        return reply
          .code(500)
          .send({ error: 'erro_banco', message: error.message });
      }

      return reply.code(201).send(mapearLimite(data));
    } catch (err) {
      return responderErro(reply, err, `[POST /caminhoes/${id}/limites]`);
    }
  });

  // DELETE /caminhoes/:id/limites/:limiteId
  //
  // Aqui o DELETE é legítimo, diferente do caminhão: a janela é configuração,
  // não histórico. Remover não desfaz agendamento nenhum.
  app.delete('/caminhoes/:id/limites/:limiteId', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const { id, limiteId } = req.params as { id: string; limiteId: string };

    const { error } = await supabase
      .from('caminhao_limites')
      .delete()
      .eq('id', limiteId)
      .eq('caminhao_id', id);

    if (error) {
      log.error(
        `[DELETE /caminhoes/${id}/limites/${limiteId}] erro: ${error.message}`,
      );
      return reply
        .code(500)
        .send({ error: 'erro_banco', message: error.message });
    }

    return reply.code(204).send();
  });
}

// ---------------------------------------------------------------------------
// Limites: mapeamento
// ---------------------------------------------------------------------------

const COLUNAS_LIMITE =
  'id, caminhao_id, valido_de, valido_ate, max_entregas_dia, observacoes, criado_em';

interface LimiteRow {
  id: string;
  caminhao_id: string;
  valido_de: string;
  valido_ate: string | null;
  max_entregas_dia: number | string;
  observacoes: string | null;
  criado_em: string;
}

function mapearLimite(row: LimiteRow): LimiteEntregasCaminhao {
  return {
    id: row.id,
    caminhaoId: row.caminhao_id,
    validoDe: row.valido_de,
    validoAte: row.valido_ate,
    maxEntregasDia: Number(row.max_entregas_dia),
    observacoes: row.observacoes,
    criadoEm: row.criado_em,
  };
}

// ---------------------------------------------------------------------------
// Tratamento de erro inesperado (mesmo padrão de pedidos.ts)
// ---------------------------------------------------------------------------

function responderErro(reply: FastifyReply, err: unknown, contexto: string) {
  const mensagem = err instanceof Error ? err.message : String(err);
  log.error(`${contexto} erro inesperado: ${mensagem}`);
  return reply.code(500).send({ error: 'erro_interno', message: mensagem });
}
