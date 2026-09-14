// [AGENTE API] Rotas de cidade — o letreiro de "toda terça, Cabo Verde".
//
//   GET    /api/rotas-cidade        -> RotaCidade[]   (leitura liberada)
//   POST   /api/rotas-cidade        -> 201            (logística)
//   PATCH  /api/rotas-cidade/:id    -> RotaCidade     (logística; só ativo/obs)
//   DELETE /api/rotas-cidade/:id    -> 204            (logística)
//
// O CAMINHO É /api/rotas-cidade, e não /api/rotas: `rotas` colidiria com a
// página /rotas do frontend e com a tabela stub `rotas` da migração 0001.
//
// SEM CAMADA DE SERVICE, de propósito. `services/reservas.ts` existe porque
// reserva OCUPA caminhão e precisa passar por `carga.ts`; a rota de cidade não
// ocupa nada e não fala com ninguém. Aqui é table-in/table-out, e a única regra
// — sobreposição — está no shared, testada.
//
// A leitura é liberada aos quatro papéis de equipe. O VENDEDOR é o motivo de a
// feature existir: "que aí mostra também pros vendedores".
//
// O prefixo /api é aplicado no registro do plugin (server.ts).

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { RotaCidade } from '@pastobom/shared';
import { rotasConflitam } from '@pastobom/shared';

import { supabase } from '../../db/supabase.js';
import { log } from '../../log.js';
import { exigirLogistica } from '../guards.js';

// ---------------------------------------------------------------------------
// Schemas de validação (zod)
// ---------------------------------------------------------------------------

const dataISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD.');

const criarSchema = z.object({
  cidade: z.string().trim().min(1).max(120),
  // 0 = domingo … 6 = sábado. A mesma numeração de Date#getDay, do DIAS_CURTOS
  // do frontend e de extract(dow) — três convenções que já concordam.
  diasSemana: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  periodos: z.array(z.enum(['manha', 'tarde'])).min(1).max(2),
  validoDe: dataISO,
  validoAte: dataISO.nullable().optional(),
  observacoes: z.string().max(500).nullable().optional(),
});

const atualizarSchema = z
  .object({
    ativo: z.boolean().optional(),
    observacoes: z.string().max(500).nullable().optional(),
  })
  .refine((v) => v.ativo !== undefined || v.observacoes !== undefined, {
    message: 'Informe ativo ou observacoes.',
  });

// ---------------------------------------------------------------------------
// Linha do banco
// ---------------------------------------------------------------------------

const COLUNAS =
  'id, cidade, dias_semana, periodos, valido_de, valido_ate, ativo, ' +
  'observacoes, criado_em';

interface RotaRow {
  id: string;
  cidade: string | null;
  dias_semana: number[] | null;
  periodos: ('manha' | 'tarde')[] | null;
  valido_de: string;
  valido_ate: string | null;
  ativo: boolean | null;
  observacoes: string | null;
  criado_em: string;
}

function mapear(row: RotaRow): RotaCidade {
  return {
    id: row.id,
    cidade: row.cidade ?? '',
    diasSemana: (row.dias_semana ?? []).map(Number),
    periodos: row.periodos ?? [],
    validoDe: row.valido_de,
    validoAte: row.valido_ate,
    ativo: row.ativo === true,
    observacoes: row.observacoes,
    criadoEm: row.criado_em,
  };
}

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export async function rotasCidadeRoutes(app: FastifyInstance): Promise<void> {
  // GET /rotas-cidade — TODAS, ativas e pausadas: a tela de configuração
  // precisa mostrar as pausadas para poder religá-las. Quem filtra por ativo é
  // quem desenha o calendário (a regra pura já ignora as inativas).
  app.get('/rotas-cidade', async (_req, reply) => {
    const { data, error } = await supabase
      .from('rotas_cidade')
      .select(COLUNAS)
      .order('cidade', { ascending: true })
      .order('valido_de', { ascending: false });

    if (error) {
      log.error(`[GET /rotas-cidade] erro: ${error.message}`);
      return reply
        .code(500)
        .send({ error: 'erro_banco', message: error.message });
    }

    return reply.send(((data ?? []) as unknown as RotaRow[]).map(mapear));
  });

  // POST /rotas-cidade
  app.post('/rotas-cidade', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;

    const parsed = criarSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message:
          'Informe cidade, ao menos um dia da semana, ao menos um período e validoDe (YYYY-MM-DD).',
        detalhes: parsed.error.issues,
      });
    }

    const nova = {
      id: '',
      cidade: parsed.data.cidade,
      diasSemana: parsed.data.diasSemana,
      periodos: parsed.data.periodos,
      validoDe: parsed.data.validoDe,
      validoAte: parsed.data.validoAte ?? null,
      ativo: true,
    };

    if (nova.validoAte !== null && nova.validoAte < nova.validoDe) {
      return reply.code(422).send({
        error: 'vigencia_invalida',
        message: 'A data final não pode ser anterior à inicial.',
      });
    }

    try {
      // 409 de DUPLICATA: mesma cidade + dia + período + vigência cruzada. A
      // diferença de propósito em relação à 0020 importa — lá a sobreposição
      // criava AMBIGUIDADE (qual teto vale?), aqui cria repetição visual, e um
      // chip duplicado no mesmo dia se lê como defeito do sistema.
      const { data: existentes, error: erroLeitura } = await supabase
        .from('rotas_cidade')
        .select(COLUNAS)
        .eq('ativo', true);

      if (erroLeitura) {
        log.error(`[POST /rotas-cidade] erro ao ler: ${erroLeitura.message}`);
        return reply
          .code(500)
          .send({ error: 'erro_banco', message: erroLeitura.message });
      }

      const conflito = ((existentes ?? []) as unknown as RotaRow[])
        .map(mapear)
        .find((r) => rotasConflitam({ ...r, ativo: true }, nova));

      if (conflito) {
        return reply.code(409).send({
          error: 'rota_duplicada',
          message: `${conflito.cidade} já tem rota nesse dia e período (a partir de ${
            conflito.validoDe
          }${conflito.validoAte ? ` até ${conflito.validoAte}` : ''}). Pause ou remova a anterior antes de criar outra.`,
        });
      }

      const { data, error } = await supabase
        .from('rotas_cidade')
        .insert({
          cidade: nova.cidade,
          dias_semana: nova.diasSemana,
          periodos: nova.periodos,
          valido_de: nova.validoDe,
          valido_ate: nova.validoAte,
          observacoes: parsed.data.observacoes ?? null,
          criado_por: req.usuario?.id ?? null,
        })
        .select(COLUNAS)
        .single<RotaRow>();

      if (error) {
        log.error(`[POST /rotas-cidade] erro: ${error.message}`);
        return reply
          .code(500)
          .send({ error: 'erro_banco', message: error.message });
      }

      return reply.code(201).send(mapear(data));
    } catch (err) {
      return responderErro(reply, err, '[POST /rotas-cidade]');
    }
  });

  // PATCH /rotas-cidade/:id — SÓ `ativo` e `observacoes`.
  //
  // Mudar cidade, dia, período ou vigência é rota NOVA: configuração datada não
  // se reescreve. Quem trocasse "terça" por "quinta" apagaria o registro de que
  // às terças, até ontem, o caminhão ia para Cabo Verde.
  app.patch('/rotas-cidade/:id', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const { id } = req.params as { id: string };

    const parsed = atualizarSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message:
          'Só dá para pausar/religar (ativo) ou trocar a observação. Para mudar dia, período ou vigência, cadastre outra rota.',
        detalhes: parsed.error.issues,
      });
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.ativo !== undefined) patch.ativo = parsed.data.ativo;
    if (parsed.data.observacoes !== undefined) {
      patch.observacoes = parsed.data.observacoes;
    }

    const { data, error } = await supabase
      .from('rotas_cidade')
      .update(patch)
      .eq('id', id)
      .select(COLUNAS)
      .maybeSingle<RotaRow>();

    if (error) {
      log.error(`[PATCH /rotas-cidade/${id}] erro: ${error.message}`);
      return reply
        .code(500)
        .send({ error: 'erro_banco', message: error.message });
    }
    if (!data) {
      return reply
        .code(404)
        .send({ error: 'nao_encontrada', message: 'Rota não encontrada.' });
    }

    return reply.send(mapear(data));
  });

  // DELETE /rotas-cidade/:id
  //
  // Apagar é legítimo: é configuração, não histórico de operação. Nenhuma
  // entrega, reserva ou pedido aponta para cá — remover não desfaz nada.
  app.delete('/rotas-cidade/:id', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const { id } = req.params as { id: string };

    const { error } = await supabase.from('rotas_cidade').delete().eq('id', id);

    if (error) {
      log.error(`[DELETE /rotas-cidade/${id}] erro: ${error.message}`);
      return reply
        .code(500)
        .send({ error: 'erro_banco', message: error.message });
    }

    return reply.code(204).send();
  });
}

function responderErro(reply: FastifyReply, err: unknown, contexto: string) {
  const mensagem = err instanceof Error ? err.message : String(err);
  log.error(`${contexto} erro inesperado: ${mensagem}`);
  return reply.code(500).send({ error: 'erro_interno', message: mensagem });
}
