// [AGENTE WORKER] Limpeza de pedidos que entraram sob uma regra de gatilho ANTIGA
// (npm run limpar:fora-gatilho -w @pastobom/backend -- --dry     para só relatar).
//
// CONTEXTO
// --------
// A lista de status-gatilho é configurável (sync_state.status_gatilho) e já mudou
// uma vez: o 00028 ("Venda aguardando faturamento 2") saiu na reunião de
// 25/06/2026. Só que mudar a lista impede a ENTRADA de novos — não tira os que já
// tinham entrado. Resultado: 64 pedidos em 00028 continuavam na fila do Johnny,
// sob uma regra que a própria equipe já tinha revogado.
//
// Este script fecha essa lacuna, e não só para o 00028: descarta todo pedido em
// aberto cujo status do Órix não esteja mais na lista de gatilho vigente.
//
// GARANTIAS
// ---------
//  - Descarta para 'cancelada', que NÃO dispara WhatsApp (a transição
//    * -> cancelada não tem template) e é REVERSÍVEL pelo botão "Restaurar".
//  - NUNCA toca em pedido 'entregue' nem em 'cancelada'.
//  - Pedido SEM status do Órix gravado é deixado em paz (não dá para julgar).

import { supabase } from '../db/supabase.js';
import { log } from '../log.js';
import { getStatusGatilho } from '../orix/status.js';

const SECO = process.argv.includes('--dry');

/** Status logísticos que são desfecho — nunca descartar. */
const INTOCAVEIS = ['entregue', 'cancelada'];

interface PedidoLinha {
  id: string;
  orix_numero: string | null;
  status_orix: string | null;
  status_orix_nome: string | null;
  status_logistico: string;
}

async function main(): Promise<void> {
  const gatilho = await getStatusGatilho();
  log.info(
    `[limpar-fora-gatilho] Gatilho vigente: [${gatilho.join(', ')}]` +
      `${SECO ? ' — MODO SECO (nada será gravado)' : ''}`,
  );

  const { data, error } = await supabase
    .from('pedidos')
    .select('id, orix_numero, status_orix, status_orix_nome, status_logistico')
    .not('status_logistico', 'in', `(${INTOCAVEIS.join(',')})`);

  if (error) throw new Error(`Falha ao ler pedidos: ${error.message}`);
  const lista = (data ?? []) as PedidoLinha[];
  log.info(`[limpar-fora-gatilho] ${lista.length} pedido(s) em aberto.`);

  const descartar = lista.filter((p) => {
    const st = (p.status_orix ?? '').trim();
    // Sem status gravado não há como julgar: deixa quieto.
    if (st === '') return false;
    return !gatilho.includes(st);
  });

  const porStatus = new Map<string, number>();
  for (const p of descartar) {
    const k = `${p.status_orix} ${p.status_orix_nome ?? ''}`.trim();
    porStatus.set(k, (porStatus.get(k) ?? 0) + 1);
  }

  log.info(
    `[limpar-fora-gatilho] ${descartar.length} pedido(s) fora do gatilho vigente:`,
  );
  for (const [k, n] of [...porStatus].sort((a, b) => b[1] - a[1])) {
    log.info(`   ${String(n).padStart(4)}  ${k}`);
  }

  if (descartar.length === 0 || SECO) {
    if (SECO && descartar.length > 0) {
      log.info('[limpar-fora-gatilho] MODO SECO: nada foi gravado.');
    }
    return;
  }

  const { error: errUpd } = await supabase
    .from('pedidos')
    .update({
      status_logistico: 'cancelada',
      atualizado_em: new Date().toISOString(),
    })
    .in(
      'id',
      descartar.map((p) => p.id),
    );
  if (errUpd) throw new Error(`Falha ao descartar: ${errUpd.message}`);

  const { error: errEv } = await supabase.from('eventos_status').insert(
    descartar.map((p) => ({
      pedido_id: p.id,
      de_status: p.status_logistico,
      para_status: 'cancelada',
      ator: 'sistema',
    })),
  );
  if (errEv) {
    log.warn(
      `[limpar-fora-gatilho] Descarte OK, mas falhou a auditoria: ${errEv.message}`,
    );
  }

  log.info(
    `[limpar-fora-gatilho] ${descartar.length} pedido(s) descartado(s) ` +
      '(reversíveis pelo botão "Restaurar" do quadro).',
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log.error('[limpar-fora-gatilho] Falhou:', err);
    process.exit(1);
  });
