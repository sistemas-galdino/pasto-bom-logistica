// [AGENTE WORKER] Backfill de natureza — rodar UMA vez
// (npm run backfill:natureza -w @pastobom/backend).
//
// Os pedidos ingeridos ANTES do filtro por natureza não têm a coluna preenchida —
// e alguns nem deveriam estar no painel. Este script:
//   1) consulta o Órix e descobre a natureza de cada pedido já ingerido;
//   2) grava natureza/natureza_nome em pedidos;
//   3) DESCARTA (status_logistico -> 'cancelada') os que não são '00001'/'00012'.
//
// Descartar = ir para 'cancelada', que NÃO dispara WhatsApp (templateDaTransicao:
// * -> cancelada é null) e é reversível pelo botão "Restaurar" da tela. Pedidos já
// entregues NUNCA são tocados — o histórico é sagrado.
//
// Passe --dry para só relatar, sem escrever nada.

import { OrixClient } from '../orix/client.js';
import { getNaturezaPermitida, normalizarNatureza } from '../orix/status.js';
import { env } from '../config/env.js';
import { supabase } from '../db/supabase.js';
import { log } from '../log.js';

/** Janela varrida no Órix. Cobre com folga o histórico já ingerido. */
const DIAS_HISTORICO = 240;
/** A API do Órix limita a janela; o poll usa 16 dias por chamada. */
const MAX_DIAS_JANELA = 16;

const SECO = process.argv.includes('--dry');

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}

/** Sub-janelas de no máximo MAX_DIAS_JANELA dias, cobrindo o histórico. */
function subJanelas(): { dataInicial: string; dataFinal: string }[] {
  const hoje = new Date();
  const janelas: { dataInicial: string; dataFinal: string }[] = [];
  for (let offset = DIAS_HISTORICO; offset > 0; offset -= MAX_DIAS_JANELA) {
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - offset);
    const fim = new Date(hoje);
    fim.setDate(fim.getDate() - Math.max(offset - MAX_DIAS_JANELA + 1, 0));
    janelas.push({ dataInicial: iso(inicio), dataFinal: iso(fim) });
  }
  return janelas;
}

/**
 * natureza de cada pedido, direto do Órix (orix_id_pedido -> {codigo, nome}).
 * Sem filtro de status: precisamos da natureza de TUDO que já ingerimos, inclusive
 * de pedidos que no ERP já avançaram para outro status.
 */
async function lerNaturezasDoOrix(): Promise<Map<string, { codigo: string; nome: string }>> {
  const orix = new OrixClient({
    baseUrl: env.ORIX_BASE_URL,
    login: env.ORIX_LOGIN,
    senha: env.ORIX_SENHA,
  });

  const mapa = new Map<string, { codigo: string; nome: string }>();
  const janelas = subJanelas();

  for (const [i, janela] of janelas.entries()) {
    const itens = await orix.getPedidos({
      dataInicial: janela.dataInicial,
      dataFinal: janela.dataFinal,
      somenteVendas: false,
      empresas: [env.ORIX_EMPRESA],
    });
    for (const item of itens) {
      const id = String(item.id_pedido ?? '');
      if (!id || mapa.has(id)) continue;
      mapa.set(id, {
        codigo: normalizarNatureza(item.natureza),
        nome: String(item.nome_natureza ?? ''),
      });
    }
    log.info(
      `[backfill-natureza] Janela ${i + 1}/${janelas.length} (${janela.dataInicial}→${
        janela.dataFinal
      }): ${itens.length} itens; ${mapa.size} pedidos conhecidos.`,
    );
  }

  return mapa;
}

interface PedidoLocal {
  id: string;
  orix_id_pedido: string;
  cliente_nome: string | null;
  status_logistico: string;
}

async function main(): Promise<void> {
  const permitidas = await getNaturezaPermitida();
  log.info(
    `[backfill-natureza] Naturezas que viram entrega: ${permitidas.join(', ')}${
      SECO ? '  (MODO SECO — nada será escrito)' : ''
    }`,
  );

  const { data, error } = await supabase
    .from('pedidos')
    .select('id, orix_id_pedido, cliente_nome, status_logistico');
  if (error) throw new Error(`Falha ao ler pedidos: ${error.message}`);

  const pedidos = (data ?? []) as PedidoLocal[];
  if (pedidos.length === 0) {
    log.info('[backfill-natureza] Nenhum pedido no banco; nada a fazer.');
    return;
  }
  log.info(`[backfill-natureza] ${pedidos.length} pedidos no banco.`);

  const naturezas = await lerNaturezasDoOrix();

  const semNatureza: PedidoLocal[] = [];
  const descartar: (PedidoLocal & { natureza: string; nome: string })[] = [];
  const contagem = new Map<string, number>();
  let atualizados = 0;

  for (const p of pedidos) {
    const nat = naturezas.get(p.orix_id_pedido);
    if (!nat || !nat.codigo) {
      semNatureza.push(p);
      continue;
    }

    const rotulo = `${nat.codigo} ${nat.nome}`.trim();
    contagem.set(rotulo, (contagem.get(rotulo) ?? 0) + 1);

    if (!SECO) {
      const { error: errUpd } = await supabase
        .from('pedidos')
        .update({ natureza: nat.codigo, natureza_nome: nat.nome })
        .eq('id', p.id);
      if (errUpd) {
        log.warn(`[backfill-natureza] Falha ao gravar ${p.orix_id_pedido}: ${errUpd.message}`);
        continue;
      }
      atualizados += 1;
    }

    // 'entregue' nunca volta atrás: histórico não se reescreve, mesmo que a
    // natureza seja das que hoje não entram.
    if (!permitidas.includes(nat.codigo) && p.status_logistico !== 'entregue') {
      descartar.push({ ...p, natureza: nat.codigo, nome: nat.nome });
    }
  }

  log.info('[backfill-natureza] ---------------------------------------------');
  log.info('[backfill-natureza] Naturezas encontradas no banco:');
  for (const [rotulo, n] of [...contagem].sort((a, b) => b[1] - a[1])) {
    const marca = permitidas.includes(rotulo.slice(0, 5)) ? '✅' : '❌';
    log.info(`[backfill-natureza]   ${marca} ${n.toString().padStart(4)} × ${rotulo}`);
  }
  if (semNatureza.length > 0) {
    log.warn(
      `[backfill-natureza] ${semNatureza.length} pedido(s) não encontrados no Órix ` +
        `(fora da janela de ${DIAS_HISTORICO} dias) — mantidos como estão.`,
    );
  }
  log.info('[backfill-natureza] ---------------------------------------------');

  if (descartar.length === 0) {
    log.info('[backfill-natureza] Nenhum pedido a descartar. Painel limpo.');
    return;
  }

  log.info(`[backfill-natureza] A DESCARTAR (${descartar.length}):`);
  for (const p of descartar) {
    log.info(
      `[backfill-natureza]   - ${p.orix_id_pedido}  ${p.cliente_nome ?? ''}  ` +
        `[${p.natureza} ${p.nome}]  (${p.status_logistico})`,
    );
  }

  if (SECO) {
    log.info('[backfill-natureza] MODO SECO: nada foi escrito.');
    return;
  }

  const ids = descartar.map((p) => p.id);
  const { error: errDesc } = await supabase
    .from('pedidos')
    .update({ status_logistico: 'cancelada', atualizado_em: new Date().toISOString() })
    .in('id', ids);
  if (errDesc) throw new Error(`Falha ao descartar: ${errDesc.message}`);

  const eventos = descartar.map((p) => ({
    pedido_id: p.id,
    de_status: p.status_logistico,
    para_status: 'cancelada',
    ator: 'sistema',
  }));
  const { error: errEv } = await supabase.from('eventos_status').insert(eventos);
  if (errEv) {
    log.warn(`[backfill-natureza] Descarte OK, mas falhou a auditoria: ${errEv.message}`);
  }

  log.info(
    `[backfill-natureza] ${atualizados} pedido(s) com natureza gravada; ` +
      `${descartar.length} descartado(s) (reversíveis pelo botão "Restaurar").`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log.error('[backfill-natureza] Falhou:', err);
    process.exit(1);
  });
