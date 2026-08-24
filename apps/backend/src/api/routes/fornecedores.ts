// [AGENTE API] Busca no espelho de fornecedores do Órix (migração 0021).
//
//   GET /api/fornecedores?q=&limite= -> FornecedorBusca[]
//
// PARA QUE SERVE
// --------------
// Autocomplete da reserva de caminhão. Pedido da Natália (áudio 5, 08/2026):
// quando o caminhão vai buscar mercadoria num fornecedor, puxar o fornecedor do
// Órix "já vai trazer a cidade" em vez de a pessoa digitar. Quem grava esta
// tabela é o worker (worker/fornecedores.ts); aqui é SÓ LEITURA — a API do Órix
// é somente leitura e o cadastro não se edita pelo nosso sistema.
//
// POR QUE ESTA ROTA TEM TETO OBRIGATÓRIO
// --------------------------------------
// São ~3.600 fornecedores. Devolver a lista inteira num campo de busca seria
// mandar todo o cadastro pelo cabo a cada tela aberta — e o PostgREST corta em
// 1000 EM SILÊNCIO (a armadilha documentada em routes/pedidos.ts), o que daria
// uma lista "completa" mentirosa. Então: `limite` com default 20 e TETO de 50.
// Quem não achou digita mais uma letra.
//
// O prefixo /api é aplicado no registro do plugin (server.ts).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { supabase } from '../../db/supabase.js';
import { log } from '../../log.js';

// ---------------------------------------------------------------------------
// Schema de validação (zod)
// ---------------------------------------------------------------------------

const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 50;

const querySchema = z.object({
  // Termo opcional: sem `q`, devolve as primeiras N por nome — é o que o campo
  // mostra ao abrir, antes de a pessoa digitar.
  q: z.string().trim().max(120).optional(),
  limite: z.coerce.number().int().positive().max(LIMITE_MAXIMO).optional(),
});

// ---------------------------------------------------------------------------
// Guard local
// ---------------------------------------------------------------------------

/**
 * 403 para MOTORISTA e VENDEDOR; libera logística e almoxarifado.
 *
 * Quem lê é a equipe que reserva caminhão. O motorista fica de fora por decisão
 * já tomada na RLS da 0021 ("a reserva já carrega a cidade em texto, então
 * nenhuma tela dele precisa consultar o cadastro de fornecedores"), e o vendedor
 * também: ele consulta a agenda para prometer data ao cliente (routes/agenda.ts)
 * e não cria reserva — cadastro de fornecedor é dado comercial de compra, não
 * material da tela dele.
 *
 * Sem usuário resolvido (ALLOW_NO_AUTH), libera: o porteiro global já assume
 * papel 'logistica' nesse modo. Mesmo formato do guard de routes/agenda.ts.
 */
function exigirLeituraFornecedores(
  req: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const papel = req.usuario?.papel;
  if (!req.usuario || papel === 'logistica' || papel === 'almoxarifado') {
    return true;
  }
  reply.code(403).send({
    error: 'sem_permissao',
    message: 'Sem permissão para consultar o cadastro de fornecedores.',
  });
  return false;
}

// ---------------------------------------------------------------------------
// Mapeamento (snake_case -> camelCase)
// ---------------------------------------------------------------------------

// Uma string literal só: o supabase-js infere o tipo do retorno a partir dela.
// prettier-ignore
const COLUNAS = 'codigo, nome, fantasia, cidade, uf, bairro, cod_municipio';

interface FornecedorRow {
  codigo: string;
  nome: string | null;
  fantasia: string | null;
  cidade: string | null;
  uf: string | null;
  bairro: string | null;
  cod_municipio: string | null;
}

/**
 * Só o que a reserva usa: identificar o fornecedor e preencher a cidade. CNPJ,
 * telefone e e-mail estão no espelho, mas não têm por que sair por esta rota —
 * o autocomplete não os mostra, e cadastro de terceiro que não é necessário não
 * atravessa a fronteira.
 */
interface FornecedorBusca {
  codigo: string;
  nome: string;
  fantasia: string | null;
  cidade: string | null;
  uf: string | null;
  bairro: string | null;
  codMunicipio: string | null;
}

function mapear(row: FornecedorRow): FornecedorBusca {
  return {
    codigo: row.codigo,
    // Fallback para a fantasia: fornecedor cadastrado só com nome fantasia
    // existe, e um item em branco na lista é inútil para quem procura.
    nome: row.nome ?? row.fantasia ?? row.codigo,
    fantasia: row.fantasia,
    cidade: row.cidade,
    uf: row.uf,
    bairro: row.bairro,
    codMunicipio: row.cod_municipio,
  };
}

/**
 * Escapa o termo para o `ilike` do PostgREST.
 *
 * `%` e `_` são curingas do LIKE: um `%` digitado casaria com tudo. E a vírgula
 * separa os ramos dentro de `.or(...)` no PostgREST — sem tirá-la, um nome com
 * vírgula viraria filtro malformado (ou pior, um filtro que não é o pedido).
 */
function escaparTermo(termo: string): string {
  return termo.replace(/[%_,()]/g, ' ');
}

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export async function fornecedoresRoutes(app: FastifyInstance): Promise<void> {
  app.get('/fornecedores', async (req, reply) => {
    if (!exigirLeituraFornecedores(req, reply)) return reply;

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'query_invalida',
        message: `Use q (texto) e limite (inteiro de 1 a ${LIMITE_MAXIMO}).`,
        detalhes: parsed.error.issues,
      });
    }

    const limite = parsed.data.limite ?? LIMITE_PADRAO;
    const termo = parsed.data.q ?? '';

    // Só ATIVOS: o espelho nunca apaga ninguém (fornecedor que sai do Órix
    // continua na tabela para a reserva antiga seguir legível), então é este
    // filtro que mantém a lista útil.
    let consulta = supabase
      .from('fornecedores')
      .select(COLUNAS)
      .eq('ativo', true);

    if (termo !== '') {
      const alvo = `%${escaparTermo(termo)}%`;
      // nome, fantasia E cidade: a logística procura tanto pela razão social
      // quanto pelo apelido do fornecedor, e às vezes lembra só da praça
      // ("aquele de Rio Verde").
      consulta = consulta.or(
        `nome.ilike.${alvo},fantasia.ilike.${alvo},cidade.ilike.${alvo}`,
      );
    }

    const { data, error } = await consulta
      .order('nome', { ascending: true })
      .limit(limite);

    if (error) {
      log.error(`[GET /fornecedores] erro: ${error.message}`);
      return reply
        .code(500)
        .send({ error: 'erro_banco', message: error.message });
    }

    const fornecedores: FornecedorBusca[] = (
      (data ?? []) as FornecedorRow[]
    ).map(mapear);
    return reply.send(fornecedores);
  });
}
