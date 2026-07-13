// [AGENTE API] Backfill de pesos — rodar UMA vez (npm run backfill:pesos -w @pastobom/backend).
//
// Varre os produtos DISTINTOS já ingeridos (itens_pedido), tenta extrair o peso do
// NOME de cada um (parser de @pastobom/shared, origem='auto') e grava em
// produtos_peso. Da ingestão em diante isso acontece sozinho (worker/ingest.ts);
// este script cobre o histórico que entrou antes da mudança.
//
// Nunca sobrescreve peso existente — em especial os 'manual', que são a correção
// humana. Ao final imprime o que a equipe ainda vai ter de digitar à mão.

import { lerPesosProdutos, semearPesosAuto } from '../services/carga.js';
import { supabase } from '../db/supabase.js';
import { log } from '../log.js';

/** Páginas do Supabase (o PostgREST corta em 1000 linhas por requisição). */
const TAMANHO_PAGINA = 1000;
/** Lotes pequenos nas consultas por `in(...)` para não estourar o tamanho da URL. */
const TAMANHO_LOTE = 200;

interface LinhaItem {
  produto_codigo: string | null;
  nome_produto: string | null;
}

/** Produtos distintos já ingeridos (produto_codigo -> nome_produto). */
async function lerProdutosDistintos(): Promise<Map<string, string>> {
  const produtos = new Map<string, string>();
  let pagina = 0;

  for (;;) {
    const de = pagina * TAMANHO_PAGINA;
    const { data, error } = await supabase
      .from('itens_pedido')
      .select('produto_codigo, nome_produto')
      .order('produto_codigo', { ascending: true })
      .range(de, de + TAMANHO_PAGINA - 1);

    if (error) {
      throw new Error(`Falha ao ler itens_pedido: ${error.message}`);
    }

    const linhas = (data ?? []) as LinhaItem[];
    for (const l of linhas) {
      const codigo = l.produto_codigo ?? '';
      if (codigo) produtos.set(codigo, l.nome_produto ?? '');
    }

    if (linhas.length < TAMANHO_PAGINA) break;
    pagina += 1;
  }

  return produtos;
}

function emLotes<T>(valores: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < valores.length; i += tamanho) {
    lotes.push(valores.slice(i, i + tamanho));
  }
  return lotes;
}

async function main(): Promise<void> {
  log.info('[backfill-pesos] Lendo os produtos distintos de itens_pedido...');
  const produtos = await lerProdutosDistintos();

  if (produtos.size === 0) {
    log.info('[backfill-pesos] Nenhum item ingerido ainda; nada a fazer.');
    return;
  }

  const lista = [...produtos].map(([codigo, nome]) => ({ codigo, nome }));

  let semeados = 0;
  for (const lote of emLotes(lista, TAMANHO_LOTE)) {
    semeados += await semearPesosAuto(lote);
  }

  // Recontagem depois da semeadura: o que sobrou é o que a equipe vai digitar.
  const comPeso = new Set<string>();
  for (const lote of emLotes([...produtos.keys()], TAMANHO_LOTE)) {
    const pesos = await lerPesosProdutos(lote);
    for (const codigo of pesos.keys()) comPeso.add(codigo);
  }

  const semPeso = lista.filter((p) => !comPeso.has(p.codigo));
  const amostra = semPeso.slice(0, 10);

  log.info('[backfill-pesos] ---------------------------------------------');
  log.info(`[backfill-pesos] Produtos distintos:       ${produtos.size}`);
  log.info(`[backfill-pesos] Peso automático (agora):  ${semeados}`);
  log.info(`[backfill-pesos] Com peso (total):         ${comPeso.size}`);
  log.info(`[backfill-pesos] Ainda SEM peso:           ${semPeso.length}`);

  if (amostra.length > 0) {
    log.info(
      `[backfill-pesos] Amostra do que falta digitar (${amostra.length} de ${semPeso.length}):`,
    );
    for (const p of amostra) {
      log.info(`[backfill-pesos]   - ${p.codigo}  ${p.nome}`);
    }
  }
  log.info('[backfill-pesos] ---------------------------------------------');
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log.error('[backfill-pesos] Falhou:', err);
    process.exit(1);
  });
