// [AGENTE WORKER] RECONCILIAÇÃO: confronta os pedidos ABERTOS do painel com o
// status atual da ordem de venda no Órix.
//
// O PROBLEMA QUE ISTO RESOLVE (reunião de 16/07/2026)
// ---------------------------------------------------
// O poll normal (worker/poll.ts) avança o cursor para HOJE e, no próximo tick,
// busca a janela a partir dali — e só nos status de GATILHO. Consequência: uma
// OV que muda para CANCELADA no Órix desaparece do resultado da busca e nunca
// mais é relida. O pedido ficava preso no painel do Johnny para sempre.
//
// A Natália: "Tá cancelado no Órix, mas ficar aparecendo aqui pro Johnny não
// faz sentido."
//
// COMO FUNCIONA
// -------------
//  1) lê os pedidos ABERTOS (pendente/agendada/em_rota/nao_realizado);
//  2) calcula a janela [menor data_pedido em aberto, hoje], limitada a
//     MAX_DIAS_RETROATIVOS para a varredura não crescer sem fim;
//  3) consulta o Órix nessa janela com os status de GATILHO + CANCELADO — é o
//     cancelado que interessa aqui, mas de graça também corrigimos quem só
//     mudou de gatilho (00041 -> 00027, o "vira parcial");
//  4) para cada pedido conhecido, aplica decidirReconciliacao (@pastobom/shared).
//
// GARANTIAS
// ---------
//  - NUNCA envia WhatsApp: isto é sincronização de sistema, não uma transição
//    feita por alguém. O cliente não pode receber mensagem por causa de um tick.
//  - NUNCA rebaixa um pedido 'entregue' (a regra pura cuida disso): cancelar a
//    nota depois da entrega é problema fiscal — o caminhão não desentrega.
//  - Pedido que NÃO aparece na resposta do Órix não é tocado. Pode estar num
//    status que não pedimos; sumir do painel por ausência de dado seria um erro.
//  - Falha do Órix aborta o ciclo sem derrubar o processo (mesmo circuit-breaker
//    do poll).

import {
  decidirReconciliacao,
  type StatusLogistico,
} from '@pastobom/shared';

import { OrixClient } from '../orix/client.js';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { log } from '../log.js';
import { getStatusCancelado, getStatusGatilho } from '../orix/status.js';
import { dividirEmSubJanelas } from './poll.js';

/** Status logísticos considerados "em aberto" (os que a varredura observa). */
const ABERTOS: StatusLogistico[] = [
  'pendente',
  'agendada',
  'em_rota',
  'nao_realizado',
];

/**
 * Teto da varredura retroativa. Sem isso, um único pedido esquecido de meses
 * atrás faria a rotina varrer o ano inteiro a cada ciclo.
 */
const MAX_DIAS_RETROATIVOS = 365;

/** Tamanho da página ao ler os pedidos (PostgREST corta em 1000 por padrão). */
const PAGINA = 1000;

interface PedidoAberto {
  id: string;
  orix_id_pedido: string;
  status_logistico: StatusLogistico;
  status_orix: string | null;
  status_orix_nome: string | null;
  data_pedido: string | null;
}

export interface ResultadoReconciliacao {
  ok: boolean;
  /** Pedidos em aberto examinados. */
  examinados: number;
  /** Pedidos encontrados na resposta do Órix. */
  encontrados: number;
  /** Pedidos que saíram da vista por cancelamento no Órix. */
  cancelados: number;
  /** Pedidos cujo status/nome do Órix foi atualizado. */
  atualizados: number;
  motivoAbort?: string;
}

/** yyyy-mm-dd de um Date, em UTC. */
function formatarISO(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function adicionarDias(d: Date, dias: number): Date {
  const novo = new Date(d.getTime());
  novo.setUTCDate(novo.getUTCDate() + dias);
  return novo;
}

/** Lê TODOS os pedidos em aberto, paginando (a lista pode passar de 1000). */
async function lerPedidosAbertos(): Promise<PedidoAberto[]> {
  const todos: PedidoAberto[] = [];
  for (let pagina = 0; ; pagina += 1) {
    const de = pagina * PAGINA;
    const { data, error } = await supabase
      .from('pedidos')
      .select(
        'id, orix_id_pedido, status_logistico, status_orix, status_orix_nome, data_pedido',
      )
      .in('status_logistico', ABERTOS)
      .order('id', { ascending: true })
      .range(de, de + PAGINA - 1);

    if (error) {
      throw new Error(`ler pedidos abertos: ${error.message}`);
    }
    const lote = (data ?? []) as PedidoAberto[];
    todos.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return todos;
}

/**
 * Executa UM ciclo de reconciliação. Não lança em caso de falha da Órix:
 * loga, aborta e devolve { ok:false }.
 */
export async function reconciliarOnce(): Promise<ResultadoReconciliacao> {
  const inicio = Date.now();
  const resultado: ResultadoReconciliacao = {
    ok: true,
    examinados: 0,
    encontrados: 0,
    cancelados: 0,
    atualizados: 0,
  };

  const abertos = await lerPedidosAbertos();
  resultado.examinados = abertos.length;
  if (abertos.length === 0) {
    log.info('[reconciliar] Nenhum pedido em aberto; nada a fazer.');
    return resultado;
  }

  // Janela: da OV aberta mais antiga até hoje, limitada ao teto retroativo.
  const hoje = new Date(`${formatarISO(new Date())}T00:00:00Z`);
  const limite = formatarISO(adicionarDias(hoje, -MAX_DIAS_RETROATIVOS));
  const datas = abertos
    .map((p) => p.data_pedido)
    .filter((d): d is string => typeof d === 'string' && d !== '');
  const maisAntiga = datas.length > 0 ? datas.reduce((a, b) => (a < b ? a : b)) : limite;
  const dataInicial = maisAntiga < limite ? limite : maisAntiga;
  const dataFinal = formatarISO(hoje);

  const [gatilho, cancelado] = await Promise.all([
    getStatusGatilho(),
    getStatusCancelado(),
  ]);
  // Gatilho + cancelado, e SÓ isso.
  //
  // O cancelado é o motivo desta rotina existir. O gatilho vem junto porque sai
  // de graça (é volume pequeno, o mesmo que o poll já puxa) e corrige o pedido
  // que apenas trocou de gatilho — 00041 -> 00027, o "vira parcial" que a
  // Natália descreveu.
  //
  // O CONCLUÍDO (00030) fica de fora de propósito: é TODA venda faturada do
  // período, dezenas de milhares de linhas a cada ciclo, contra um servidor que
  // já cai sozinho. E não mudaria decisão nenhuma — 'concluído' no Órix não
  // significa entregue, então o pedido continuaria exatamente onde está.
  const statusConsulta = [...new Set([...gatilho, ...cancelado])];

  const subJanelas = dividirEmSubJanelas(dataInicial, dataFinal);
  log.info(
    `[reconciliar] ${abertos.length} pedido(s) em aberto; janela ` +
      `${dataInicial} -> ${dataFinal} (${subJanelas.length} sub-janela(s)), ` +
      `status=[${statusConsulta.join(',')}].`,
  );

  const orix = new OrixClient({
    baseUrl: env.ORIX_BASE_URL,
    login: env.ORIX_LOGIN,
    senha: env.ORIX_SENHA,
  });

  // orix_id_pedido -> status atual no Órix.
  const doOrix = new Map<string, { status: string; nome: string }>();

  for (const janela of subJanelas) {
    try {
      const itens = await orix.getPedidos({
        dataInicial: janela.dataInicial,
        dataFinal: janela.dataFinal,
        status: statusConsulta,
        somenteVendas: false,
        empresas: [env.ORIX_EMPRESA],
      });
      for (const item of itens) {
        const id = String(item.id_pedido ?? '');
        if (!id) continue;
        // A API devolve 1 linha por produto; o status é do pedido (repetido).
        doOrix.set(id, {
          status: String(item.status ?? ''),
          nome: String(item.nome_status ?? ''),
        });
      }
    } catch (err) {
      // CIRCUIT-BREAKER: aborta o ciclo. Como a reconciliação não tem cursor,
      // o próximo ciclo simplesmente refaz a varredura — nada se perde.
      const motivo = err instanceof Error ? err.message : String(err);
      log.error(
        `[reconciliar] Órix falhou em ${janela.dataInicial}->${janela.dataFinal}; ` +
          `abortando o ciclo. Motivo: ${motivo}`,
      );
      return { ...resultado, ok: false, motivoAbort: motivo };
    }
  }

  const agora = new Date().toISOString();

  for (const pedido of abertos) {
    const noOrix = doOrix.get(pedido.orix_id_pedido);
    // Não veio na resposta: pode estar num status que não pedimos. Não tocar.
    if (!noOrix) continue;
    resultado.encontrados += 1;

    const acao = decidirReconciliacao(
      {
        statusLogistico: pedido.status_logistico,
        statusOrixAtual: pedido.status_orix ?? '',
        statusOrixNovo: noOrix.status,
        statusOrixNomeAtual: pedido.status_orix_nome ?? '',
        statusOrixNomeNovo: noOrix.nome,
      },
      cancelado,
    );

    if (acao === 'nada') continue;

    const patch: Record<string, unknown> = {
      status_orix: noOrix.status,
      status_orix_nome: noOrix.nome,
      atualizado_em: agora,
    };
    if (acao === 'cancelar') {
      patch.status_logistico = 'cancelada';
    }

    const { error } = await supabase
      .from('pedidos')
      .update(patch)
      .eq('id', pedido.id);

    if (error) {
      log.warn(
        `[reconciliar] Falha ao atualizar pedido ${pedido.id}: ${error.message}`,
      );
      continue;
    }

    if (acao === 'cancelar') {
      resultado.cancelados += 1;
      // Auditoria: quem olhar o histórico precisa ver que foi o SISTEMA que
      // cancelou, seguindo o Órix — e não alguém da equipe.
      const { error: errEvento } = await supabase.from('eventos_status').insert({
        pedido_id: pedido.id,
        de_status: pedido.status_logistico,
        para_status: 'cancelada',
        ator: 'sistema',
        ator_user_id: null,
      });
      if (errEvento) {
        log.warn(
          `[reconciliar] Falha ao registrar evento do pedido ${pedido.id}: ${errEvento.message}`,
        );
      }
    } else {
      resultado.atualizados += 1;
    }
  }

  log.info(
    `[reconciliar] Ciclo concluído em ${Date.now() - inicio}ms: ` +
      `${resultado.examinados} em aberto, ${resultado.encontrados} encontrado(s) ` +
      `no Órix, ${resultado.cancelados} cancelado(s), ` +
      `${resultado.atualizados} atualizado(s).`,
  );

  return resultado;
}
