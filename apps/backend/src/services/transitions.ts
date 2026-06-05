// [AGENTE API] Serviço de transições — coração da regra de negócio.
//
// aplicarTransicao() é a ÚNICA porta para mudar o status logístico de um
// pedido. Ela:
//   1) carrega o pedido (mapeado snake_case -> camelCase de @pastobom/shared);
//   2) valida a máquina de estados (podeTransicionar) — senão erro 409;
//   3) RF-1.8: se para==='agendada' e o cliente tem >1 propriedade, exige
//      propriedadeCodigo (senão erro 422); grava propriedade_codigo/data_agendada;
//   4) atualiza status_logistico + atualizado_em;
//   5) registra evento em eventos_status (de, para, ator);
//   6) EXACTLY-ONCE: se a transição dispara um template, cria UMA linha em
//      mensagens_whatsapp ('pendente'), envia via Evolution e atualiza para
//      'enviada'/'falha'. A ingestão do worker NUNCA envia WhatsApp; reenvio
//      manual é feito por endpoint dedicado (reenviarWhatsapp).

import {
  podeTransicionar,
  templateDaTransicao,
  type Pedido,
  type ItemPedido,
  type StatusLogistico,
  type TemplateWhatsapp,
} from '@pastobom/shared';

import { supabase } from '../db/supabase.js';
import { log } from '../log.js';
import { enviarTexto, normalizarNumeroBR } from '../whatsapp/evolution.js';
import { renderTemplate } from '../whatsapp/templates.js';

/**
 * Erro de domínio com código HTTP associado, para que as rotas mapeiem
 * diretamente (409 transição inválida, 422 propriedade exigida, 404, etc).
 */
export class TransicaoError extends Error {
  readonly statusCode: number;
  readonly codigo: string;

  constructor(statusCode: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.name = 'TransicaoError';
    this.statusCode = statusCode;
    this.codigo = codigo;
  }
}

// ---------------------------------------------------------------------------
// Linhas cruas do banco (snake_case)
// ---------------------------------------------------------------------------

interface PedidoRow {
  id: string;
  orix_id_pedido: string;
  orix_numero: string | null;
  empresa: number | null;
  cliente_codigo: string | null;
  cliente_nome: string | null;
  cidade_cliente: string | null;
  vendedor_codigo: string | null;
  vendedor_nome: string | null;
  propriedade_codigo: string | null;
  valor_total: number | string | null;
  data_pedido: string | null;
  status_orix: string | null;
  status_orix_nome: string | null;
  status_logistico: StatusLogistico;
  data_agendada: string | null;
  data_entregue: string | null;
  criado_em: string;
  atualizado_em: string;
}

interface ItemPedidoRow {
  id: string;
  produto_codigo: string | null;
  nome_produto: string | null;
  qtd: number | string | null;
  valor_unit: number | string | null;
  total: number | string | null;
}

/** Converte um valor numérico do Postgres (que pode vir como string) em number. */
function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapearItem(row: ItemPedidoRow): ItemPedido {
  return {
    id: row.id,
    produtoCodigo: row.produto_codigo ?? '',
    nomeProduto: row.nome_produto ?? '',
    qtd: num(row.qtd),
    valorUnit: num(row.valor_unit),
    total: num(row.total),
  };
}

/** Mapeia a linha do banco (snake_case) + itens para o tipo Pedido (camelCase). */
export function mapearPedido(row: PedidoRow, itens: ItemPedidoRow[]): Pedido {
  return {
    id: row.id,
    orixIdPedido: row.orix_id_pedido,
    orixNumero: row.orix_numero ?? '',
    empresa: num(row.empresa),
    clienteCodigo: row.cliente_codigo ?? '',
    clienteNome: row.cliente_nome ?? '',
    cidadeCliente: row.cidade_cliente ?? '',
    vendedorCodigo: row.vendedor_codigo ?? '',
    vendedorNome: row.vendedor_nome ?? '',
    propriedadeCodigo: row.propriedade_codigo,
    valorTotal: num(row.valor_total),
    dataPedido: row.data_pedido,
    statusOrix: row.status_orix ?? '',
    statusOrixNome: row.status_orix_nome ?? '',
    statusLogistico: row.status_logistico,
    dataAgendada: row.data_agendada,
    dataEntregue: row.data_entregue,
    itens: itens.map(mapearItem),
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

const COLUNAS_PEDIDO =
  'id, orix_id_pedido, orix_numero, empresa, cliente_codigo, cliente_nome, ' +
  'cidade_cliente, vendedor_codigo, vendedor_nome, propriedade_codigo, ' +
  'valor_total, data_pedido, status_orix, status_orix_nome, status_logistico, ' +
  'data_agendada, data_entregue, criado_em, atualizado_em';

const COLUNAS_ITEM =
  'id, produto_codigo, nome_produto, qtd, valor_unit, total';

/** Carrega um pedido + itens já mapeados; lança 404 se não existir. */
export async function carregarPedido(pedidoId: string): Promise<Pedido> {
  const { data: pedidoRow, error: errPedido } = await supabase
    .from('pedidos')
    .select(COLUNAS_PEDIDO)
    .eq('id', pedidoId)
    .maybeSingle<PedidoRow>();

  if (errPedido) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao carregar pedido: ${errPedido.message}`,
    );
  }
  if (!pedidoRow) {
    throw new TransicaoError(404, 'nao_encontrado', 'Pedido não encontrado.');
  }

  const { data: itensRows, error: errItens } = await supabase
    .from('itens_pedido')
    .select(COLUNAS_ITEM)
    .eq('pedido_id', pedidoId);

  if (errItens) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao carregar itens do pedido: ${errItens.message}`,
    );
  }

  return mapearPedido(pedidoRow, (itensRows ?? []) as ItemPedidoRow[]);
}

/** Conta quantas propriedades o cliente possui. */
async function contarPropriedades(clienteCodigo: string): Promise<number> {
  const { count, error } = await supabase
    .from('propriedades')
    .select('codigo', { count: 'exact', head: true })
    .eq('cliente_codigo', clienteCodigo);

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao contar propriedades do cliente: ${error.message}`,
    );
  }
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Templates (lidos de sync_state) e número de WhatsApp do cliente
// ---------------------------------------------------------------------------

/** Lê o mapa de templates de sync_state.chave='templates'. */
async function lerTemplates(): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('sync_state')
    .select('valor')
    .eq('chave', 'templates')
    .maybeSingle<{ valor: Record<string, string> }>();

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao ler templates de sync_state: ${error.message}`,
    );
  }
  return data?.valor ?? {};
}

interface ClienteContato {
  celular: string | null;
  telefone: string | null;
}

/** Busca os campos de contato do cliente para o envio de WhatsApp. */
async function lerContatoCliente(
  clienteCodigo: string,
): Promise<ClienteContato | null> {
  const { data, error } = await supabase
    .from('clientes')
    .select('celular, telefone')
    .eq('codigo', clienteCodigo)
    .maybeSingle<ClienteContato>();

  if (error) {
    log.warn(
      `[transitions] Falha ao ler contato do cliente ${clienteCodigo}: ${error.message}`,
    );
    return null;
  }
  return data;
}

/** Formata uma data ISO (yyyy-mm-dd) para dd/mm/yyyy; devolve original se não casar. */
function formatarDataBR(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Monta as variáveis usadas na renderização dos templates de transição. */
function variaveisTemplate(pedido: Pedido): Record<string, string> {
  return {
    nome_cliente: pedido.clienteNome,
    numero: pedido.orixNumero || pedido.orixIdPedido,
    data_agendada: formatarDataBR(pedido.dataAgendada),
    propriedade: pedido.propriedadeCodigo ?? '',
  };
}

/**
 * Cria a linha em mensagens_whatsapp ('pendente'), envia via Evolution e
 * atualiza para 'enviada'/'falha'. EXACTLY-ONCE: chamada UMA vez por transição.
 * Falha de envio NÃO reverte a transição (já persistida); apenas registra erro.
 */
async function dispararWhatsapp(
  pedido: Pedido,
  template: Exclude<TemplateWhatsapp, null>,
): Promise<void> {
  const templates = await lerTemplates();
  const tpl = templates[template];
  if (!tpl) {
    log.warn(
      `[transitions] Template '${template}' ausente em sync_state; pulando envio.`,
    );
    return;
  }

  const corpo = renderTemplate(tpl, variaveisTemplate(pedido));

  const contato = await lerContatoCliente(pedido.clienteCodigo);
  const numeroBruto = contato?.celular || contato?.telefone || '';
  const numero = numeroBruto ? normalizarNumeroBR(numeroBruto) : null;

  // Cria a linha SEMPRE (auditoria), mesmo quando o número é inválido.
  const { data: msgRow, error: errInsert } = await supabase
    .from('mensagens_whatsapp')
    .insert({
      pedido_id: pedido.id,
      cliente_codigo: pedido.clienteCodigo,
      numero: numero ?? numeroBruto,
      template,
      corpo,
      status_envio: 'pendente',
    })
    .select('id')
    .single<{ id: string }>();

  if (errInsert || !msgRow) {
    log.error(
      `[transitions] Falha ao criar mensagem_whatsapp do pedido ${pedido.id}:`,
      errInsert?.message,
    );
    return;
  }

  if (!numero) {
    await supabase
      .from('mensagens_whatsapp')
      .update({
        status_envio: 'falha',
        erro: 'Número de WhatsApp inválido ou ausente no cadastro do cliente.',
      })
      .eq('id', msgRow.id);
    log.warn(
      `[transitions] Pedido ${pedido.id}: cliente sem número válido; mensagem marcada como falha.`,
    );
    return;
  }

  const resultado = await enviarTexto({ numero, texto: corpo });

  await supabase
    .from('mensagens_whatsapp')
    .update({
      status_envio: resultado.ok ? 'enviada' : 'falha',
      provider_response: resultado.resposta as never,
      enviado_em: resultado.ok ? new Date().toISOString() : null,
      erro: resultado.ok ? null : `Envio retornou status ${resultado.status}.`,
    })
    .eq('id', msgRow.id);

  if (!resultado.ok) {
    log.warn(
      `[transitions] Pedido ${pedido.id}: envio de WhatsApp falhou (status ${resultado.status}).`,
    );
  }
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export interface AplicarTransicaoArgs {
  pedidoId: string;
  para: StatusLogistico;
  propriedadeCodigo?: string;
  dataAgendada?: string;
  atorUserId?: string;
}

/**
 * Aplica uma transição de status a um pedido, validando a máquina de estados,
 * a regra RF-1.8 e disparando (exactly-once) o WhatsApp da transição.
 */
export async function aplicarTransicao(
  args: AplicarTransicaoArgs,
): Promise<Pedido> {
  const { pedidoId, para, propriedadeCodigo, dataAgendada, atorUserId } = args;

  // 1) Carrega o pedido atual.
  const pedidoAtual = await carregarPedido(pedidoId);
  const de = pedidoAtual.statusLogistico;

  // 2) Valida a máquina de estados.
  if (!podeTransicionar(de, para)) {
    throw new TransicaoError(
      409,
      'transicao_invalida',
      `Transição inválida: ${de} -> ${para}.`,
    );
  }

  // 3) RF-1.8 + gravação de propriedade/data agendada.
  let propriedadeParaGravar = pedidoAtual.propriedadeCodigo;

  if (para === 'agendada') {
    const totalProps = await contarPropriedades(pedidoAtual.clienteCodigo);
    if (totalProps > 1 && !propriedadeCodigo) {
      throw new TransicaoError(
        422,
        'propriedade_exigida',
        'Cliente possui mais de uma propriedade; informe propriedadeCodigo.',
      );
    }
    if (propriedadeCodigo) {
      propriedadeParaGravar = propriedadeCodigo;
    }
  } else if (propriedadeCodigo) {
    // Permite ajustar a propriedade em outras transições, se enviada.
    propriedadeParaGravar = propriedadeCodigo;
  }

  // 4) Atualiza o pedido.
  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status_logistico: para,
    atualizado_em: agora,
    propriedade_codigo: propriedadeParaGravar,
  };
  if (para === 'agendada' && dataAgendada) {
    patch.data_agendada = dataAgendada;
  }
  if (para === 'entregue') {
    patch.data_entregue = agora;
  }

  const { error: errUpdate } = await supabase
    .from('pedidos')
    .update(patch)
    .eq('id', pedidoId);

  if (errUpdate) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao atualizar status do pedido: ${errUpdate.message}`,
    );
  }

  // 5) Registra o evento de status.
  const { error: errEvento } = await supabase.from('eventos_status').insert({
    pedido_id: pedidoId,
    de_status: de,
    para_status: para,
    ator: atorUserId ? 'usuario' : 'sistema',
    ator_user_id: atorUserId ?? null,
  });

  if (errEvento) {
    // Não reverte a transição; apenas loga (auditoria perdida não invalida estado).
    log.error(
      `[transitions] Falha ao registrar evento_status do pedido ${pedidoId}:`,
      errEvento.message,
    );
  }

  // 6) Recarrega o pedido já atualizado (fonte de verdade para o WhatsApp).
  const pedidoAtualizado = await carregarPedido(pedidoId);

  // EXACTLY-ONCE: dispara o WhatsApp da transição, se houver template.
  const template = templateDaTransicao(de, para);
  if (template) {
    try {
      await dispararWhatsapp(pedidoAtualizado, template);
    } catch (err) {
      // Falha no efeito colateral não invalida a transição já persistida.
      log.error(
        `[transitions] Erro ao disparar WhatsApp do pedido ${pedidoId}:`,
        err,
      );
    }
  }

  return pedidoAtualizado;
}

/**
 * Reenvio MANUAL e explícito de uma mensagem de WhatsApp para um pedido.
 * Diferente de aplicarTransicao, não muda status nem registra evento.
 * Cria uma nova linha em mensagens_whatsapp e tenta o envio.
 */
export async function reenviarWhatsapp(args: {
  pedidoId: string;
  template: string;
}): Promise<{ ok: boolean; status: number }> {
  const { pedidoId, template } = args;

  const pedido = await carregarPedido(pedidoId);

  const templates = await lerTemplates();
  const tpl = templates[template];
  if (!tpl) {
    throw new TransicaoError(
      422,
      'template_invalido',
      `Template '${template}' não existe em sync_state.`,
    );
  }

  const corpo = renderTemplate(tpl, variaveisTemplate(pedido));

  const contato = await lerContatoCliente(pedido.clienteCodigo);
  const numeroBruto = contato?.celular || contato?.telefone || '';
  const numero = numeroBruto ? normalizarNumeroBR(numeroBruto) : null;

  const { data: msgRow, error: errInsert } = await supabase
    .from('mensagens_whatsapp')
    .insert({
      pedido_id: pedido.id,
      cliente_codigo: pedido.clienteCodigo,
      numero: numero ?? numeroBruto,
      template,
      corpo,
      status_envio: 'pendente',
    })
    .select('id')
    .single<{ id: string }>();

  if (errInsert || !msgRow) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao registrar reenvio: ${errInsert?.message ?? 'desconhecido'}`,
    );
  }

  if (!numero) {
    await supabase
      .from('mensagens_whatsapp')
      .update({
        status_envio: 'falha',
        erro: 'Número de WhatsApp inválido ou ausente no cadastro do cliente.',
      })
      .eq('id', msgRow.id);
    throw new TransicaoError(
      422,
      'numero_invalido',
      'Cliente sem número de WhatsApp válido.',
    );
  }

  const resultado = await enviarTexto({ numero, texto: corpo });

  await supabase
    .from('mensagens_whatsapp')
    .update({
      status_envio: resultado.ok ? 'enviada' : 'falha',
      provider_response: resultado.resposta as never,
      enviado_em: resultado.ok ? new Date().toISOString() : null,
      erro: resultado.ok ? null : `Envio retornou status ${resultado.status}.`,
    })
    .eq('id', msgRow.id);

  return { ok: resultado.ok, status: resultado.status };
}
