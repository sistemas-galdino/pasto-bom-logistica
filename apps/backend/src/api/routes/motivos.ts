// [AGENTE API] Motivos de não entrega (cadastro da logística, leitura de todos).
//
//   GET   /api/motivos            -> MotivoNaoEntrega[]  (ativos; ?todos=1 inclui inativos)
//   POST  /api/motivos            -> 201 MotivoNaoEntrega (logística)
//   PATCH /api/motivos/:id        -> MotivoNaoEntrega     (logística)
//
// Não há DELETE: um motivo só é DESATIVADO. Os registros antigos guardam a
// descrição em texto (pedidos.motivo_nao_entrega), mas apagar a linha tiraria a
// opção da lista sem avisar ninguém — desativar deixa o rastro.
//
// Por que isto existe: na reunião de 16/07/2026 o Guto apontou que, com motivo
// digitado livremente, cada pessoa cria o seu e o filtro por motivo deixa de
// funcionar. O cadastro ficou restrito ao admin e a escolha, restrita à lista.
//
// O prefixo /api é aplicado no registro do plugin (server.ts).

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { MotivoNaoEntrega } from '@pastobom/shared';

import { supabase } from '../../db/supabase.js';
import { log } from '../../log.js';
import { exigirLogistica } from '../guards.js';

// ---------------------------------------------------------------------------
// Schemas de validação (zod)
// ---------------------------------------------------------------------------

const MAX_DESCRICAO = 120;

const criarSchema = z.object({
  descricao: z.string().trim().min(1).max(MAX_DESCRICAO),
  ordem: z.number().int().optional(),
});

const atualizarSchema = z.object({
  descricao: z.string().trim().min(1).max(MAX_DESCRICAO).optional(),
  ativo: z.boolean().optional(),
  ordem: z.number().int().optional(),
});

// ---------------------------------------------------------------------------
// Mapeamento (snake_case -> camelCase)
// ---------------------------------------------------------------------------

interface MotivoRow {
  id: string;
  descricao: string | null;
  ativo: boolean | null;
  ordem: number | string | null;
  criado_em: string;
}

const COLUNAS = 'id, descricao, ativo, ordem, criado_em';

function mapearMotivo(row: MotivoRow): MotivoNaoEntrega {
  const ordem = Number(row.ordem);
  return {
    id: row.id,
    descricao: row.descricao ?? '',
    ativo: row.ativo === true,
    ordem: Number.isFinite(ordem) ? ordem : 0,
    criadoEm: row.criado_em,
  };
}

/** O índice único é sobre lower(descricao) — traduz o erro do Postgres. */
function ehDescricaoDuplicada(mensagem: string): boolean {
  return (
    mensagem.includes('idx_motivos_descricao_unica') ||
    mensagem.includes('duplicate key')
  );
}

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export async function motivosRoutes(app: FastifyInstance): Promise<void> {
  // GET /motivos — ativos por padrão; ?todos=1 traz também os desativados
  // (é o que a tela de administração precisa para reativar um motivo).
  app.get('/motivos', async (req, reply) => {
    const { todos } = req.query as { todos?: string };
    const incluirInativos = todos === '1' || todos === 'true';

    let consulta = supabase.from('motivos_nao_entrega').select(COLUNAS);
    if (!incluirInativos) consulta = consulta.eq('ativo', true);

    const { data, error } = await consulta
      .order('ordem', { ascending: true })
      .order('descricao', { ascending: true });

    if (error) {
      log.error(`[GET /motivos] erro: ${error.message}`);
      return reply
        .code(500)
        .send({ error: 'erro_banco', message: error.message });
    }

    return reply.send(((data ?? []) as MotivoRow[]).map(mapearMotivo));
  });

  // POST /motivos
  app.post('/motivos', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const parsed = criarSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: `Informe a descrição do motivo (até ${MAX_DESCRICAO} caracteres).`,
        detalhes: parsed.error.issues,
      });
    }

    try {
      const { data, error } = await supabase
        .from('motivos_nao_entrega')
        .insert({
          descricao: parsed.data.descricao,
          ordem: parsed.data.ordem ?? 0,
        })
        .select(COLUNAS)
        .single<MotivoRow>();

      if (error || !data) {
        const mensagem = error?.message ?? 'Falha ao cadastrar o motivo.';
        if (error && ehDescricaoDuplicada(mensagem)) {
          return reply.code(409).send({
            error: 'motivo_duplicado',
            message: 'Já existe um motivo com essa descrição.',
          });
        }
        log.error(`[POST /motivos] erro: ${mensagem}`);
        return reply.code(500).send({ error: 'erro_banco', message: mensagem });
      }

      return reply.code(201).send(mapearMotivo(data));
    } catch (err) {
      return responderErro(reply, err, '[POST /motivos]');
    }
  });

  // PATCH /motivos/:id  — renomear, reordenar ou (des)ativar.
  app.patch('/motivos/:id', async (req, reply) => {
    if (!exigirLogistica(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const parsed = atualizarSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Dados de atualização inválidos (descricao, ativo, ordem).',
        detalhes: parsed.error.issues,
      });
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.descricao !== undefined) {
      patch.descricao = parsed.data.descricao;
    }
    if (parsed.data.ativo !== undefined) patch.ativo = parsed.data.ativo;
    if (parsed.data.ordem !== undefined) patch.ordem = parsed.data.ordem;

    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Informe ao menos um campo para atualizar.',
      });
    }

    try {
      const { data, error } = await supabase
        .from('motivos_nao_entrega')
        .update(patch)
        .eq('id', id)
        .select(COLUNAS)
        .maybeSingle<MotivoRow>();

      if (error) {
        if (ehDescricaoDuplicada(error.message)) {
          return reply.code(409).send({
            error: 'motivo_duplicado',
            message: 'Já existe um motivo com essa descrição.',
          });
        }
        log.error(`[PATCH /motivos/${id}] erro: ${error.message}`);
        return reply
          .code(500)
          .send({ error: 'erro_banco', message: error.message });
      }
      if (!data) {
        return reply
          .code(404)
          .send({ error: 'nao_encontrado', message: 'Motivo não encontrado.' });
      }

      return reply.send(mapearMotivo(data));
    } catch (err) {
      return responderErro(reply, err, `[PATCH /motivos/${id}]`);
    }
  });
}

// ---------------------------------------------------------------------------
// Tratamento de erro inesperado (mesmo padrão de caminhoes.ts)
// ---------------------------------------------------------------------------

function responderErro(reply: FastifyReply, err: unknown, contexto: string) {
  const mensagem = err instanceof Error ? err.message : String(err);
  log.error(`${contexto} erro inesperado: ${mensagem}`);
  return reply.code(500).send({ error: 'erro_interno', message: mensagem });
}
