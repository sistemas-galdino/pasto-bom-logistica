// [AGENTE API] Estoque dos produtos, do espelho do Órix (migração 0024).
//
//   GET /api/estoque?produtos=cod1,cod2  -> Record<codigo, EstoqueProduto|null>
//
// No molde de GET /api/clima?pedidos= — mesma forma de lote por querystring,
// mesmo teto, mesma resposta em mapa com null para o que não se sabe.
//
// POR QUE ENDPOINT PRÓPRIO, E NÃO UM CAMPO EM `SaldoItem`
// ---------------------------------------------------------------------------
// O Quadro calcula saldo NO CLIENTE (lib/saldo-pedidos.ts). Enfiar estoque em
// `SaldoItem` obrigaria as duas pontas a resolvê-lo — e estoque não é do
// pedido: é do PRODUTO. O mesmo produto aparece em dez pedidos com o mesmo
// estoque, e repeti-lo dentro de cada saldo seria dizer o contrário.
//
// `null` É "NÃO SEI", NUNCA ZERO. Ver a regra pura (packages/shared/estoque.ts):
// é o que impede o primeiro dia de uso, com a tabela ainda vazia, de virar um
// alerta em cada item da tela.
//
// SEM GUARD DE PAPEL, como o clima: quem agenda pode ser logística ou
// almoxarifado, e o vendedor consulta antes de prometer ao cliente. A
// autenticação é aplicada no registro do plugin (server.ts).

import type { FastifyInstance } from 'fastify';

import type { EstoqueProduto } from '@pastobom/shared';

import { supabase } from '../../db/supabase.js';
import { log } from '../../log.js';
import { getProdutosServico } from '../../orix/status.js';

/** Mesmo teto do clima. Um pedido não tem 200 produtos distintos. */
const MAX_LOTE = 200;

interface EstoqueRow {
  produto_codigo: string;
  quantidade: number | string | null;
  unidade: string | null;
  atualizado_em: string;
}

export async function estoqueRoutes(app: FastifyInstance): Promise<void> {
  app.get('/estoque', async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const codigos = [
      ...new Set(
        String(q.produtos ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];

    if (codigos.length === 0) return reply.send({});
    if (codigos.length > MAX_LOTE) {
      return reply.code(400).send({
        error: 'muitos_produtos',
        message: `Máximo de ${MAX_LOTE} produtos por consulta.`,
      });
    }

    const mapa: Record<string, EstoqueProduto | null> = {};
    for (const c of codigos) mapa[c] = null;

    // ITEM DE PRESTAÇÃO DE SERVIÇO NÃO TEM ESTOQUE, e isto não é detalhe: na
    // medição de 14/09/2026, o produto MAIS agendado do sistema inteiro é o
    // 11930 (PRESTAÇÃO DE SERVIÇO - MÁQUINAS E PEÇAS), 126 linhas de pedido, com
    // `quantidade: 0` no Órix. Sem este corte, o alerta apareceria em vermelho
    // no item mais comum da operação, todo dia, sempre errado — e a equipe
    // aprenderia em uma semana a ignorar o aviso inteiro.
    //
    // A lista vem de `getProdutosServico()`, a MESMA que a ingestão usa para
    // separar a oficina (sync_state 'produtos_servico', padrão 11930/11931).
    // Uma lista, dois consumidores — acrescentar um código lá vale nos dois.
    let servico: Set<string>;
    try {
      // Zeros à esquerda somem na comparação, como em `temProdutoServico`: o
      // mesmo item aparece como '11930' e '011930' conforme a origem.
      servico = new Set(
        (await getProdutosServico()).map((c) => c.replace(/^0+/, '')),
      );
    } catch (err) {
      // Falhar aqui não pode derrubar a consulta: sem a lista, o pior que
      // acontece é o serviço ganhar um alerta que ninguém pediu.
      log.warn(
        `[GET /estoque] Falha ao ler a lista de produtos de serviço: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      servico = new Set();
    }

    const consultar = codigos.filter(
      (c) => !servico.has(c.replace(/^0+/, '')),
    );
    if (consultar.length === 0) return reply.send(mapa);

    const { data, error } = await supabase
      .from('produtos_estoque')
      .select('produto_codigo, quantidade, unidade, atualizado_em')
      .in('produto_codigo', consultar);

    if (error) {
      // Degrada para "não sei" em vez de 500: o estoque é um AVISO dentro do
      // modal de agendar, e derrubar a tela inteira por causa dele seria trocar
      // uma informação a mais por uma tela que não abre.
      log.error(`[GET /estoque] erro: ${error.message}`);
      return reply.send(mapa);
    }

    for (const row of (data ?? []) as unknown as EstoqueRow[]) {
      const n = Number(row.quantidade);
      // Quantidade ilegível continua "não sei" — não vira zero.
      if (row.quantidade === null || !Number.isFinite(n)) continue;
      mapa[row.produto_codigo] = {
        produtoCodigo: row.produto_codigo,
        quantidade: n,
        unidade: row.unidade,
        atualizadoEm: row.atualizado_em,
      };
    }

    return reply.send(mapa);
  });
}
