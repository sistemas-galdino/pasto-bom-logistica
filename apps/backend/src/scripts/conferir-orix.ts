// [AGENTE WORKER] Placar Órix x quadro — READ-ONLY, nunca grava nada:
//
//   npm run conferir:orix -w @pastobom/backend              (365 dias)
//   npm run conferir:orix -w @pastobom/backend -- --dias=90
//
// POR QUE ISTO EXISTE (investigação de 11/08/2026)
// -----------------------------------------------
// A Natália exportou do Órix os três status de gatilho e comparou com o quadro:
// faltavam pedidos. Descobrir isso custou exportar três planilhas, cruzar na mão
// e consultar a API — trabalho demais para uma pergunta que a equipe vai
// repetir. Este script responde a mesma pergunta em um comando.
//
// E ele responde COM O MESMO FILTRO do sistema. Comparar o quadro com a
// exportação crua do Órix nunca vai bater: a natureza 00011 é a duplicata
// fiscal da 00012 (ingerir as duas mostraria a mesma entrega duas vezes) e o
// pedido de oficina é excluído de propósito. O placar aqui separa "o sistema
// excluiu por regra" de "o sistema perdeu", que é a distinção que importa.

import { OrixClient } from '../orix/client.js';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { log } from '../log.js';
import { dividirEmSubJanelas, DIAS_VARREDURA_PROFUNDA } from '../worker/poll.js';
import {
  getNaturezaPermitida,
  getProdutosServico,
  getStatusGatilho,
  normalizarNatureza,
  temProdutoServico,
} from '../orix/status.js';

const argDias = process.argv.find((a) => a.startsWith('--dias='));
const DIAS = argDias
  ? Math.max(1, Number.parseInt(argDias.split('=')[1] ?? '', 10) || DIAS_VARREDURA_PROFUNDA)
  : DIAS_VARREDURA_PROFUNDA;

interface PedidoOrix {
  idPedido: string;
  numero: string;
  data: string | null;
  status: string;
  natureza: string;
  produtos: string[];
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dataOrixParaISO(valor: string): string | null {
  const m = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const i = valor.match(/^(\d{4}-\d{2}-\d{2})/);
  return i ? (i[1] as string) : null;
}

async function main(): Promise<void> {
  const gatilho = await getStatusGatilho();
  const naturezasOk = await getNaturezaPermitida();
  const produtosServico = await getProdutosServico();

  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - DIAS * 86_400_000);
  const subJanelas = dividirEmSubJanelas(iso(inicio), iso(hoje));

  log.info(
    `[conferir-orix] Varrendo ${DIAS} dias (${iso(inicio)} -> ${iso(hoje)}) ` +
      `em ${subJanelas.length} sub-janela(s), status=[${gatilho.join(',')}]...`,
  );

  const orix = new OrixClient({
    baseUrl: env.ORIX_BASE_URL,
    login: env.ORIX_LOGIN,
    senha: env.ORIX_SENHA,
  });

  // 1) O que o Órix tem, agrupado por pedido (a API devolve 1 linha por produto).
  const doOrix = new Map<string, PedidoOrix>();
  for (const janela of subJanelas) {
    const itens = await orix.getPedidos({
      dataInicial: janela.dataInicial,
      dataFinal: janela.dataFinal,
      status: gatilho,
      somenteVendas: false,
      empresas: [env.ORIX_EMPRESA],
    });
    for (const it of itens) {
      const id = String(it.id_pedido ?? '');
      if (!id) continue;
      let p = doOrix.get(id);
      if (!p) {
        p = {
          idPedido: id,
          numero: String(it.numero_pedido ?? ''),
          data: dataOrixParaISO(String(it.data ?? '')),
          status: String(it.status ?? ''),
          natureza: normalizarNatureza(it.natureza),
          produtos: [],
        };
        doOrix.set(id, p);
      }
      p.produtos.push(String(it.produto ?? ''));
    }
    log.info(
      `[conferir-orix]   ${janela.dataInicial}->${janela.dataFinal}: ${itens.length} linha(s).`,
    );
  }

  // 2) Separa o que o sistema exclui POR REGRA do que ele deveria ter.
  const excluidosNatureza: PedidoOrix[] = [];
  const excluidosOficina: PedidoOrix[] = [];
  const elegiveis: PedidoOrix[] = [];
  for (const p of doOrix.values()) {
    if (p.natureza !== '' && !naturezasOk.includes(p.natureza)) {
      excluidosNatureza.push(p);
    } else if (temProdutoServico(p.produtos, produtosServico)) {
      excluidosOficina.push(p);
    } else {
      elegiveis.push(p);
    }
  }

  // 3) O que o banco tem. Busca pelo id do Órix (é a chave de idempotência).
  const noBanco = new Map<string, { numero: string; status: string }>();
  const ids = elegiveis.map((p) => p.idPedido);
  const LOTE = 200; // o filtro `in` vai na URL; lotes evitam URL gigante.
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await supabase
      .from('pedidos')
      .select('orix_id_pedido, orix_numero, status_logistico')
      .in('orix_id_pedido', ids.slice(i, i + LOTE));
    if (error) throw new Error(`ler pedidos: ${error.message}`);
    for (const row of data ?? []) {
      noBanco.set(row.orix_id_pedido, {
        numero: row.orix_numero ?? '',
        status: row.status_logistico ?? '',
      });
    }
  }

  const ausentes = elegiveis.filter((p) => !noBanco.has(p.idPedido));
  const descartados = elegiveis.filter(
    (p) => noBanco.get(p.idPedido)?.status === 'cancelada',
  );
  const noQuadro = elegiveis.length - ausentes.length - descartados.length;

  // 4) Placar.
  console.log('');
  console.log('=== PLACAR ÓRIX x QUADRO ===');
  console.log(`  no Órix, nos status de gatilho .... ${doOrix.size}`);
  console.log(`  excluídos por natureza ........... ${excluidosNatureza.length}`);
  console.log(`  excluídos por oficina ............ ${excluidosOficina.length}`);
  console.log(`  ELEGÍVEIS ........................ ${elegiveis.length}`);
  console.log(`    destes, no quadro .............. ${noQuadro}`);
  console.log(`    destes, descartados ............ ${descartados.length}`);
  console.log(`    destes, AUSENTES do sistema .... ${ausentes.length}`);
  console.log('');

  if (ausentes.length === 0 && descartados.length === 0) {
    console.log('Nada faltando: o quadro está batendo com o Órix.');
    return;
  }

  const linha = (p: PedidoOrix, motivo: string) =>
    `  ${p.numero}  ${p.data ?? '??????????'}  ${p.status}  ${motivo}`;

  if (ausentes.length > 0) {
    console.log(`AUSENTES do sistema (${ausentes.length}) — nunca ingeridos:`);
    for (const p of [...ausentes].sort((a, b) => (a.data ?? '').localeCompare(b.data ?? ''))) {
      console.log(linha(p, ''));
    }
    console.log('');
  }

  if (descartados.length > 0) {
    console.log(
      `DESCARTADOS mas de volta ao gatilho (${descartados.length}) — ` +
        'devem ser readmitidos na próxima ingestão:',
    );
    for (const p of descartados) console.log(linha(p, ''));
    console.log('');
  }

  // Exit code 1 quando há divergência: serve para rodar em verificação/CI.
  process.exitCode = 1;
}

main().catch((err) => {
  log.error('[conferir-orix] Falhou:', err);
  process.exit(1);
});
