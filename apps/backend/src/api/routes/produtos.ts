// [AGENTE API] Peso dos produtos (tabela produtos_peso).
//
//   PUT /api/produtos/:codigo/peso   -> PesoProduto  (logística e almoxarifado)
//   GET /api/produtos/pesos?codigos= -> PesoProduto[] (leitura liberada)
//
// O peso é UNITÁRIO e fica salvo NO PRODUTO: digitado uma vez, vale para todos os
// pedidos seguintes. Quem separa a mercadoria (almoxarifado) é quem sabe o peso —
// por isso a escrita não é exclusiva da logística.
//
// O prefixo /api é aplicado no registro do plugin (server.ts).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { PesoProduto } from '@pastobom/shared';

import { supabase } from '../../db/supabase.js';
import { log } from '../../log.js';

// ---------------------------------------------------------------------------
// Schemas de validação (zod)
// ---------------------------------------------------------------------------

const pesoSchema = z.object({
  pesoKg: z.number(),
});

// ---------------------------------------------------------------------------
// Guard local
// ---------------------------------------------------------------------------

/**
 * 403 se o usuário não for logística nem almoxarifado.
 *
 * Sem usuário resolvido (ex.: ALLOW_NO_AUTH) libera — mesmo critério do
 * exigirLogistica em guards.ts.
 */
function exigirPesoProduto(req: FastifyRequest, reply: FastifyReply): boolean {
  const papel = req.usuario?.papel;
  if (!req.usuario || papel === 'logistica' || papel === 'almoxarifado') {
    return true;
  }
  reply.code(403).send({
    error: 'sem_permissao',
    message: 'Apenas logística e almoxarifado podem definir o peso de um produto.',
  });
  return false;
}

// ---------------------------------------------------------------------------
// Mapeamento (snake_case -> camelCase)
// ---------------------------------------------------------------------------

interface PesoRow {
  produto_codigo: string;
  nome_produto: string | null;
  peso_kg: number | string | null;
  origem: string | null;
  atualizado_em: string;
}

const COLUNAS = 'produto_codigo, nome_produto, peso_kg, origem, atualizado_em';

function mapearPeso(row: PesoRow): PesoProduto {
  const kg = Number(row.peso_kg);
  return {
    produtoCodigo: row.produto_codigo,
    nomeProduto: row.nome_produto ?? null,
    pesoKg: Number.isFinite(kg) ? kg : 0,
    origem: row.origem === 'manual' ? 'manual' : 'auto',
    atualizadoEm: row.atualizado_em,
  };
}

/** Nome do produto como aparece nos pedidos; null se ele nunca foi vendido. */
async function nomeDoProduto(codigo: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('itens_pedido')
    .select('nome_produto')
    .eq('produto_codigo', codigo)
    .not('nome_produto', 'is', null)
    .limit(1)
    .maybeSingle<{ nome_produto: string | null }>();

  if (error) {
    log.warn(`[produtos] Falha ao ler o nome do produto ${codigo}: ${error.message}`);
    return null;
  }
  return data?.nome_produto ?? null;
}

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export async function produtosRoutes(app: FastifyInstance): Promise<void> {
  // PUT /produtos/:codigo/peso  -> grava a correção humana (origem='manual')
  app.put('/produtos/:codigo/peso', async (req, reply) => {
    if (!exigirPesoProduto(req, reply)) return reply;
    const { codigo } = req.params as { codigo: string };
    const parsed = pesoSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'body_invalido',
        message: 'Informe pesoKg: number.',
        detalhes: parsed.error.issues,
      });
    }

    const pesoKg = parsed.data.pesoKg;
    if (!Number.isFinite(pesoKg) || pesoKg <= 0) {
      return reply.code(422).send({
        error: 'peso_invalido',
        message: 'O peso precisa ser maior que zero.',
      });
    }

    try {
      const nome = await nomeDoProduto(codigo);

      // 'manual' SEMPRE sobrescreve o 'auto': é a correção de quem pesa de fato.
      // `nome_produto` só entra no payload quando encontrado — assim o upsert não
      // apaga um nome já gravado.
      const linha: Record<string, unknown> = {
        produto_codigo: codigo,
        peso_kg: pesoKg,
        origem: 'manual',
        atualizado_em: new Date().toISOString(),
        atualizado_por: req.usuario?.id ?? null,
      };
      if (nome !== null) linha.nome_produto = nome;

      const { data, error } = await supabase
        .from('produtos_peso')
        .upsert(linha, { onConflict: 'produto_codigo' })
        .select(COLUNAS)
        .single<PesoRow>();

      if (error || !data) {
        const mensagem = error?.message ?? 'Falha ao gravar o peso do produto.';
        log.error(`[PUT /produtos/${codigo}/peso] erro: ${mensagem}`);
        return reply.code(500).send({ error: 'erro_banco', message: mensagem });
      }

      return reply.send(mapearPeso(data));
    } catch (err) {
      return responderErro(reply, err, `[PUT /produtos/${codigo}/peso]`);
    }
  });

  // GET /produtos/pesos?codigos=a,b,c  -> conferência dos pesos já conhecidos
  app.get('/produtos/pesos', async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const codigos = [
      ...new Set(
        String(query.codigos ?? '')
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      ),
    ];
    if (codigos.length === 0) return reply.send([]);

    const { data, error } = await supabase
      .from('produtos_peso')
      .select(COLUNAS)
      .in('produto_codigo', codigos);

    if (error) {
      log.error(`[GET /produtos/pesos] erro: ${error.message}`);
      return reply
        .code(500)
        .send({ error: 'erro_banco', message: error.message });
    }

    const pesos: PesoProduto[] = ((data ?? []) as PesoRow[]).map(mapearPeso);
    return reply.send(pesos);
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
