// [AGENTE WORKER] Limpeza dos pedidos de OFICINA já ingeridos — rodar UMA vez
// (npm run limpar:oficina -w @pastobom/backend -- --dry     para só relatar).
//
// CONTEXTO
// --------
// A partir da reunião de 16/07/2026, a ingestão passou a descartar pedidos que
// contêm linha de PRESTAÇÃO DE SERVIÇO (ver worker/ingest.ts, passo "1c"): são
// da oficina, o cliente leva a máquina e busca de volta, e nunca houve entrega.
//
// Mas o filtro só vale dali para a frente. Os que JÁ estavam no banco continuam
// na fila do Johnny — eram 125 dos 134 pedidos em status 00027 (parcial). Este
// script limpa o passivo.
//
// O QUE ELE FAZ
// -------------
// Descarta (status_logistico -> 'cancelada') todo pedido que tenha item com
// código de produto de serviço. Descartar NÃO dispara WhatsApp (a transição
// * -> cancelada não tem template) e é REVERSÍVEL pelo botão "Restaurar" do
// quadro, caso algum caso escape à regra.
//
// NUNCA toca em pedido 'entregue': se a mercadoria já saiu, o histórico fica.
//
// Diferente do backfill de natureza, este script NÃO consulta o Órix: a
// informação necessária (código do produto de cada item) já está no nosso banco.

import { supabase } from '../db/supabase.js';
import { log } from '../log.js';
import { getProdutosServico, temProdutoServico } from '../orix/status.js';

const SECO = process.argv.includes('--dry');

/** Status que NÃO podem ser descartados (desfechos). */
const INTOCAVEIS = ['entregue', 'cancelada'];

interface PedidoLinha {
  id: string;
  orix_numero: string | null;
  status_orix: string | null;
  status_logistico: string;
}

async function main(): Promise<void> {
  const produtosServico = await getProdutosServico();
  log.info(
    `[limpar-oficina] Produtos de serviço: [${produtosServico.join(', ')}]` +
      `${SECO ? ' — MODO SECO (nada será gravado)' : ''}`,
  );

  // 1) Pedidos ainda em aberto (os que aparecem para a equipe).
  const { data: pedidos, error } = await supabase
    .from('pedidos')
    .select('id, orix_numero, status_orix, status_logistico')
    .not('status_logistico', 'in', `(${INTOCAVEIS.join(',')})`);

  if (error) throw new Error(`Falha ao ler pedidos: ${error.message}`);
  const lista = (pedidos ?? []) as PedidoLinha[];
  log.info(`[limpar-oficina] ${lista.length} pedido(s) em aberto para examinar.`);
  if (lista.length === 0) return;

  // 2) Itens de todos eles (em lotes — o `in` tem limite prático de tamanho).
  const codigosPorPedido = new Map<string, string[]>();
  const ids = lista.map((p) => p.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data: itens, error: errItens } = await supabase
      .from('itens_pedido')
      .select('pedido_id, produto_codigo')
      .in('pedido_id', ids.slice(i, i + 200));
    if (errItens) throw new Error(`Falha ao ler itens: ${errItens.message}`);
    for (const it of itens ?? []) {
      const lst = codigosPorPedido.get(it.pedido_id as string) ?? [];
      lst.push(String(it.produto_codigo ?? ''));
      codigosPorPedido.set(it.pedido_id as string, lst);
    }
  }

  // 3) Quem tem serviço, sai.
  const descartar = lista.filter((p) =>
    temProdutoServico(codigosPorPedido.get(p.id) ?? [], produtosServico),
  );

  const porStatus = new Map<string, number>();
  for (const p of descartar) {
    const k = `${p.status_orix} / ${p.status_logistico}`;
    porStatus.set(k, (porStatus.get(k) ?? 0) + 1);
  }
  log.info(`[limpar-oficina] ${descartar.length} pedido(s) de oficina encontrados:`);
  for (const [k, n] of [...porStatus].sort((a, b) => b[1] - a[1])) {
    log.info(`   ${String(n).padStart(4)}  status Órix/logístico ${k}`);
  }

  if (descartar.length === 0) return;

  if (SECO) {
    log.info('[limpar-oficina] MODO SECO: nada foi gravado. Exemplos:');
    for (const p of descartar.slice(0, 15)) {
      log.info(`   OV ${p.orix_numero} (${p.status_orix})`);
    }
    return;
  }

  const agora = new Date().toISOString();
  const alvos = descartar.map((p) => p.id);
  const { error: errUpd } = await supabase
    .from('pedidos')
    .update({ status_logistico: 'cancelada', atualizado_em: agora })
    .in('id', alvos);
  if (errUpd) throw new Error(`Falha ao descartar: ${errUpd.message}`);

  // Auditoria: fica registrado que foi o SISTEMA, e de qual status cada um saiu.
  const eventos = descartar.map((p) => ({
    pedido_id: p.id,
    de_status: p.status_logistico,
    para_status: 'cancelada',
    ator: 'sistema',
  }));
  const { error: errEv } = await supabase.from('eventos_status').insert(eventos);
  if (errEv) {
    log.warn(`[limpar-oficina] Descarte OK, mas falhou a auditoria: ${errEv.message}`);
  }

  log.info(
    `[limpar-oficina] ${descartar.length} pedido(s) de oficina descartado(s) ` +
      '(reversíveis pelo botão "Restaurar" do quadro).',
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log.error('[limpar-oficina] Falhou:', err);
    process.exit(1);
  });
