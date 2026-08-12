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
//  - Falha do Órix aborta o ciclo sem derrubar o processo (mesmo circuit-breaker
//    do poll).
//
// AUSÊNCIA (05/08/2026) — "o que foi concluído não é para ficar aparecendo"
// ------------------------------------------------------------------------
// Até aqui, pedido que NÃO voltava na resposta era ignorado. Só que o pedido
// FATURADO no Órix (00030) sai do gatilho e é exatamente isso que acontece com
// ele: some da resposta e fica preso na coluna Pendente para sempre. Eram 52
// pedidos parados há mais de um mês quando a Natália reclamou.
//
// Agora a ausência decide — sem consultar o 00030, que seria toda venda
// faturada do período contra um servidor que já cai sozinho. Se a data do
// pedido cai dentro da janela consultada e ele não voltou, ele não está nem em
// gatilho nem cancelado.
//
// Como é um sinal INDIRETO, tem três freios:
//   1) carência de 24 h — a primeira ausência só carimba a data;
//   2) pedido com viagem em andamento nunca é tocado (regra pura);
//   3) se mais da METADE dos abertos sumir de uma vez, o ciclo não marca
//      ninguém: resposta anormalmente vazia é falha do Órix, não backlog.

import {
  decidirReconciliacao,
  decidirAusencia,
  type OrixPedidoItem,
  type StatusLogistico,
} from '@pastobom/shared';

import { OrixClient } from '../orix/client.js';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { log } from '../log.js';
import {
  getStatusCancelado,
  getStatusGatilho,
  getStatusParcial,
} from '../orix/status.js';
import { ingest } from './ingest.js';
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

/**
 * Quanto tempo um pedido precisa ficar ausente da resposta do Órix antes de ser
 * descartado. 24 h = 48 ciclos de 30 min: o Órix cai à noite inteira e ainda
 * sobra folga. O script one-shot passa 0 (decisão humana, com --dry conferido).
 */
export const HORAS_CARENCIA_AUSENCIA = 24;

/**
 * Acima desta fração de ausentes, o ciclo não marca ninguém. Em regime, a
 * ausência diária é de poucos pedidos; metade do quadro sumindo de uma vez é
 * quase sempre resposta incompleta do Órix, não backlog resolvido.
 *
 * O passivo acumulado é a exceção: na primeira limpeza (05/08/2026) eram 92 de
 * 183, e a sondagem confirmou 00030 em todos os checados. Para esse caso o
 * script one-shot passa `fracaoAusentesMax: 1` — deliberadamente, depois de
 * conferir, e não baixando este limite.
 */
const FRACAO_AUSENTES_SUSPEITA = 0.5;

// Uma string literal só: o supabase-js infere o tipo do retorno a partir dela,
// e concatenar quebra essa inferência.
// prettier-ignore
const COLUNAS_PEDIDO_ABERTO = 'id, orix_id_pedido, orix_numero, status_logistico, status_orix, status_orix_nome, data_pedido, ausente_orix_desde';

export interface PedidoAberto {
  id: string;
  orix_id_pedido: string;
  /** Número da OV como a equipe vê na tela do Órix. */
  orix_numero: string | null;
  status_logistico: StatusLogistico;
  status_orix: string | null;
  status_orix_nome: string | null;
  data_pedido: string | null;
  ausente_orix_desde: string | null;
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
  /** Pedidos carimbados como ausentes (aguardando a carência). */
  marcados: number;
  /** Pedidos descartados por ausência prolongada (faturados no Órix). */
  descartados: number;
  /** Pedidos parciais cujos itens foram reingeridos (quantidades a faturar). */
  itensAtualizados: number;
  /** O freio de volume disparou: nenhuma ausência foi processada. */
  ausenciaSuspeita?: boolean;
  motivoAbort?: string;
}

export interface OpcoesReconciliacao {
  /** Carência da ausência. Default: HORAS_CARENCIA_AUSENCIA. */
  horasCarencia?: number;
  /** Só relata, não escreve nada no banco. Usado pelo --dry do script. */
  dryRun?: boolean;
  /** Recebe cada pedido que seria/foi descartado por ausência (relatório). */
  aoDescartar?: (pedido: PedidoAberto) => void;
  /**
   * Teto do freio de volume. Default: FRACAO_AUSENTES_SUSPEITA. Passar 1
   * desliga o freio — só para a limpeza do passivo, com conferência humana
   * antes (ver o --forcar do script limpar-fora-orix).
   */
  fracaoAusentesMax?: number;
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
      .select(COLUNAS_PEDIDO_ABERTO)
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
 * Ids dos pedidos que têm viagem EM ANDAMENTO (agendada ou em rota).
 *
 * Serve à guarda da ausência: não se arranca do quadro uma carga que já está no
 * caminhão, mesmo que o Órix já tenha faturado a nota. Quem encerra é a equipe,
 * dando baixa.
 */
async function lerPedidosComEntregaAtiva(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let pagina = 0; ; pagina += 1) {
    const de = pagina * PAGINA;
    const { data, error } = await supabase
      .from('entregas')
      .select('pedido_id')
      .in('status', ['agendada', 'em_rota'])
      .range(de, de + PAGINA - 1);

    if (error) {
      throw new Error(`ler entregas ativas: ${error.message}`);
    }
    const lote = (data ?? []) as { pedido_id: string }[];
    for (const linha of lote) ids.add(linha.pedido_id);
    if (lote.length < PAGINA) break;
  }
  return ids;
}

/**
 * Executa UM ciclo de reconciliação. Não lança em caso de falha da Órix:
 * loga, aborta e devolve { ok:false }.
 */
export async function reconciliarOnce(
  opcoes: OpcoesReconciliacao = {},
): Promise<ResultadoReconciliacao> {
  const horasCarencia = opcoes.horasCarencia ?? HORAS_CARENCIA_AUSENCIA;
  const dryRun = opcoes.dryRun ?? false;
  const inicio = Date.now();
  const resultado: ResultadoReconciliacao = {
    ok: true,
    examinados: 0,
    encontrados: 0,
    cancelados: 0,
    atualizados: 0,
    marcados: 0,
    descartados: 0,
    itensAtualizados: 0,
  };

  const [abertos, comEntregaAtiva] = await Promise.all([
    lerPedidosAbertos(),
    lerPedidosComEntregaAtiva(),
  ]);
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

  const [gatilho, cancelado, parcial] = await Promise.all([
    getStatusGatilho(),
    getStatusCancelado(),
    getStatusParcial(),
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

  // Linhas cruas dos pedidos PARCIAIS que já temos no banco.
  //
  // Estas linhas já foram baixadas para descobrir o status — reaproveitá-las
  // para refrescar as quantidades não custa nenhuma chamada nova ao Órix. E é o
  // que a Natália pediu (áudio de 12/08/2026): num pedido parcial, mostrar só o
  // que ainda falta faturar. A API já devolve exatamente isso; o que faltava era
  // reingerir, porque a reconciliação atualizava o status e descartava os itens.
  //
  // Só os parciais e só os que já existem: é neles que a quantidade muda, e
  // descobrir pedido novo continua sendo da varredura profunda, que enriquece o
  // cadastro de cliente direito.
  const idsConhecidos = new Set(abertos.map((p) => p.orix_id_pedido));
  const linhasParciais: OrixPedidoItem[] = [];

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
        const status = String(item.status ?? '');
        doOrix.set(id, {
          status,
          nome: String(item.nome_status ?? ''),
        });
        if (parcial.includes(status) && idsConhecidos.has(id)) {
          linhasParciais.push(item);
        }
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

  // FREIO DE VOLUME. Antes de tratar qualquer ausência, olha o tamanho dela.
  // Uma resposta anormalmente vazia do Órix (que já aconteceu: o servidor cai,
  // devolve 200 com pouca coisa) não pode virar limpeza em massa do quadro.
  const ausentes = abertos.filter((p) => !doOrix.has(p.orix_id_pedido));
  const fracaoAusente = abertos.length > 0 ? ausentes.length / abertos.length : 0;
  const tetoAusentes = opcoes.fracaoAusentesMax ?? FRACAO_AUSENTES_SUSPEITA;
  const ausenciaSuspeita = fracaoAusente > tetoAusentes;
  if (ausenciaSuspeita) {
    resultado.ausenciaSuspeita = true;
    log.warn(
      `[reconciliar] ${ausentes.length}/${abertos.length} pedidos ausentes ` +
        `(${Math.round(fracaoAusente * 100)}%) — acima do limite de ` +
        `${Math.round(tetoAusentes * 100)}%. Isso tem cara de ` +
        `resposta incompleta do Órix, não de backlog resolvido: nenhuma ` +
        `ausência será processada neste ciclo.`,
    );
  }

  for (const pedido of abertos) {
    const noOrix = doOrix.get(pedido.orix_id_pedido);

    // ---- Não veio na resposta do Órix ------------------------------------
    if (!noOrix) {
      if (ausenciaSuspeita) continue;

      const acaoAusencia = decidirAusencia(
        {
          statusLogistico: pedido.status_logistico,
          dataPedido: pedido.data_pedido,
          janelaInicial: dataInicial,
          janelaFinal: dataFinal,
          temEntregaAtiva: comEntregaAtiva.has(pedido.id),
          ausenteDesde: pedido.ausente_orix_desde,
          agora,
        },
        horasCarencia,
      );

      if (acaoAusencia === 'nada') continue;

      if (acaoAusencia === 'marcar_ausente') {
        resultado.marcados += 1;
        if (dryRun) continue;
        const { error } = await supabase
          .from('pedidos')
          .update({ ausente_orix_desde: agora })
          .eq('id', pedido.id);
        if (error) {
          log.warn(
            `[reconciliar] Falha ao carimbar ausência do pedido ${pedido.id}: ${error.message}`,
          );
        }
        continue;
      }

      // descartar: o pedido saiu do gatilho e não voltou. Vai para Descartados,
      // de onde a logística consegue trazer de volta pelo botão "Restaurar".
      resultado.descartados += 1;
      opcoes.aoDescartar?.(pedido);
      if (dryRun) continue;

      const { error } = await supabase
        .from('pedidos')
        .update({ status_logistico: 'cancelada', atualizado_em: agora })
        .eq('id', pedido.id);
      if (error) {
        log.warn(
          `[reconciliar] Falha ao descartar pedido ausente ${pedido.id}: ${error.message}`,
        );
        resultado.descartados -= 1;
        continue;
      }

      const { error: errEvento } = await supabase.from('eventos_status').insert({
        pedido_id: pedido.id,
        de_status: pedido.status_logistico,
        para_status: 'cancelada',
        ator: 'sistema',
        ator_user_id: null,
      });
      if (errEvento) {
        log.warn(
          `[reconciliar] Falha ao registrar evento de ausência do pedido ` +
            `${pedido.id}: ${errEvento.message}`,
        );
      }
      continue;
    }

    // ---- Veio na resposta -------------------------------------------------
    resultado.encontrados += 1;

    // Reapareceu depois de ter sido carimbado: limpa o carimbo. Sem isso, uma
    // ausência antiga somada a uma nova falharia a carência cedo demais.
    if (pedido.ausente_orix_desde && !dryRun) {
      const { error } = await supabase
        .from('pedidos')
        .update({ ausente_orix_desde: null })
        .eq('id', pedido.id);
      if (error) {
        log.warn(
          `[reconciliar] Falha ao limpar carimbo do pedido ${pedido.id}: ${error.message}`,
        );
      }
    }

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

    if (dryRun) {
      if (acao === 'cancelar') resultado.cancelados += 1;
      else resultado.atualizados += 1;
      continue;
    }

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

  // Refresca as quantidades dos parciais com as linhas que já vieram acima.
  // Sem enriquecer cliente: seriam centenas de chamadas extras ao Órix a cada
  // ciclo, e estes pedidos já têm cadastro (só entram aqui se já existem).
  if (linhasParciais.length > 0 && !dryRun) {
    try {
      const r = await ingest(linhasParciais, orix, {
        enriquecerClientes: false,
      });
      resultado.itensAtualizados = r.atualizados;
      log.info(
        `[reconciliar] Quantidades reconferidas em ${r.atualizados} pedido(s) ` +
          `parcial(is) (${r.itensGravados} item(ns)), sem chamada nova ao Órix.`,
      );
    } catch (err) {
      // Não derruba o ciclo: o status já foi reconciliado, que é o principal.
      log.warn(
        '[reconciliar] Falha ao reconferir quantidades dos parciais:',
        err,
      );
    }
  }

  log.info(
    `[reconciliar] Ciclo concluído em ${Date.now() - inicio}ms${dryRun ? ' [DRY]' : ''}: ` +
      `${resultado.examinados} em aberto, ${resultado.encontrados} encontrado(s) ` +
      `no Órix, ${resultado.cancelados} cancelado(s), ` +
      `${resultado.atualizados} atualizado(s), ` +
      `${resultado.marcados} marcado(s) ausente(s), ` +
      `${resultado.descartados} descartado(s) por ausência, ` +
      `${resultado.itensAtualizados} parcial(is) com quantidade reconferida.`,
  );

  return resultado;
}
