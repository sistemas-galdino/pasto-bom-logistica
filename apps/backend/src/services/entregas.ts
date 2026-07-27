// [AGENTE API] Serviço de ENTREGAS — o coração da Onda 2.
//
// Uma ENTREGA é uma viagem: parte (ou tudo) de um pedido saindo num caminhão.
// Um pedido pode ter várias, inclusive ao mesmo tempo — foi o caso da carga
// grande em vários caminhões que decidiu este modelo.
//
// A regra que sustenta tudo é o SALDO (packages/shared/src/saldo.ts):
//   saldo = itens do pedido − itens das entregas que consomem saldo
// Entrega nao_realizado/cancelada não consome, então a mercadoria volta para a
// fila sozinha. Não há, em lugar nenhum deste arquivo, um comando de "devolver
// o saldo" — ele é consequência da regra.
//
// GARANTIAS MANTIDAS DA FASE ANTERIOR:
//  - EXACTLY-ONCE no WhatsApp: uma linha em mensagens_whatsapp por transição.
//  - A ingestão NUNCA envia WhatsApp.
//  - Falha de envio não invalida a transição já persistida.

import {
  calcularSaldo,
  pesoDaCarga,
  podeReverterEntrega,
  podeTransicionarEntrega,
  templateDaTransicaoEntrega,
  validarQuantidades,
  type Entrega,
  type EntregaItem,
  type PeriodoEntrega,
  type SaldoItem,
  type StatusEntrega,
} from '@pastobom/shared';

import { supabase } from '../db/supabase.js';
import { log } from '../log.js';
import { TransicaoError } from './erros.js';
import {
  carregarCaminhao,
  lerPesosProdutos,
  validarCargaDoAgendamento,
} from './carga.js';
import { dispararWhatsappEntrega, exigirMotivoCadastrado } from './transitions.js';

// ---------------------------------------------------------------------------
// Linhas cruas
// ---------------------------------------------------------------------------

interface EntregaRow {
  id: string;
  pedido_id: string;
  status: StatusEntrega;
  data_agendada: string;
  periodo: PeriodoEntrega | null;
  motorista_id: string | null;
  caminhao_id: string | null;
  propriedade_codigo: string | null;
  data_entregue: string | null;
  motivo_nao_entrega: string | null;
  observacoes: string | null;
  criado_em: string;
  atualizado_em: string;
}

interface EntregaItemRow {
  id: string;
  entrega_id: string;
  produto_codigo: string;
  nome_produto: string | null;
  qtd: number | string | null;
  separado: boolean | null;
  separado_em: string | null;
}

/** Campos do pedido que o cartão da entrega precisa mostrar. */
interface PedidoDaEntregaRow {
  id: string;
  orix_numero: string | null;
  cliente_codigo: string | null;
  cliente_nome: string | null;
  cidade_cliente: string | null;
  data_pedido: string | null;
}

const COLUNAS_ENTREGA =
  'id, pedido_id, status, data_agendada, periodo, motorista_id, caminhao_id, ' +
  'propriedade_codigo, data_entregue, motivo_nao_entrega, observacoes, ' +
  'criado_em, atualizado_em';

const COLUNAS_ENTREGA_ITEM =
  'id, entrega_id, produto_codigo, nome_produto, qtd, separado, separado_em';

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// SALDO de um pedido
// ---------------------------------------------------------------------------

/**
 * Saldo de cada produto de um pedido: o que ainda não foi para nenhuma viagem.
 *
 * Lê os itens do pedido (fonte: Órix) e os itens de TODAS as entregas dele; a
 * regra de quais contam mora em @pastobom/shared.
 */
export async function saldoDoPedido(pedidoId: string): Promise<SaldoItem[]> {
  const [{ data: itens, error: errItens }, { data: entregas, error: errEnt }] =
    await Promise.all([
      supabase
        .from('itens_pedido')
        .select('produto_codigo, nome_produto, qtd')
        .eq('pedido_id', pedidoId),
      supabase
        .from('entregas')
        .select('id, status, entrega_itens(produto_codigo, qtd)')
        .eq('pedido_id', pedidoId),
    ]);

  if (errItens) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao ler os itens do pedido: ${errItens.message}`,
    );
  }
  if (errEnt) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao ler as entregas do pedido: ${errEnt.message}`,
    );
  }

  const linhasPedido = (itens ?? []).map((i) => ({
    produtoCodigo: (i.produto_codigo as string) ?? '',
    nomeProduto: (i.nome_produto as string) ?? '',
    qtd: num(i.qtd as number | string | null),
  }));

  const linhasEntrega: {
    produtoCodigo: string;
    qtd: number;
    statusEntrega: StatusEntrega;
  }[] = [];
  for (const e of (entregas ?? []) as unknown as {
    status: StatusEntrega;
    entrega_itens: { produto_codigo: string; qtd: number | string }[] | null;
  }[]) {
    for (const item of e.entrega_itens ?? []) {
      linhasEntrega.push({
        produtoCodigo: item.produto_codigo,
        qtd: num(item.qtd),
        statusEntrega: e.status,
      });
    }
  }

  const saldo = calcularSaldo(linhasPedido, linhasEntrega);

  // Peso unitário resolvido em lote (produtos_peso), como no ItemPedido.
  const pesos = await lerPesosProdutos(saldo.map((s) => s.produtoCodigo));
  return saldo.map((s) => ({
    ...s,
    pesoUnitKg: pesos.get(s.produtoCodigo) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Leitura de entregas
// ---------------------------------------------------------------------------

/** Resolve nomes de motorista em lote (profiles). */
async function nomesDeMotorista(
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((i) => i))];
  if (unicos.length === 0) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, nome')
    .in('id', unicos);
  if (error) {
    log.warn(`[entregas] Falha ao resolver motoristas: ${error.message}`);
    return new Map();
  }
  return new Map(
    (data ?? []).map((p) => [p.id as string, (p.nome as string) ?? '']),
  );
}

/** Resolve nomes de caminhão em lote. */
async function nomesDeCaminhao(
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((i) => i))];
  if (unicos.length === 0) return new Map();
  const { data, error } = await supabase
    .from('caminhoes')
    .select('id, nome')
    .in('id', unicos);
  if (error) {
    log.warn(`[entregas] Falha ao resolver caminhões: ${error.message}`);
    return new Map();
  }
  return new Map(
    (data ?? []).map((c) => [c.id as string, (c.nome as string) ?? '']),
  );
}

/** Bairro por código de cliente (entregas rurais se orientam por bairro). */
async function bairrosDeCliente(
  codigos: readonly string[],
): Promise<Map<string, string | null>> {
  const unicos = [...new Set(codigos.filter((c) => c))];
  if (unicos.length === 0) return new Map();
  const { data, error } = await supabase
    .from('clientes')
    .select('codigo, bairro')
    .in('codigo', unicos);
  if (error) {
    log.warn(`[entregas] Falha ao resolver bairros: ${error.message}`);
    return new Map();
  }
  return new Map(
    (data ?? []).map((c) => [c.codigo as string, (c.bairro as string) ?? null]),
  );
}

/**
 * Monta os objetos Entrega completos a partir das linhas cruas, resolvendo
 * pedido, cliente, motorista, caminhão e pesos EM LOTE (sem N+1).
 */
async function montarEntregas(linhas: EntregaRow[]): Promise<Entrega[]> {
  if (linhas.length === 0) return [];

  const idsEntrega = linhas.map((l) => l.id);
  const idsPedido = [...new Set(linhas.map((l) => l.pedido_id))];

  const [
    { data: itensRows, error: errItens },
    { data: pedidosRows, error: errPedidos },
  ] = await Promise.all([
    supabase
      .from('entrega_itens')
      .select(COLUNAS_ENTREGA_ITEM)
      .in('entrega_id', idsEntrega),
    supabase
      .from('pedidos')
      .select('id, orix_numero, cliente_codigo, cliente_nome, cidade_cliente, data_pedido')
      .in('id', idsPedido),
  ]);

  if (errItens) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao ler os itens das entregas: ${errItens.message}`,
    );
  }
  if (errPedidos) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao ler os pedidos das entregas: ${errPedidos.message}`,
    );
  }

  const itens = (itensRows ?? []) as EntregaItemRow[];
  const pedidos = new Map(
    ((pedidosRows ?? []) as PedidoDaEntregaRow[]).map((p) => [p.id, p]),
  );

  const [motoristas, caminhoes, bairros, pesos] = await Promise.all([
    nomesDeMotorista(linhas.map((l) => l.motorista_id ?? '')),
    nomesDeCaminhao(linhas.map((l) => l.caminhao_id ?? '')),
    bairrosDeCliente(
      [...pedidos.values()].map((p) => p.cliente_codigo ?? ''),
    ),
    lerPesosProdutos(itens.map((i) => i.produto_codigo)),
  ]);

  const itensPorEntrega = new Map<string, EntregaItem[]>();
  for (const i of itens) {
    const lista = itensPorEntrega.get(i.entrega_id) ?? [];
    lista.push({
      id: i.id,
      produtoCodigo: i.produto_codigo,
      nomeProduto: i.nome_produto ?? '',
      qtd: num(i.qtd),
      separado: i.separado === true,
      separadoEm: i.separado_em,
      pesoUnitKg: pesos.get(i.produto_codigo) ?? null,
    });
    itensPorEntrega.set(i.entrega_id, lista);
  }

  return linhas.map((l) => {
    const pedido = pedidos.get(l.pedido_id);
    const itensDaEntrega = itensPorEntrega.get(l.id) ?? [];
    return {
      id: l.id,
      pedidoId: l.pedido_id,
      status: l.status,
      dataAgendada: l.data_agendada,
      periodo: l.periodo,
      motoristaId: l.motorista_id,
      motoristaNome: l.motorista_id
        ? (motoristas.get(l.motorista_id) ?? '')
        : null,
      caminhaoId: l.caminhao_id,
      caminhaoNome: l.caminhao_id ? (caminhoes.get(l.caminhao_id) ?? null) : null,
      propriedadeCodigo: l.propriedade_codigo,
      dataEntregue: l.data_entregue,
      motivoNaoEntrega: l.motivo_nao_entrega,
      observacoes: l.observacoes,
      orixNumero: pedido?.orix_numero ?? '',
      clienteCodigo: pedido?.cliente_codigo ?? '',
      clienteNome: pedido?.cliente_nome ?? '',
      cidadeCliente: pedido?.cidade_cliente ?? '',
      bairro: bairros.get(pedido?.cliente_codigo ?? '') ?? null,
      dataPedido: pedido?.data_pedido ?? null,
      pesoTotalKg: pesoDaCarga(itensDaEntrega),
      itens: itensDaEntrega,
      criadoEm: l.criado_em,
      atualizadoEm: l.atualizado_em,
    };
  });
}

/** Carrega uma entrega; 404 se não existir. */
export async function carregarEntrega(entregaId: string): Promise<Entrega> {
  const { data, error } = await supabase
    .from('entregas')
    .select(COLUNAS_ENTREGA)
    .eq('id', entregaId)
    .maybeSingle<EntregaRow>();

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao carregar a entrega: ${error.message}`,
    );
  }
  if (!data) {
    throw new TransicaoError(404, 'nao_encontrado', 'Entrega não encontrada.');
  }
  const [entrega] = await montarEntregas([data]);
  return entrega as Entrega;
}

export interface FiltrosEntrega {
  status?: StatusEntrega[];
  /** Só entregas a partir desta data agendada (YYYY-MM-DD). */
  de?: string;
  ate?: string;
  motoristaId?: string;
  pedidoId?: string;
  /**
   * Para a coluna "Não realizado" do quadro: limita as falhas às dos últimos N
   * dias. Sem isso a coluna vira depósito — o saldo já voltou para a fila
   * sozinho, então a viagem antiga ali é só histórico.
   */
  naoRealizadoDesde?: string;
}

/** Lista entregas aplicando os filtros; ordena pela data agendada. */
export async function listarEntregas(
  filtros: FiltrosEntrega = {},
): Promise<Entrega[]> {
  let consulta = supabase.from('entregas').select(COLUNAS_ENTREGA);

  if (filtros.status && filtros.status.length > 0) {
    consulta = consulta.in('status', filtros.status);
  }
  if (filtros.de) consulta = consulta.gte('data_agendada', filtros.de);
  if (filtros.ate) consulta = consulta.lte('data_agendada', filtros.ate);
  if (filtros.motoristaId) {
    consulta = consulta.eq('motorista_id', filtros.motoristaId);
  }
  if (filtros.pedidoId) consulta = consulta.eq('pedido_id', filtros.pedidoId);

  const { data, error } = await consulta.order('data_agendada', {
    ascending: true,
  });

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao listar entregas: ${error.message}`,
    );
  }

  let linhas = (data ?? []) as unknown as EntregaRow[];

  // O corte das não realizadas antigas é feito aqui (e não no SQL) porque só
  // vale para ESSE status: as demais colunas não têm janela.
  if (filtros.naoRealizadoDesde) {
    const corte = filtros.naoRealizadoDesde;
    linhas = linhas.filter(
      (l) => l.status !== 'nao_realizado' || l.data_agendada >= corte,
    );
  }

  return montarEntregas(linhas);
}

// ---------------------------------------------------------------------------
// Criação (o "agendar")
// ---------------------------------------------------------------------------

export interface CriarEntregaArgs {
  pedidoId: string;
  dataAgendada: string;
  periodo: PeriodoEntrega;
  motoristaId: string;
  caminhaoId: string;
  propriedadeCodigo?: string;
  /** produto_codigo -> quantidade desta viagem. */
  quantidades: Record<string, number>;
  atorUserId?: string;
}

/**
 * Cria uma entrega (o "agendar" do quadro).
 *
 * Valida, nesta ordem: quantidades contra o saldo, peso conhecido de tudo que
 * vai, e as travas de carga do slot (capacidade, caminhão com dois motoristas,
 * motorista em dois caminhões).
 */
export async function criarEntrega(args: CriarEntregaArgs): Promise<Entrega> {
  const {
    pedidoId,
    dataAgendada,
    periodo,
    motoristaId,
    caminhaoId,
    propriedadeCodigo,
    quantidades,
    atorUserId,
  } = args;

  // O pedido existe? (e serve para a contagem de propriedades)
  const { data: pedido, error: errPedido } = await supabase
    .from('pedidos')
    .select('id, cliente_codigo, status_logistico')
    .eq('id', pedidoId)
    .maybeSingle<{
      id: string;
      cliente_codigo: string | null;
      status_logistico: string;
    }>();

  if (errPedido) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao carregar o pedido: ${errPedido.message}`,
    );
  }
  if (!pedido) {
    throw new TransicaoError(404, 'nao_encontrado', 'Pedido não encontrado.');
  }
  if (pedido.status_logistico === 'cancelada') {
    throw new TransicaoError(
      409,
      'pedido_cancelado',
      'Este pedido está cancelado. Restaure-o antes de agendar uma entrega.',
    );
  }

  // 1) Quantidades contra o saldo.
  const saldo = await saldoDoPedido(pedidoId);
  const mapa = new Map<string, number>(
    Object.entries(quantidades).map(([k, v]) => [k, Number(v)]),
  );
  const erros = validarQuantidades(saldo, mapa);
  if (erros.length > 0) {
    throw new TransicaoError(422, 'quantidade_invalida', erros.join(' '));
  }

  // Só o que tem quantidade positiva vira linha da entrega.
  const linhas = [...mapa]
    .filter(([, qtd]) => qtd > 0)
    .map(([codigo, qtd]) => {
      const item = saldo.find((s) => s.produtoCodigo === codigo) as SaldoItem;
      return {
        produto_codigo: codigo,
        nome_produto: item.nomeProduto,
        qtd,
        pesoUnitKg: item.pesoUnitKg,
      };
    });

  // 2) Peso: sem o peso de TUDO que vai, não dá para saber se cabe.
  const peso = pesoDaCarga(
    linhas.map((l) => ({ qtd: l.qtd, pesoUnitKg: l.pesoUnitKg })),
  );
  if (peso === null) {
    const faltando = linhas
      .filter((l) => l.pesoUnitKg === null)
      .map((l) => l.nome_produto || l.produto_codigo)
      .join(', ');
    throw new TransicaoError(
      422,
      'peso_pendente',
      `Falta o peso de: ${faltando}. Cadastre o peso desses produtos para agendar.`,
    );
  }

  // 3) RF-1.8: cliente com mais de uma propriedade exige escolher para qual vai.
  const { count, error: errProps } = await supabase
    .from('propriedades')
    .select('codigo', { count: 'exact', head: true })
    .eq('cliente_codigo', pedido.cliente_codigo ?? '');
  if (errProps) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao contar propriedades: ${errProps.message}`,
    );
  }
  if ((count ?? 0) > 1 && !propriedadeCodigo) {
    throw new TransicaoError(
      422,
      'propriedade_exigida',
      'Cliente possui mais de uma propriedade; informe propriedadeCodigo.',
    );
  }

  // 4) Travas de carga do slot (capacidade e os pares motorista/caminhão).
  await carregarCaminhao(caminhaoId); // 422 se inválido/inativo
  await validarCargaDoAgendamento({
    data: dataAgendada,
    periodo,
    motoristaId,
    caminhaoId,
    pesoDaCargaKg: peso,
  });

  // 5) Grava a entrega e seus itens.
  const { data: criada, error: errIns } = await supabase
    .from('entregas')
    .insert({
      pedido_id: pedidoId,
      status: 'agendada',
      data_agendada: dataAgendada,
      periodo,
      motorista_id: motoristaId,
      caminhao_id: caminhaoId,
      propriedade_codigo: propriedadeCodigo ?? null,
    })
    .select('id')
    .single<{ id: string }>();

  if (errIns || !criada) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao criar a entrega: ${errIns?.message ?? 'sem retorno'}`,
    );
  }

  const { error: errItens } = await supabase.from('entrega_itens').insert(
    linhas.map((l) => ({
      entrega_id: criada.id,
      produto_codigo: l.produto_codigo,
      nome_produto: l.nome_produto,
      qtd: l.qtd,
    })),
  );

  if (errItens) {
    // Entrega sem itens é lixo: desfaz para não deixar meia-criação no banco.
    await supabase.from('entregas').delete().eq('id', criada.id);
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao gravar os itens da entrega: ${errItens.message}`,
    );
  }

  // 6) Auditoria + WhatsApp de agendamento.
  await registrarEvento({
    pedidoId,
    entregaId: criada.id,
    de: null,
    para: 'agendada',
    atorUserId,
  });

  const entrega = await carregarEntrega(criada.id);
  await dispararWhatsappEntrega(entrega, 'agendamento');
  return entrega;
}

// ---------------------------------------------------------------------------
// Transições
// ---------------------------------------------------------------------------

type AtorPapel = 'logistica' | 'vendedor' | 'motorista' | 'almoxarifado';

export interface TransicionarEntregaArgs {
  entregaId: string;
  para: StatusEntrega;
  observacao?: string;
  /** Obrigatório em para==='nao_realizado'; tem de estar na lista cadastrada. */
  motivo?: string;
  atorUserId?: string;
  atorPapel?: AtorPapel;
}

export async function transicionarEntrega(
  args: TransicionarEntregaArgs,
): Promise<Entrega> {
  const { entregaId, para, observacao, motivo, atorUserId, atorPapel } = args;

  const entrega = await carregarEntrega(entregaId);
  const de = entrega.status;

  // O motorista só encerra as PRÓPRIAS viagens, para bem ou para mal.
  if (atorPapel === 'motorista') {
    if (para !== 'entregue' && para !== 'nao_realizado') {
      throw new TransicaoError(
        403,
        'sem_permissao',
        'Motorista só pode confirmar a entrega ou marcá-la como não realizada.',
      );
    }
    if (!atorUserId || entrega.motoristaId !== atorUserId) {
      throw new TransicaoError(
        403,
        'sem_permissao',
        'Você não é o motorista desta entrega.',
      );
    }
  }

  if (!podeTransicionarEntrega(de, para)) {
    throw new TransicaoError(
      409,
      'transicao_invalida',
      `Transição inválida: ${de} -> ${para}.`,
    );
  }

  // Despacho: só sai com a carga conferida.
  if (para === 'em_rota') {
    const naoSeparados = entrega.itens.filter((i) => !i.separado);
    if (entrega.itens.length > 0 && naoSeparados.length > 0) {
      throw new TransicaoError(
        422,
        'separacao_incompleta',
        `Separação incompleta: ${naoSeparados.length} de ${entrega.itens.length} ` +
          'item(ns) ainda não separado(s).',
      );
    }
  }

  const motivoLimpo = motivo?.trim() ?? '';
  if (para === 'nao_realizado') {
    if (motivoLimpo === '') {
      throw new TransicaoError(
        422,
        'motivo_obrigatorio',
        'Informe por que a entrega não foi realizada.',
      );
    }
    await exigirMotivoCadastrado(motivoLimpo);
  }

  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = { status: para, atualizado_em: agora };
  if (para === 'entregue') {
    patch.data_entregue = agora;
    if (observacao) patch.observacoes = observacao;
  }
  if (para === 'nao_realizado') patch.motivo_nao_entrega = motivoLimpo;

  const { error } = await supabase
    .from('entregas')
    .update(patch)
    .eq('id', entregaId);
  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao atualizar a entrega: ${error.message}`,
    );
  }

  await registrarEvento({
    pedidoId: entrega.pedidoId,
    entregaId,
    de,
    para,
    atorUserId,
  });

  const atualizada = await carregarEntrega(entregaId);

  // O pedido acompanha: zerou o saldo e tudo entregue -> pedido entregue.
  await sincronizarStatusDoPedido(entrega.pedidoId);

  // WhatsApp. O template de "entregue" depende de ter sobrado saldo: dizer
  // "entregue com sucesso" quando foram 100 de 180 é mentira.
  const saldoDepois = await saldoDoPedido(entrega.pedidoId);
  const sobra = saldoDepois.some((s) => s.qtdSaldo > 0);
  const template = templateDaTransicaoEntrega(de, para, sobra);
  if (template) {
    await dispararWhatsappEntrega(atualizada, template);
  }

  return atualizada;
}

/** Reverte a entrega uma etapa (só em_rota -> agendada). Nunca manda WhatsApp. */
export async function reverterEntrega(args: {
  entregaId: string;
  para: StatusEntrega;
  atorUserId?: string;
  atorPapel?: AtorPapel;
}): Promise<Entrega> {
  const { entregaId, para, atorUserId, atorPapel } = args;

  if (atorPapel && atorPapel !== 'logistica') {
    throw new TransicaoError(
      403,
      'sem_permissao',
      'Apenas a logística pode reverter uma entrega.',
    );
  }

  const entrega = await carregarEntrega(entregaId);
  const de = entrega.status;

  if (!podeReverterEntrega(de, para)) {
    throw new TransicaoError(
      409,
      'reversao_invalida',
      `Reversão inválida: ${de} -> ${para}.`,
    );
  }

  const { error } = await supabase
    .from('entregas')
    .update({ status: para, atualizado_em: new Date().toISOString() })
    .eq('id', entregaId);
  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao reverter a entrega: ${error.message}`,
    );
  }

  await registrarEvento({
    pedidoId: entrega.pedidoId,
    entregaId,
    de,
    para,
    atorUserId,
  });
  await sincronizarStatusDoPedido(entrega.pedidoId);
  return carregarEntrega(entregaId);
}

// ---------------------------------------------------------------------------
// Separação (agora por VIAGEM)
// ---------------------------------------------------------------------------

/** Marca/desmarca um item da entrega. Só antes de a viagem sair. */
export async function definirSeparacaoItemEntrega(args: {
  entregaId: string;
  itemId: string;
  separado: boolean;
}): Promise<Entrega> {
  const { entregaId, itemId, separado } = args;
  const entrega = await carregarEntrega(entregaId);

  if (entrega.status !== 'agendada') {
    throw new TransicaoError(
      409,
      'separacao_estado_invalido',
      'A separação só pode ser ajustada em entregas agendadas.',
    );
  }
  if (!entrega.itens.some((i) => i.id === itemId)) {
    throw new TransicaoError(
      404,
      'item_nao_encontrado',
      'Item não encontrado nesta entrega.',
    );
  }

  const { error } = await supabase
    .from('entrega_itens')
    .update({
      separado,
      separado_em: separado ? new Date().toISOString() : null,
    })
    .eq('id', itemId)
    .eq('entrega_id', entregaId);

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao atualizar a separação: ${error.message}`,
    );
  }
  return carregarEntrega(entregaId);
}

/** "Dar OK na separação": marca todos os itens da entrega de uma vez. */
export async function definirSeparacaoEntrega(args: {
  entregaId: string;
  separado: boolean;
}): Promise<Entrega> {
  const { entregaId, separado } = args;
  const entrega = await carregarEntrega(entregaId);

  if (entrega.status !== 'agendada') {
    throw new TransicaoError(
      409,
      'separacao_estado_invalido',
      'A separação só pode ser ajustada em entregas agendadas.',
    );
  }

  const { error } = await supabase
    .from('entrega_itens')
    .update({
      separado,
      separado_em: separado ? new Date().toISOString() : null,
    })
    .eq('entrega_id', entregaId);

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao atualizar a separação: ${error.message}`,
    );
  }
  return carregarEntrega(entregaId);
}

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

/**
 * Ajusta o status do PEDIDO conforme suas entregas.
 *
 * Depois da Onda 2 o pedido responde só por: tem saldo (pendente) ou acabou
 * (entregue). Nunca mexe em pedido cancelado — cancelamento vem do Órix, e a
 * reconciliação é dona dele.
 */
async function sincronizarStatusDoPedido(pedidoId: string): Promise<void> {
  const { data: pedido, error } = await supabase
    .from('pedidos')
    .select('status_logistico')
    .eq('id', pedidoId)
    .maybeSingle<{ status_logistico: string }>();
  if (error || !pedido || pedido.status_logistico === 'cancelada') return;

  const saldo = await saldoDoPedido(pedidoId);
  const temSaldo = saldo.some((s) => s.qtdSaldo > 0);

  // Sem saldo, o pedido só está "entregue" se nenhuma viagem estiver em aberto.
  const { data: abertas } = await supabase
    .from('entregas')
    .select('id')
    .eq('pedido_id', pedidoId)
    .in('status', ['agendada', 'em_rota'])
    .limit(1);

  const novo =
    !temSaldo && (abertas ?? []).length === 0 ? 'entregue' : 'pendente';
  if (novo === pedido.status_logistico) return;

  await supabase
    .from('pedidos')
    .update({ status_logistico: novo, atualizado_em: new Date().toISOString() })
    .eq('id', pedidoId);
}

/** Registra o evento de auditoria da entrega (nunca derruba a operação). */
async function registrarEvento(args: {
  pedidoId: string;
  entregaId: string;
  de: StatusEntrega | null;
  para: StatusEntrega;
  atorUserId?: string;
}): Promise<void> {
  const { pedidoId, entregaId, de, para, atorUserId } = args;
  const { error } = await supabase.from('eventos_status').insert({
    pedido_id: pedidoId,
    entrega_id: entregaId,
    // As colunas de/para usam o enum status_logistico, que compartilha os
    // mesmos nomes; 'agendada'/'em_rota'/'entregue'/'nao_realizado'/'cancelada'
    // existem nos dois.
    de_status: de,
    para_status: para,
    ator: atorUserId ? 'usuario' : 'sistema',
    ator_user_id: atorUserId ?? null,
  });
  if (error) {
    log.error(
      `[entregas] Falha ao registrar evento da entrega ${entregaId}: ${error.message}`,
    );
  }
}
