// [AGENTE API] Serviço de transições — coração da regra de negócio.
//
// aplicarTransicao() é a ÚNICA porta para mudar o status logístico de um
// pedido. Ela:
//   1) carrega o pedido (mapeado snake_case -> camelCase de @pastobom/shared);
//   2) valida a máquina de estados (podeTransicionar) — senão erro 409;
//   3) se para==='agendada': exige data, período, motorista, caminhão e o peso de
//      TODOS os itens (422); RF-1.8: exige propriedadeCodigo quando o cliente tem
//      >1 propriedade; aplica as travas de carga (services/carga.ts) e grava
//      data_agendada/periodo/motorista_id/caminhao_id/propriedade_codigo;
//   4) atualiza status_logistico + atualizado_em;
//   5) registra evento em eventos_status (de, para, ator);
//   6) EXACTLY-ONCE: se a transição dispara um template, cria UMA linha em
//      mensagens_whatsapp ('pendente'), envia via Evolution e atualiza para
//      'enviada'/'falha'. A ingestão do worker NUNCA envia WhatsApp; reenvio
//      manual é feito por endpoint dedicado (reenviarWhatsapp).

import {
  podeTransicionar,
  podeReverter,
  templateDaTransicao,
  escolherNumeroWhatsApp,
  normalizarWhatsApp,
  type Pedido,
  type ItemPedido,
  type PeriodoEntrega,
  type StatusLogistico,
  type TemplateWhatsapp,
  type TemplateEntrega,
} from '@pastobom/shared';

import { env } from '../config/env.js';
import { supabase } from '../db/supabase.js';
import { log } from '../log.js';
import {
  itensSemPeso,
  lerPesosProdutos,
  pesoTotalDoPedido,
  validarCargaDoAgendamento,
} from './carga.js';
import { enviarTexto } from '../whatsapp/evolution.js';
import { renderTemplate } from '../whatsapp/templates.js';

/**
 * Erro de domínio com código HTTP associado, para que as rotas mapeiem
 * diretamente (409 transição inválida, 422 propriedade exigida, 404, etc).
 * Definido em erros.ts; reexportado aqui para não quebrar quem já importava daqui.
 */
export { TransicaoError } from './erros.js';
import { TransicaoError } from './erros.js';

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
  periodo: PeriodoEntrega | null;
  data_entregue: string | null;
  motorista_id: string | null;
  caminhao_id: string | null;
  observacoes: string | null;
  motivo_nao_entrega: string | null;
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
  separado?: boolean | null;
}

/**
 * Dados que NÃO estão na linha de pedidos e precisam ser resolvidos à parte
 * (profiles, caminhoes, clientes.bairro e produtos_peso). Vêm de fora para que
 * a listagem os resolva em LOTE, sem N+1.
 */
export interface ExtrasPedido {
  motoristaNome?: string | null;
  caminhaoNome?: string | null;
  bairro?: string | null;
  /** produto_codigo -> peso UNITÁRIO em kg. Ausente = peso desconhecido. */
  pesosPorProduto?: Map<string, number>;
}

/** Converte um valor numérico do Postgres (que pode vir como string) em number. */
function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapearItem(
  row: ItemPedidoRow,
  pesosPorProduto?: Map<string, number>,
): ItemPedido {
  const produtoCodigo = row.produto_codigo ?? '';
  return {
    id: row.id,
    produtoCodigo,
    nomeProduto: row.nome_produto ?? '',
    qtd: num(row.qtd),
    valorUnit: num(row.valor_unit),
    total: num(row.total),
    separado: row.separado === true,
    pesoUnitKg: pesosPorProduto?.get(produtoCodigo) ?? null,
  };
}

/**
 * Mapeia a linha do banco (snake_case) + itens para o tipo Pedido (camelCase).
 * Os `extras` (nome do motorista/caminhão, bairro do cliente e os pesos dos
 * produtos) são resolvidos à parte — não há FK pedidos->profiles nem coluna de
 * peso no pedido.
 */
export function mapearPedido(
  row: PedidoRow,
  itens: ItemPedidoRow[],
  extras: ExtrasPedido = {},
): Pedido {
  const itensMapeados = itens.map((i) => mapearItem(i, extras.pesosPorProduto));
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
    periodo: row.periodo,
    dataEntregue: row.data_entregue,
    motoristaId: row.motorista_id,
    motoristaNome: extras.motoristaNome ?? null,
    caminhaoId: row.caminhao_id,
    caminhaoNome: extras.caminhaoNome ?? null,
    bairro: extras.bairro ?? null,
    pesoTotalKg: pesoTotalDoPedido(itensMapeados),
    observacoes: row.observacoes ?? null,
    motivoNaoEntrega: row.motivo_nao_entrega ?? null,
    itens: itensMapeados,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

const COLUNAS_PEDIDO =
  'id, orix_id_pedido, orix_numero, empresa, cliente_codigo, cliente_nome, ' +
  'cidade_cliente, vendedor_codigo, vendedor_nome, propriedade_codigo, ' +
  'valor_total, data_pedido, status_orix, status_orix_nome, status_logistico, ' +
  'data_agendada, periodo, data_entregue, motorista_id, caminhao_id, observacoes, ' +
  'motivo_nao_entrega, criado_em, atualizado_em';

/** Resolve o nome do motorista (profiles) pelo auth.uid; '' quando sem nome. */
async function lerNomeMotorista(
  motoristaId: string | null,
): Promise<string | null> {
  if (!motoristaId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('nome')
    .eq('id', motoristaId)
    .maybeSingle<{ nome: string | null }>();
  if (error) {
    log.warn(
      `[transitions] Falha ao ler nome do motorista ${motoristaId}: ${error.message}`,
    );
    return '';
  }
  return data?.nome ?? '';
}

/** Resolve o nome do caminhão do pedido; null quando não há caminhão. */
async function lerNomeCaminhao(caminhaoId: string | null): Promise<string | null> {
  if (!caminhaoId) return null;
  const { data, error } = await supabase
    .from('caminhoes')
    .select('nome')
    .eq('id', caminhaoId)
    .maybeSingle<{ nome: string | null }>();
  if (error) {
    log.warn(
      `[transitions] Falha ao ler nome do caminhão ${caminhaoId}: ${error.message}`,
    );
    return null;
  }
  return data?.nome ?? null;
}

/** Bairro do cliente (entregas rurais se orientam por bairro + cidade). */
async function lerBairroCliente(clienteCodigo: string): Promise<string | null> {
  if (!clienteCodigo) return null;
  const { data, error } = await supabase
    .from('clientes')
    .select('bairro')
    .eq('codigo', clienteCodigo)
    .maybeSingle<{ bairro: string | null }>();
  if (error) {
    log.warn(
      `[transitions] Falha ao ler bairro do cliente ${clienteCodigo}: ${error.message}`,
    );
    return null;
  }
  return data?.bairro ?? null;
}

const COLUNAS_ITEM =
  'id, produto_codigo, nome_produto, qtd, valor_unit, total, separado';

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

  const itens = (itensRows ?? []) as ItemPedidoRow[];

  const [motoristaNome, caminhaoNome, bairro, pesosPorProduto] =
    await Promise.all([
      lerNomeMotorista(pedidoRow.motorista_id),
      lerNomeCaminhao(pedidoRow.caminhao_id),
      lerBairroCliente(pedidoRow.cliente_codigo ?? ''),
      lerPesosProdutos(itens.map((i) => i.produto_codigo ?? '')),
    ]);

  return mapearPedido(pedidoRow, itens, {
    motoristaNome,
    caminhaoNome,
    bairro,
    pesosPorProduto,
  });
}

/**
 * Recusa (422) um motivo de não entrega que não esteja na lista cadastrada.
 *
 * A comparação é case-insensitive porque é assim que o índice único da tabela
 * trata a descrição — "Cliente ausente" e "cliente ausente" são o mesmo motivo.
 *
 * Se a leitura da tabela falhar, DEIXA PASSAR: a lista é uma regra de
 * padronização, e derrubar o registro de uma entrega que não aconteceu por
 * causa de um erro de banco seria pior do que aceitar um motivo fora do padrão
 * (o motorista está no campo, e a entrega já falhou uma vez).
 */
export async function exigirMotivoCadastrado(motivo: string): Promise<void> {
  const { data, error } = await supabase
    .from('motivos_nao_entrega')
    .select('descricao')
    .eq('ativo', true);

  if (error) {
    log.warn(
      `[transitions] Não foi possível validar o motivo "${motivo}" ` +
        `(${error.message}); aceitando assim mesmo.`,
    );
    return;
  }

  const alvo = motivo.toLocaleLowerCase('pt-BR');
  const existe = (data ?? []).some(
    (m: { descricao: string | null }) =>
      (m.descricao ?? '').trim().toLocaleLowerCase('pt-BR') === alvo,
  );

  if (!existe) {
    throw new TransicaoError(
      422,
      'motivo_invalido',
      'Escolha um motivo da lista cadastrada. ' +
        'Para criar um motivo novo, use a tela de Motivos (logística).',
    );
  }
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
  /** Número canônico de WhatsApp gravado na ingestão (E.164 dígitos) ou null. */
  numeroWhatsapp: string | null;
  /** CPF (11 díg.) ou CNPJ (14 díg.) — distingue pessoa física × empresa. */
  cpfCnpj: string | null;
}

/** Busca os campos de contato do cliente para o envio de WhatsApp. */
async function lerContatoCliente(
  clienteCodigo: string,
): Promise<ClienteContato | null> {
  const { data, error } = await supabase
    .from('clientes')
    .select('celular, telefone, numeroWhatsapp:numero_whatsapp, cpfCnpj:cpf_cnpj')
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

/**
 * Resolve o número de WhatsApp a usar no envio: prefere o canônico já gravado
 * na ingestão (clientes.numero_whatsapp) e cai para uma normalização defensiva
 * em tempo de envio quando a coluna ainda não foi preenchida (cliente ingerido
 * antes da migração 0007). Devolve o E.164 (dígitos) pronto p/ Evolution — ou
 * null se não houver móvel — e o número bruto para a linha de auditoria.
 */
function resolverNumeroWhatsapp(contato: ClienteContato | null): {
  numero: string | null;
  numeroBruto: string;
} {
  const numeroBruto = contato?.celular || contato?.telefone || '';

  // MODO TESTE: redireciona TODOS os envios para um número fixo, ignorando o
  // contato do cliente — inclusive quando o cliente não tem número válido (não
  // cai na branch de "falha"). O cliente real (cliente_codigo) segue registrado.
  if (env.WHATSAPP_NUMERO_TESTE) {
    const teste =
      normalizarWhatsApp(env.WHATSAPP_NUMERO_TESTE).e164 ??
      env.WHATSAPP_NUMERO_TESTE.replace(/\D/g, '');
    return { numero: teste, numeroBruto: numeroBruto || teste };
  }

  let numero = contato?.numeroWhatsapp ?? null;
  if (!numero && numeroBruto) {
    numero = escolherNumeroWhatsApp(contato?.celular ?? '', contato?.telefone ?? '').e164;
  }
  return { numero, numeroBruto };
}

/** Formata uma data ISO (yyyy-mm-dd) para dd/mm/yyyy; devolve original se não casar. */
function formatarDataBR(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Primeiro nome com inicial maiúscula, para a saudação do WhatsApp.
 * O Órix devolve o nome todo em CAIXA ALTA (ex.: "GABRIEL SERGIO GRACIANI");
 * aqui viramos só "Gabriel". Não afeta o nome exibido no sistema.
 */
function primeiroNomeProprio(nomeCompleto: string): string {
  const primeiro = nomeCompleto.trim().split(/\s+/)[0] ?? '';
  if (!primeiro) return '';
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

/** Conectores que ficam minúsculos no nome de empresa em Título. */
const CONECTORES_NOME = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'di', 'du']);
/** Sufixos jurídicos removidos do fim do nome da empresa. */
const SUFIXOS_PJ = new Set([
  'ltda',
  's/a',
  'sa',
  's.a',
  'me',
  'epp',
  'eireli',
  'mei',
  'cia',
  'ei',
]);

/**
 * Nome de empresa em Caixa de Título, sem o sufixo jurídico:
 * "PASTO BOM GESTAO DE NEGOCIOS S/A" -> "Pasto Bom Gestao de Negocios".
 */
function tituloEmpresa(nome: string): string {
  let palavras = nome.trim().split(/\s+/).filter(Boolean);
  while (palavras.length > 1) {
    const ultima = (palavras[palavras.length - 1] ?? '')
      .toLowerCase()
      .replace(/\.$/, '');
    if (SUFIXOS_PJ.has(ultima)) palavras = palavras.slice(0, -1);
    else break;
  }
  return palavras
    .map((p, i) => {
      const baixa = p.toLowerCase();
      if (i > 0 && CONECTORES_NOME.has(baixa)) return baixa;
      return baixa.charAt(0).toUpperCase() + baixa.slice(1);
    })
    .join(' ');
}

/**
 * Nome para a saudação do WhatsApp: pessoa física (CPF) -> primeiro nome;
 * empresa (CNPJ, 14 dígitos) -> nome completo em Título sem sufixo jurídico.
 */
function nomeParaSaudacao(
  nomeLegal: string,
  cpfCnpj: string | null | undefined,
): string {
  const digitos = (cpfCnpj ?? '').replace(/\D/g, '');
  if (digitos.length === 14) {
    return tituloEmpresa(nomeLegal) || primeiroNomeProprio(nomeLegal);
  }
  return primeiroNomeProprio(nomeLegal);
}

/** Monta as variáveis usadas na renderização dos templates de transição. */
function variaveisTemplate(
  pedido: Pedido,
  nomeSaudacao?: string,
): Record<string, string> {
  return {
    nome_cliente: nomeSaudacao ?? primeiroNomeProprio(pedido.clienteNome),
    numero: pedido.orixNumero || pedido.orixIdPedido,
    data_agendada: formatarDataBR(pedido.dataAgendada),
    propriedade: pedido.propriedadeCodigo ?? '',
  };
}
export async function dispararWhatsappEntrega(
  entrega: {
    id: string;
    pedidoId: string;
    orixNumero: string;
    clienteCodigo: string;
    clienteNome: string;
    dataAgendada: string;
    propriedadeCodigo: string | null;
  },
  template: Exclude<TemplateEntrega, null>,
): Promise<void> {
  try {
    const templates = await lerTemplates();
    const tpl = templates[template];
    if (!tpl) {
      log.warn(
        `[entregas] Template '${template}' ausente em sync_state; nada enviado ` +
          `(entrega ${entrega.id}).`,
      );
      return;
    }

    const contato = await lerContatoCliente(entrega.clienteCodigo);
    const corpo = renderTemplate(tpl, {
      nome_cliente: nomeParaSaudacao(entrega.clienteNome, contato?.cpfCnpj),
      numero: entrega.orixNumero,
      data_agendada: formatarDataBR(entrega.dataAgendada),
      propriedade: entrega.propriedadeCodigo ?? '',
    });

    const { numero, numeroBruto } = resolverNumeroWhatsapp(contato);

    const { data: msgRow, error: errInsert } = await supabase
      .from('mensagens_whatsapp')
      .insert({
        pedido_id: entrega.pedidoId,
        cliente_codigo: entrega.clienteCodigo,
        numero: numero ?? numeroBruto,
        template,
        corpo,
        status_envio: 'pendente',
      })
      .select('id')
      .single<{ id: string }>();

    if (errInsert || !msgRow) {
      log.error(
        `[entregas] Falha ao criar mensagem da entrega ${entrega.id}:`,
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
  } catch (err) {
    // Efeito colateral nunca invalida a transição já persistida.
    log.error(
      `[entregas] Erro ao disparar WhatsApp da entrega ${entrega.id}:`,
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** Papel do ator (espelha api/auth.ts; local p/ evitar ciclo de import). */
type AtorPapel = 'logistica' | 'vendedor' | 'motorista' | 'almoxarifado';

export interface AplicarTransicaoArgs {
  pedidoId: string;
  para: StatusLogistico;
  /** Para qual propriedade do cliente vai (RF-1.8). */
  propriedadeCodigo?: string;
  atorUserId?: string;
  atorPapel?: AtorPapel;
}

/**
 * Aplica uma transição de status ao PEDIDO.
 *
 * ESCOPO ESTREITO (Onda 2): sobrou o descarte — "não é entrega, tira daqui".
 * Agendar, despachar, entregar e não realizar são coisas da VIAGEM e moram em
 * services/entregas.ts.
 *
 * Nenhuma transição de pedido manda WhatsApp; a consulta a templateDaTransicao
 * fica como trava explícita disso (ver state-machine.ts).
 */
export async function aplicarTransicao(
  args: AplicarTransicaoArgs,
): Promise<Pedido> {
  const { pedidoId, para, propriedadeCodigo, atorUserId, atorPapel } = args;

  const pedidoAtual = await carregarPedido(pedidoId);
  const de = pedidoAtual.statusLogistico;

  // Só a logística mexe na situação da ordem de venda.
  if (atorPapel && atorPapel !== 'logistica') {
    throw new TransicaoError(
      403,
      'sem_permissao',
      'Apenas a logística pode alterar a situação de um pedido.',
    );
  }

  if (!podeTransicionar(de, para)) {
    throw new TransicaoError(
      409,
      'transicao_invalida',
      `Transição inválida: ${de} -> ${para}. ` +
        'Para agendar uma entrega, use a tela de entregas.',
    );
  }

  // Descartar um pedido que ainda tem viagem viva deixaria a entrega órfã no
  // quadro, sem pedido que a explique.
  if (para === 'cancelada') {
    const { data: abertas, error: errAbertas } = await supabase
      .from('entregas')
      .select('id')
      .eq('pedido_id', pedidoId)
      .in('status', ['agendada', 'em_rota']);
    if (errAbertas) {
      throw new TransicaoError(
        500,
        'erro_banco',
        `Falha ao verificar as entregas do pedido: ${errAbertas.message}`,
      );
    }
    if ((abertas ?? []).length > 0) {
      throw new TransicaoError(
        409,
        'entregas_em_aberto',
        `Este pedido tem ${(abertas ?? []).length} entrega(s) agendada(s) ou em rota. ` +
          'Cancele as entregas antes de descartar o pedido.',
      );
    }
  }

  const agora = new Date().toISOString();
  const { error: errUpdate } = await supabase
    .from('pedidos')
    .update({
      status_logistico: para,
      atualizado_em: agora,
      propriedade_codigo: propriedadeCodigo ?? pedidoAtual.propriedadeCodigo,
    })
    .eq('id', pedidoId);

  if (errUpdate) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao atualizar status do pedido: ${errUpdate.message}`,
    );
  }

  const { error: errEvento } = await supabase.from('eventos_status').insert({
    pedido_id: pedidoId,
    de_status: de,
    para_status: para,
    ator: atorUserId ? 'usuario' : 'sistema',
    ator_user_id: atorUserId ?? null,
  });
  if (errEvento) {
    log.error(
      `[transitions] Falha ao registrar evento_status do pedido ${pedidoId}:`,
      errEvento.message,
    );
  }

  const pedidoAtualizado = await carregarPedido(pedidoId);

  // Trava explícita: se um dia alguém acrescentar um template a uma transição
  // de pedido, isto avisa em vez de mandar mensagem em silêncio.
  const template = templateDaTransicao(de, para);
  if (template) {
    log.warn(
      `[transitions] Transição de PEDIDO ${de} -> ${para} pediu o template ` +
        `'${template}', mas mensagens ao cliente nascem de uma entrega. Nada enviado.`,
    );
  }

  return pedidoAtualizado;
}

/**
 * Reverte o pedido (hoje: só restaurar um descarte, cancelada -> pendente).
 * Apenas logística. NUNCA dispara WhatsApp.
 */
export async function reverterStatus(args: {
  pedidoId: string;
  para: StatusLogistico;
  atorUserId?: string;
  atorPapel?: AtorPapel;
}): Promise<Pedido> {
  const { pedidoId, para, atorUserId, atorPapel } = args;

  if (atorPapel && atorPapel !== 'logistica') {
    throw new TransicaoError(
      403,
      'sem_permissao',
      'Apenas a logística pode reverter o status de um pedido.',
    );
  }

  const pedidoAtual = await carregarPedido(pedidoId);
  const de = pedidoAtual.statusLogistico;

  if (!podeReverter(de, para)) {
    throw new TransicaoError(
      409,
      'reversao_invalida',
      `Reversão inválida: ${de} -> ${para}.`,
    );
  }

  const { error: errUpdate } = await supabase
    .from('pedidos')
    .update({ status_logistico: para, atualizado_em: new Date().toISOString() })
    .eq('id', pedidoId);
  if (errUpdate) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao reverter status do pedido: ${errUpdate.message}`,
    );
  }

  const { error: errEvento } = await supabase.from('eventos_status').insert({
    pedido_id: pedidoId,
    de_status: de,
    para_status: para,
    ator: atorUserId ? 'usuario' : 'sistema',
    ator_user_id: atorUserId ?? null,
  });
  if (errEvento) {
    log.error(
      `[transitions] Falha ao registrar evento_status (reversão) do pedido ${pedidoId}:`,
      errEvento.message,
    );
  }

  return carregarPedido(pedidoId);
}

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

  const contato = await lerContatoCliente(pedido.clienteCodigo);
  const corpo = renderTemplate(
    tpl,
    variaveisTemplate(pedido, nomeParaSaudacao(pedido.clienteNome, contato?.cpfCnpj)),
  );

  const { numero, numeroBruto } = resolverNumeroWhatsapp(contato);

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
