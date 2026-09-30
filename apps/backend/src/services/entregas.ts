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
  avaliarConclusao,
  avaliarPesoAgendamento,
  calcularSaldo,
  temDivergencia,
  pesoDaCarga,
  podeReverterEntrega,
  podeTransicionarEntrega,
  reordenarSubconjunto,
  ROTULO_STATUS_ENTREGA,
  templateDaTransicaoEntrega,
  validarQuantidades,
  type Entrega,
  type DestinoEntrega,
  type EntregaItem,
  type LinhaItemEntrega,
  type PapelUsuario,
  type PeriodoEntrega,
  type SaldoItem,
  type StatusEntrega,
} from '@pastobom/shared';

import { supabase } from '../db/supabase.js';
import { log } from '../log.js';
import { TransicaoError } from './erros.js';
import {
  carregarCaminhao,
  gravarPesosManuais,
  lerPesosDetalhados,
  lerPesosProdutos,
  validarCargaDoAgendamento,
} from './carga.js';
import {
  dispararWhatsappEntrega,
  exigirMotivoCadastrado,
} from './transitions.js';

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
  /** Ordem da parada no dia do motorista (0022); null = não sequenciada. */
  ordem_rota: number | string | null;
  data_entregue: string | null;
  motivo_nao_entrega: string | null;
  observacoes: string | null;
  /** 0025: o restante recusado de uma entrega parcial. */
  encerra_saldo: boolean | null;
  origem_entrega_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

interface EntregaItemRow {
  id: string;
  entrega_id: string;
  produto_codigo: string;
  nome_produto: string | null;
  qtd: number | string | null;
  /** 0025: quanto o cliente recebeu; null = não declarado. */
  qtd_entregue: number | string | null;
  separado: boolean | null;
  separado_em: string | null;
  /** Peso unitário congelado no agendamento (0019). Null nas viagens antigas. */
  peso_unit_kg: number | string | null;
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
  'propriedade_codigo, ordem_rota, data_entregue, motivo_nao_entrega, ' +
  'observacoes, encerra_saldo, origem_entrega_id, criado_em, atualizado_em';

const COLUNAS_ENTREGA_ITEM =
  'id, entrega_id, produto_codigo, nome_produto, qtd, qtd_entregue, separado, ' +
  'separado_em, peso_unit_kg';

/** Quantidade declarada, ou null. Lixo numérico cai para "não declarado". */
function qtdOuNulo(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Ordem da parada, ou null. Zero e negativo caem para null: o banco tem check de
 * `> 0`, então um valor fora disso é dado corrompido — melhor tratar como "não
 * sequenciada" do que mandar 0 para a tela ordenar.
 */
function ordemOuNulo(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Peso congelado do item da viagem, ou null se a viagem é anterior à 0019. */
function pesoCongelado(item: {
  peso_unit_kg: number | string | null;
}): number | null {
  if (item.peso_unit_kg === null || item.peso_unit_kg === undefined)
    return null;
  const n = Number(item.peso_unit_kg);
  return Number.isFinite(n) ? n : null;
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
        .select(
          'id, status, encerra_saldo, entrega_itens(produto_codigo, qtd, qtd_entregue)',
        )
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

  const linhasEntrega: LinhaItemEntrega[] = [];
  for (const e of (entregas ?? []) as unknown as {
    status: StatusEntrega;
    encerra_saldo: boolean | null;
    entrega_itens:
      | {
          produto_codigo: string;
          qtd: number | string;
          qtd_entregue: number | string | null;
        }[]
      | null;
  }[]) {
    for (const item of e.entrega_itens ?? []) {
      linhasEntrega.push({
        produtoCodigo: item.produto_codigo,
        qtd: num(item.qtd),
        qtdEntregue: qtdOuNulo(item.qtd_entregue),
        statusEntrega: e.status,
        encerraSaldo: e.encerra_saldo === true,
      });
    }
  }

  const saldo = calcularSaldo(linhasPedido, linhasEntrega);

  // Peso resolvido em lote (produtos_peso), com a procedência: a tela de
  // agendamento pede conferência do peso 'manual' e ignora o 'auto'.
  const pesos = await lerPesosDetalhados(saldo.map((s) => s.produtoCodigo));
  return saldo.map((s) => {
    const p = pesos.get(s.produtoCodigo);
    return {
      ...s,
      pesoUnitKg: p?.kg ?? null,
      pesoOrigem: p?.origem ?? null,
      pesoAtualizadoEm: p?.atualizadoEm ?? null,
    };
  });
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

/** Propriedade/cliente -> destino de navegação, em lote (sem N+1). */
async function resolverDestinos(
  propCodigos: readonly string[],
  cliCodigos: readonly string[],
): Promise<{
  props: Map<string, DestinoEntrega>;
  clientes: Map<string, DestinoEntrega>;
}> {
  const toDestino = (r: Record<string, unknown>): DestinoEntrega => ({
    latitude: (r.latitude as string) ?? '',
    longitude: (r.longitude as string) ?? '',
    endereco: (r.endereco as string) ?? '',
    cidade: (r.cidade as string) ?? '',
    uf: (r.uf as string) ?? '',
  });

  const props = new Map<string, DestinoEntrega>();
  const clientes = new Map<string, DestinoEntrega>();

  const p = [...new Set(propCodigos.filter((c) => c))];
  const c = [...new Set(cliCodigos.filter((x) => x))];

  const [rp, rc] = await Promise.all([
    p.length > 0
      ? supabase
          .from('propriedades')
          .select('codigo, endereco, cidade, uf, latitude, longitude')
          .in('codigo', p)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    c.length > 0
      ? supabase
          .from('clientes')
          .select('codigo, endereco, cidade, uf, latitude, longitude')
          .in('codigo', c)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  for (const r of (rp.data ?? []) as Record<string, unknown>[]) {
    props.set(r.codigo as string, toDestino(r));
  }
  for (const r of (rc.data ?? []) as Record<string, unknown>[]) {
    clientes.set(r.codigo as string, toDestino(r));
  }
  return { props, clientes };
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
 * Dos pedidos informados, os que já tiveram uma entrega PARCIAL de verdade: uma
 * viagem entregue em que o cliente recebeu menos do que foi carregado (0025).
 *
 * Olha todas as viagens entregues do pedido, sem janela de data — a tag amarela
 * não pode apagar só porque a tela carregou uma semana diferente. Falha de
 * leitura devolve vazio: a tag é aviso, e derrubar o quadro por ela seria pior.
 */
export async function pedidosComEntregaParcial(
  pedidoIds: readonly string[],
): Promise<Set<string>> {
  const unicos = [...new Set(pedidoIds.filter((i) => i))];
  if (unicos.length === 0) return new Set();
  const { data, error } = await supabase
    .from('entregas')
    .select('pedido_id, entrega_itens(qtd, qtd_entregue)')
    .in('pedido_id', unicos)
    .eq('status', 'entregue');
  if (error) {
    log.warn(`[entregas] Falha ao ler as entregas parciais: ${error.message}`);
    return new Set();
  }
  const parciais = new Set<string>();
  for (const e of (data ?? []) as unknown as {
    pedido_id: string;
    entrega_itens:
      | { qtd: number | string | null; qtd_entregue: number | string | null }[]
      | null;
  }[]) {
    const itens = (e.entrega_itens ?? []).map((i) => ({
      qtd: num(i.qtd),
      qtdEntregue: qtdOuNulo(i.qtd_entregue),
    }));
    if (temDivergencia(itens)) parciais.add(e.pedido_id);
  }
  return parciais;
}

/**
 * Monta os objetos Entrega completos a partir das linhas cruas, resolvendo
 * pedido, cliente, motorista, caminhão e pesos EM LOTE (sem N+1).
 */
async function montarEntregas(
  linhas: EntregaRow[],
  /** Só a rota do motorista precisa do destino (é o link do mapa). */
  comDestino = false,
): Promise<Entrega[]> {
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
      .select(
        'id, orix_numero, cliente_codigo, cliente_nome, cidade_cliente, data_pedido',
      )
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

  const itens = (itensRows ?? []) as unknown as EntregaItemRow[];
  const pedidos = new Map(
    ((pedidosRows ?? []) as PedidoDaEntregaRow[]).map((p) => [p.id, p]),
  );

  const destinos = comDestino
    ? await resolverDestinos(
        linhas.map((l) => l.propriedade_codigo ?? ''),
        [...pedidos.values()].map((p) => p.cliente_codigo ?? ''),
      )
    : null;

  const [motoristas, caminhoes, bairros, pesos, parciais] = await Promise.all([
    nomesDeMotorista(linhas.map((l) => l.motorista_id ?? '')),
    nomesDeCaminhao(linhas.map((l) => l.caminhao_id ?? '')),
    bairrosDeCliente([...pedidos.values()].map((p) => p.cliente_codigo ?? '')),
    lerPesosProdutos(itens.map((i) => i.produto_codigo)),
    pedidosComEntregaParcial(idsPedido),
  ]);

  const itensPorEntrega = new Map<string, EntregaItem[]>();
  for (const i of itens) {
    const lista = itensPorEntrega.get(i.entrega_id) ?? [];
    lista.push({
      id: i.id,
      produtoCodigo: i.produto_codigo,
      nomeProduto: i.nome_produto ?? '',
      qtd: num(i.qtd),
      qtdEntregue: qtdOuNulo(i.qtd_entregue),
      separado: i.separado === true,
      separadoEm: i.separado_em,
      // O peso CONGELADO no agendamento manda (0019): é o que de fato saiu no
      // caminhão naquele dia. O cadastro só responde pelas viagens anteriores à
      // migração — sem isso, corrigir o peso da soja reescreveria o histórico.
      pesoUnitKg: pesoCongelado(i) ?? pesos.get(i.produto_codigo) ?? null,
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
      caminhaoNome: l.caminhao_id
        ? (caminhoes.get(l.caminhao_id) ?? null)
        : null,
      propriedadeCodigo: l.propriedade_codigo,
      ordemRota: ordemOuNulo(l.ordem_rota),
      dataEntregue: l.data_entregue,
      motivoNaoEntrega: l.motivo_nao_entrega,
      observacoes: l.observacoes,
      encerraSaldo: l.encerra_saldo === true,
      origemEntregaId: l.origem_entrega_id,
      pedidoParcial: parciais.has(l.pedido_id),
      orixNumero: pedido?.orix_numero ?? '',
      clienteCodigo: pedido?.cliente_codigo ?? '',
      clienteNome: pedido?.cliente_nome ?? '',
      cidadeCliente: pedido?.cidade_cliente ?? '',
      bairro: bairros.get(pedido?.cliente_codigo ?? '') ?? null,
      dataPedido: pedido?.data_pedido ?? null,
      pesoTotalKg: pesoDaCarga(itensDaEntrega),
      destino: destinos
        ? ((l.propriedade_codigo
            ? destinos.props.get(l.propriedade_codigo)
            : undefined) ??
          destinos.clientes.get(pedido?.cliente_codigo ?? '') ??
          null)
        : null,
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
  comDestino = false,
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

  return montarEntregas(linhas, comDestino);
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
  /**
   * produto_codigo -> peso unitário (kg) digitado na tela de agendamento.
   * Vale mais que o cadastro: é a informação mais recente que existe sobre
   * aquele lote.
   */
  pesos?: Record<string, number>;
  atorUserId?: string;
}

/**
 * Cria uma entrega (o "agendar" do quadro).
 *
 * Valida, nesta ordem: quantidades contra o saldo, peso conhecido de tudo que
 * vai, e as travas de carga do slot (capacidade, caminhão com dois motoristas,
 * motorista em dois caminhões).
 *
 * O peso de cada produto fica CONGELADO na viagem (`entrega_itens.peso_unit_kg`,
 * migração 0019). O cadastro `produtos_peso` guarda o último valor informado só
 * para sugerir no próximo pedido — assim, corrigir o peso da soja não reescreve
 * o peso das viagens que já saíram.
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
    pesos: pesosInformados,
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

  // 2) Peso: sem o peso de TUDO que vai, não dá para saber se cabe. A regra é a
  // MESMA que a tela usa (@pastobom/shared) — foi um `if` duplicado entre os
  // dois lados que sumiu numa refatoração e deixou o botão habilitado com o
  // servidor recusando.
  const mapaPesos = new Map<string, number>(
    Object.entries(pesosInformados ?? {}).map(([k, v]) => [k, Number(v)]),
  );
  const avaliacao = avaliarPesoAgendamento({
    linhas: saldo.map((s) => ({
      produtoCodigo: s.produtoCodigo,
      nomeProduto: s.nomeProduto,
      pesoUnitKg: s.pesoUnitKg,
      pesoOrigem: s.pesoOrigem ?? null,
    })),
    quantidades: mapa,
    pesosInformados: mapaPesos,
    // A confirmação é um ato humano na tela; o servidor não tem como verificá-la
    // e não é dele essa guarda. Aqui o que se exige é o peso EXISTIR.
    confirmados: new Set(saldo.map((s) => s.produtoCodigo)),
  });

  if (avaliacao.faltando.length > 0) {
    const faltando = avaliacao.faltando
      .map((f) => f.nomeProduto || f.produtoCodigo)
      .join(', ');
    throw new TransicaoError(
      422,
      'peso_pendente',
      `Falta o peso de: ${faltando}. Informe o peso desses produtos para agendar.`,
    );
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
        // O peso que valeu na decisão — é ele que vai congelado na viagem.
        pesoUnitKg: avaliacao.pesosFinais.get(codigo) ?? null,
      };
    });

  // Depois da checagem acima toda linha tem peso; o null aqui seria um furo na
  // regra, não um caso de operação — por isso a mensagem é genérica. O peso não
  // alimenta mais trava nenhuma (ver validarCargaDoAgendamento), mas continua
  // exigido: item sem peso entra na agenda pesando ZERO e faz o caminhão
  // aparecer mais vazio do que está, justamente na barra que a equipe usa para
  // decidir se manda a carga.
  if (linhas.some((l) => l.pesoUnitKg === null)) {
    throw new TransicaoError(
      422,
      'peso_pendente',
      'Falta o peso de algum produto desta viagem.',
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

  // 4) Travas de slot: reserva, teto de entregas do dia e os pares
  //    motorista/caminhão. A tonelagem NÃO está mais aqui — virou sinal.
  await carregarCaminhao(caminhaoId); // 422 se inválido/inativo
  await validarCargaDoAgendamento({
    data: dataAgendada,
    periodo,
    motoristaId,
    caminhaoId,
  });

  // 5) Guarda o peso digitado NO CADASTRO, para sugerir no próximo pedido.
  // Depois de todas as validações: se a viagem vai ser recusada, o cadastro não
  // se mexe. Se der erro aqui, o agendamento não acontece — o peso é parte da
  // mesma decisão, não um efeito colateral dela.
  const novosPesos = [...mapaPesos]
    .filter(
      ([codigo, kg]) =>
        Number.isFinite(kg) && kg > 0 && (mapa.get(codigo) ?? 0) > 0,
    )
    .map(([codigo, kg]) => ({
      produtoCodigo: codigo,
      nomeProduto:
        saldo.find((s) => s.produtoCodigo === codigo)?.nomeProduto ?? null,
      pesoKg: kg,
    }));
  await gravarPesosManuais(novosPesos, atorUserId ?? null);

  // 6) Grava a entrega e seus itens.
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
      // O congelamento (0019): esta viagem carrega o peso do dia dela.
      peso_unit_kg: l.pesoUnitKg,
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

  // 7) Auditoria + WhatsApp de agendamento.
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
// Reagendamento
// ---------------------------------------------------------------------------

export interface ReagendarEntregaArgs {
  entregaId: string;
  dataAgendada?: string;
  periodo?: PeriodoEntrega;
  motoristaId?: string;
  caminhaoId?: string;
  /** Registrado na auditoria e no histórico da viagem. */
  motivo?: string;
  /** Reenvia o template de agendamento ao cliente. Só quando a DATA mudou. */
  avisarCliente?: boolean;
  atorUserId?: string;
}

/**
 * Muda data, período, motorista ou caminhão de uma viagem JÁ AGENDADA.
 *
 * Pedido da Natália, textual: "na etapa agendamento ter a opção de reagendar a
 * data sem voltar o Card, pois a separação já está pronta (independente se está
 * separado ou não)". Antes disto, remarcar exigia desfazer o agendamento e
 * criar outro — e a separação conferida ia junto.
 *
 * O QUE NÃO MUDA AQUI, de propósito:
 *
 *   - quantidades e itens. Mudar o que vai no caminhão é outra viagem, não a
 *     mesma noutro dia.
 *   - `entrega_itens.peso_unit_kg` (o peso congelado da 0019). É a MESMA carga
 *     física, os mesmos sacos; só mudou o dia. Recongelar pelo cadastro atual
 *     faria a ocupação do slot antigo e a do novo discordarem.
 *   - `propriedade_codigo`. Trocar o destino muda o clima e o link do mapa: é
 *     agendamento novo.
 *   - as marcas de separação. Elas moram em `entrega_itens` e este UPDATE toca
 *     SÓ a tabela `entregas` — a separação sobrevive por construção. Não
 *     reaproveite o insert de itens do criarEntrega aqui: seria exatamente o
 *     jeito de perder o que ela pediu para preservar.
 *
 * Só vale em 'agendada'. Em 'em_rota' o caminhão está na estrada, e reagendar
 * criaria viagem com data anterior ao próprio despacho; o caminho é reverter
 * para agendada primeiro.
 */
export async function reagendarEntrega(
  args: ReagendarEntregaArgs,
): Promise<Entrega> {
  const {
    entregaId,
    dataAgendada,
    periodo,
    motoristaId,
    caminhaoId,
    motivo,
    avisarCliente = false,
    atorUserId,
  } = args;

  const entrega = await carregarEntrega(entregaId);

  if (entrega.status !== 'agendada') {
    const rotulo = ROTULO_STATUS_ENTREGA[entrega.status];
    throw new TransicaoError(
      409,
      'reagendamento_invalido',
      entrega.status === 'em_rota'
        ? 'Esta viagem já saiu. Volte-a para agendada antes de mudar a data.'
        : `Esta viagem está ${rotulo.toLowerCase()} e não pode ser reagendada. Agende uma nova entrega pelo pedido.`,
    );
  }

  const novaData = dataAgendada ?? entrega.dataAgendada;
  const novoPeriodo = periodo ?? entrega.periodo;
  const novoMotorista = motoristaId ?? entrega.motoristaId;
  const novoCaminhao = caminhaoId ?? entrega.caminhaoId;

  // Viagem antiga sem slot completo não tem como ser revalidada: a trava de
  // carga precisa dos quatro. Melhor recusar com o motivo do que agendar às
  // cegas por cima de outro caminhão.
  if (!novoPeriodo || !novoMotorista || !novoCaminhao) {
    throw new TransicaoError(
      422,
      'agendamento_incompleto',
      'Informe período, motorista e caminhão para reagendar esta viagem.',
    );
  }

  // O peso desta viagem NÃO é exigido nem revalidado aqui. Ele está congelado
  // desde a criação (migração 0019) e, desde 27/08/2026, não recusa agendamento
  // nenhum. Exigi-lo no reagendamento só criava atrito para viagem legada
  // anterior à 0019: recusava mudar de DIA uma carga que já saiu do galpão.
  // Viagem sem peso reagenda e continua aparecendo como "peso pendente" na
  // agenda, que é onde isso precisa ser visto.

  // `entregaId` aqui é o que faz a viagem não competir consigo mesma pela
  // ocupação do slot — sem ele, trocar só o motorista no mesmo slot faria a
  // própria carga contar duas vezes.
  await validarCargaDoAgendamento({
    entregaId,
    data: novaData,
    periodo: novoPeriodo,
    motoristaId: novoMotorista,
    caminhaoId: novoCaminhao,
  });

  const mudouData =
    novaData !== entrega.dataAgendada || novoPeriodo !== entrega.periodo;

  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = {
    data_agendada: novaData,
    periodo: novoPeriodo,
    motorista_id: novoMotorista,
    caminhao_id: novoCaminhao,
    atualizado_em: agora,
    observacoes: historicoReagendamento(entrega, {
      novaData,
      novoPeriodo,
      motivo,
    }),
  };

  const { error } = await supabase
    .from('entregas')
    .update(patch)
    .eq('id', entregaId);
  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao reagendar a entrega: ${error.message}`,
    );
  }

  // A auditoria registra o ATO, não o antes/depois: `eventos_status` não tem
  // coluna de detalhe, e um 'agendada' -> 'agendada' carimba quem e quando. O
  // "de 12/08 manhã para 14/08 tarde" fica no histórico em observacoes, que a
  // tela mostra. Relatório de reagendamentos exigiria uma coluna nova.
  await registrarEvento({
    pedidoId: entrega.pedidoId,
    entregaId,
    de: 'agendada',
    para: 'agendada',
    atorUserId,
  });

  const atualizada = await carregarEntrega(entregaId);

  // Silencioso por padrão: trocar o caminhão sem mexer na data é ajuste interno
  // e não justifica uma segunda mensagem ao cliente. Quem decide é a tela.
  if (avisarCliente && mudouData) {
    await dispararWhatsappEntrega(atualizada, 'agendamento');
  }

  return atualizada;
}

/** Linha de histórico do reagendamento, anexada a `entregas.observacoes`. */
function historicoReagendamento(
  entrega: Entrega,
  novo: { novaData: string; novoPeriodo: PeriodoEntrega; motivo?: string },
): string {
  const antes = descreverSlot(entrega.dataAgendada, entrega.periodo);
  const depois = descreverSlot(novo.novaData, novo.novoPeriodo);
  const razao = novo.motivo?.trim() ? ` — ${novo.motivo.trim()}` : '';
  const linha = `[${dataHoraCurta()}] Reagendada de ${antes} para ${depois}${razao}`;
  const anterior = entrega.observacoes?.trim();
  return anterior ? `${anterior}\n${linha}` : linha;
}

function descreverSlot(data: string, periodo: PeriodoEntrega | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  const dia = m ? `${m[3]}/${m[2]}` : data;
  if (!periodo) return dia;
  return `${dia} ${periodo === 'manha' ? 'manhã' : 'tarde'}`;
}

function dataHoraCurta(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi}`;
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
  /**
   * Só em para==='entregue' (0025): produto_codigo -> quanto o cliente recebeu.
   * Ausente = comportamento de antes (vale o carregado, nada é gravado).
   */
  entregues?: Record<string, number>;
  /**
   * Havendo diferença: true = o cliente NÃO quer o restante (vira um card de
   * não realizado que encerra o saldo); false/ausente = o restante volta para o
   * pedido e é agendado de novo.
   */
  restanteRecusado?: boolean;
  /** Motivo do card do restante recusado; default 'Cliente recusou o restante'. */
  motivoRecusa?: string;
  atorUserId?: string;
  atorPapel?: AtorPapel;
}

/** Motivo semeado pela 0025 para o card do restante recusado. */
export const MOTIVO_RESTANTE_RECUSADO = 'Cliente recusou o restante';

export async function transicionarEntrega(
  args: TransicionarEntregaArgs,
): Promise<Entrega> {
  const {
    entregaId,
    para,
    observacao,
    motivo,
    entregues,
    restanteRecusado,
    motivoRecusa,
    atorUserId,
    atorPapel,
  } = args;

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

  // Entrega parcial declarada (0025). Toda a validação vem ANTES de qualquer
  // escrita: a regra pura recusa quantidade maior que a carregada, negativa ou
  // de produto que não está na viagem.
  if (entregues !== undefined && para !== 'entregue') {
    throw new TransicaoError(
      400,
      'body_invalido',
      'Quantidade entregue só se informa ao marcar a entrega como entregue.',
    );
  }
  const conclusao =
    entregues !== undefined ? avaliarConclusao(entrega.itens, entregues) : null;
  if (conclusao && conclusao.erros.length > 0) {
    throw new TransicaoError(
      422,
      'quantidade_invalida',
      conclusao.erros.map((e) => e.mensagem).join(' '),
    );
  }
  const recusaRestante =
    conclusao !== null && conclusao.divergiu && restanteRecusado === true;
  const motivoDaRecusa = motivoRecusa?.trim() || MOTIVO_RESTANTE_RECUSADO;
  if (recusaRestante) await exigirMotivoCadastrado(motivoDaRecusa);

  // A ordem das escritas é a defesa, já que o PostgREST não dá transação:
  //   1) qtd_entregue nos itens — inofensivo enquanto a viagem está em rota,
  //      porque em_rota consome o carregado de qualquer jeito (qtdConsumida);
  //   2) o status;
  //   3) o card do restante recusado.
  // Falhar entre 2 e 3 deixa o restante de volta na fila (como se o cliente
  // quisesse), nunca consumido em dobro.
  if (conclusao) {
    await gravarQuantidadesEntregues(entrega, conclusao.entregues);
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

  if (recusaRestante && conclusao) {
    await criarRestanteRecusado({
      origem: entrega,
      restante: conclusao.restante,
      motivo: motivoDaRecusa,
      atorUserId,
    });
  }

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

/**
 * Reverte a entrega uma etapa. Nunca manda WhatsApp.
 *
 *   em_rota       -> agendada  (despacho feito por engano)
 *   entregue      -> em_rota   (conclusão marcada por engano)
 *   nao_realizado -> em_rota   (idem — reunião de 24/09/2026)
 *
 * Voltar não é só trocar o status. O desfecho deixou rastro na linha, e rastro
 * velho numa viagem que voltou para a estrada mente na tela: a data de entrega
 * carimbada num card em rota, ou o bloco "Motivo da não entrega" em cima de uma
 * viagem que ainda vai acontecer. Então cada origem limpa o que ela escreveu.
 *
 * Desfazer um nao_realizado VOLTA A CONSUMIR SALDO — e o fluxo normal, depois de
 * uma não entrega, é justamente reagendar esse saldo noutra viagem. Sem conferir,
 * desfazer deixaria o pedido com mais mercadoria comprometida do que vendida, em
 * silêncio. Recusamos e dizemos qual viagem está no caminho.
 */
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

  if (entrega.encerraSaldo) {
    throw new TransicaoError(
      409,
      'reversao_invalida',
      'Este card é o restante recusado de outra viagem. Para desfazer, use ' +
        '"Voltar" na viagem de origem — a recusa é cancelada junto.',
    );
  }

  if (de === 'nao_realizado') {
    await exigirSaldoParaReverter(entrega);
  }

  const patch: Record<string, unknown> = {
    status: para,
    atualizado_em: new Date().toISOString(),
  };
  // `observacoes` fica: além da nota da conclusão, ela guarda o histórico de
  // reagendamento ("de 12/08 manhã para 14/08 tarde"), e apagar isso para
  // desfazer um clique seria perder informação que não tem outra cópia.
  if (de === 'entregue') patch.data_entregue = null;
  if (de === 'nao_realizado') patch.motivo_nao_entrega = null;

  const { error } = await supabase
    .from('entregas')
    .update(patch)
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

  // Desfazer a conclusão desfaz a declaração inteira: as quantidades (senão a
  // tag amarela continua acesa numa viagem em rota) e o card do restante
  // recusado, que só existia por causa dela.
  if (de === 'entregue') {
    await desfazerDeclaracaoDaConclusao(entrega, atorUserId);
  }

  await sincronizarStatusDoPedido(entrega.pedidoId);
  return carregarEntrega(entregaId);
}

/** Grava a quantidade entregue de cada item (0025). */
async function gravarQuantidadesEntregues(
  entrega: Entrega,
  entregues: Record<string, number>,
): Promise<void> {
  const resultados = await Promise.all(
    entrega.itens.map((item) =>
      supabase
        .from('entrega_itens')
        .update({ qtd_entregue: entregues[item.produtoCodigo] ?? item.qtd })
        .eq('id', item.id),
    ),
  );
  const falha = resultados.find((r) => r.error);
  if (falha?.error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao gravar as quantidades entregues: ${falha.error.message}`,
    );
  }
}

/**
 * Cria o card do RESTANTE RECUSADO: o "duplico o card" da Natália.
 *
 * É um nao_realizado com encerra_saldo — o cliente disse que não quer mais, então
 * a mercadoria NÃO volta para a fila (ver `qtdConsumida`). Herda o dia, o período,
 * o motorista e o caminhão da viagem de origem: foi ali que a recusa aconteceu.
 *
 * Criado aqui dentro, com a chave de serviço, e não por POST /entregas: aquela
 * rota exige a logística, e o motorista que conclui a entrega na estrada tomaria
 * 403. A exceção dele em api/auth.ts cobre /transicao, que é por onde isto passa.
 */
async function criarRestanteRecusado(args: {
  origem: Entrega;
  restante: { produtoCodigo: string; nomeProduto: string; qtd: number }[];
  motivo: string;
  atorUserId?: string;
}): Promise<void> {
  const { origem, restante, motivo, atorUserId } = args;
  const falhou = (detalhe: string): never => {
    log.error(
      `[entregas] Restante recusado da entrega ${origem.id} não foi gravado: ${detalhe}`,
    );
    throw new TransicaoError(
      500,
      'erro_banco',
      'A entrega foi concluída, mas o restante recusado não pôde ser registrado ' +
        'e voltou para o pedido como pendente. Descarte-o pelo quadro se o ' +
        `cliente não quer mesmo. (${detalhe})`,
    );
  };

  const { data: criada, error: errIns } = await supabase
    .from('entregas')
    .insert({
      pedido_id: origem.pedidoId,
      status: 'nao_realizado',
      data_agendada: origem.dataAgendada,
      periodo: origem.periodo,
      motorista_id: origem.motoristaId,
      caminhao_id: origem.caminhaoId,
      propriedade_codigo: origem.propriedadeCodigo,
      motivo_nao_entrega: motivo,
      encerra_saldo: true,
      origem_entrega_id: origem.id,
    })
    .select('id')
    .single<{ id: string }>();
  if (errIns || !criada) return falhou(errIns?.message ?? 'sem retorno');

  const pesoPorProduto = new Map(
    origem.itens.map((i) => [i.produtoCodigo, i.pesoUnitKg]),
  );
  const { error: errItens } = await supabase.from('entrega_itens').insert(
    restante.map((r) => ({
      entrega_id: criada.id,
      produto_codigo: r.produtoCodigo,
      nome_produto: r.nomeProduto,
      qtd: r.qtd,
      peso_unit_kg: pesoPorProduto.get(r.produtoCodigo) ?? null,
    })),
  );
  if (errItens) {
    // Sem itens, o card não encerraria saldo nenhum — é lixo. Desfaz.
    await supabase.from('entregas').delete().eq('id', criada.id);
    return falhou(errItens.message);
  }

  await registrarEvento({
    pedidoId: origem.pedidoId,
    entregaId: criada.id,
    de: null,
    para: 'nao_realizado',
    atorUserId,
  });
}

/**
 * Desfaz o que a conclusão declarou: zera as quantidades entregues e cancela o
 * card do restante recusado, se houver. Cancela em vez de apagar para o histórico
 * de eventos continuar contando o que aconteceu.
 */
async function desfazerDeclaracaoDaConclusao(
  entrega: Entrega,
  atorUserId?: string,
): Promise<void> {
  const { error: errItens } = await supabase
    .from('entrega_itens')
    .update({ qtd_entregue: null })
    .eq('entrega_id', entrega.id);
  if (errItens) {
    log.error(
      `[entregas] Falha ao limpar as quantidades entregues de ${entrega.id}: ${errItens.message}`,
    );
  }

  const { data: irmas, error: errIrmas } = await supabase
    .from('entregas')
    .update({ status: 'cancelada', atualizado_em: new Date().toISOString() })
    .eq('origem_entrega_id', entrega.id)
    .eq('encerra_saldo', true)
    .eq('status', 'nao_realizado')
    .select('id');
  if (errIrmas) {
    throw new TransicaoError(
      500,
      'erro_banco',
      'A viagem voltou para em rota, mas o card do restante recusado não foi ' +
        `cancelado: ${errIrmas.message}`,
    );
  }
  for (const irma of (irmas ?? []) as { id: string }[]) {
    await registrarEvento({
      pedidoId: entrega.pedidoId,
      entregaId: irma.id,
      de: 'nao_realizado',
      para: 'cancelada',
      atorUserId,
    });
  }
}

/**
 * Recusa desfazer um nao_realizado se a mercadoria dele já foi comprometida de
 * novo. A entrega em nao_realizado não consome saldo, então o saldo de agora é
 * exatamente o que sobra para ela voltar a ocupar.
 */
async function exigirSaldoParaReverter(entrega: Entrega): Promise<void> {
  const saldo = await saldoDoPedido(entrega.pedidoId);
  const porProduto = new Map(saldo.map((s) => [s.produtoCodigo, s.qtdSaldo]));

  const faltando = entrega.itens.filter((item) => {
    const livre = porProduto.get(item.produtoCodigo) ?? 0;
    // Tolerância de arredondamento: o saldo é somado na 3ª casa.
    return item.qtd - livre > 0.0005;
  });
  if (faltando.length === 0) return;

  const nomes = faltando
    .map((i) => i.nomeProduto || i.produtoCodigo)
    .join(', ');
  throw new TransicaoError(
    409,
    'saldo_insuficiente',
    `Não dá para desfazer: ${nomes} já foi reagendado em outra viagem. ` +
      'Cancele a viagem nova primeiro.',
  );
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

// ---------------------------------------------------------------------------
// Ordem das paradas (a "próxima entrega" do motorista) — migração 0022
// ---------------------------------------------------------------------------

export interface DefinirProximaEntregaArgs {
  /** A entrega que o motorista aponta como a PRÓXIMA parada dele. */
  entregaId: string;
  /** uid de quem chamou (do token, nunca do corpo). */
  usuarioId: string | null;
  papel: PapelUsuario | null;
}

/**
 * Marca uma entrega como a próxima parada da rota do dia.
 *
 * Pedido da Natália, item 11: "informar qual será o próximo cliente/entrega após
 * a conclusão da entrega atual". Quem sabe é o motorista, que acabou de
 * descarregar e conhece a estrada — então é ele quem aponta, e a logística lê.
 *
 * A ordem é atribuída INCREMENTALMENTE: a próxima recebe `max + 1` entre as
 * paradas já sequenciadas do mesmo motorista no mesmo dia. Não renumeramos nada
 * e não pedimos a lista inteira de uma vez, por dois motivos:
 *
 *   1. o motorista está na estrada, muitas vezes com o caminhão carregado — a
 *      interação tem de ser um toque, não um formulário de ordenação;
 *   2. renumerar significaria reescrever paradas JÁ FEITAS quando ele mudasse de
 *      ideia no meio do dia, e o que já foi entregue não se reordena.
 *
 * As entregas já ENTREGUES contam no `max`: elas ocuparam posição na rota, e a
 * próxima tem de vir depois delas.
 *
 * Idempotente: se a entrega já tem ordem, devolve como está. Dois toques no
 * mesmo cartão não podem embaralhar a rota nem virar erro na cara de quem já
 * conseguiu o que queria.
 */
export async function definirProximaEntrega(
  args: DefinirProximaEntregaArgs,
): Promise<Entrega> {
  const { entregaId, usuarioId, papel } = args;

  const { data: linha, error } = await supabase
    .from('entregas')
    .select('id, status, data_agendada, motorista_id, ordem_rota')
    .eq('id', entregaId)
    .maybeSingle<{
      id: string;
      status: StatusEntrega;
      data_agendada: string;
      motorista_id: string | null;
      ordem_rota: number | string | null;
    }>();

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao carregar a entrega: ${error.message}`,
    );
  }
  if (!linha) {
    throw new TransicaoError(404, 'nao_encontrado', 'Entrega não encontrada.');
  }

  // O motorista só sequencia as PRÓPRIAS viagens. Mesma garantia de
  // transicionarEntrega: o dono vem do token, nunca do corpo da requisição.
  if (papel === 'motorista' && linha.motorista_id !== usuarioId) {
    throw new TransicaoError(403, 'sem_permissao', 'Esta viagem não é sua.');
  }

  if (linha.status !== 'agendada' && linha.status !== 'em_rota') {
    throw new TransicaoError(
      409,
      'ordem_invalida',
      `Só uma viagem agendada ou em rota pode ser a próxima parada; esta está ${ROTULO_STATUS_ENTREGA[linha.status].toLowerCase()}.`,
    );
  }

  if (!linha.motorista_id) {
    throw new TransicaoError(
      422,
      'sem_motorista',
      'Esta viagem ainda não tem motorista, então não há rota para ordenar.',
    );
  }

  const jaTem = ordemOuNulo(linha.ordem_rota);
  if (jaTem !== null) return carregarEntrega(entregaId);

  const { data: doDia, error: erroDia } = await supabase
    .from('entregas')
    .select('ordem_rota')
    .eq('motorista_id', linha.motorista_id)
    .eq('data_agendada', linha.data_agendada)
    .in('status', ['agendada', 'em_rota', 'entregue']);

  if (erroDia) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao ler a ordem das paradas do dia: ${erroDia.message}`,
    );
  }

  let maior = 0;
  for (const l of doDia ?? []) {
    const ordem = ordemOuNulo(l.ordem_rota as number | string | null);
    if (ordem !== null && ordem > maior) maior = ordem;
  }

  const { error: erroUpdate } = await supabase
    .from('entregas')
    .update({ ordem_rota: maior + 1, atualizado_em: new Date().toISOString() })
    .eq('id', entregaId);

  if (erroUpdate) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao gravar a ordem da parada: ${erroUpdate.message}`,
    );
  }

  return carregarEntrega(entregaId);
}

// ---------------------------------------------------------------------------
// Reordenar as paradas pela agenda — reunião de 24/09/2026
// ---------------------------------------------------------------------------

export interface ReordenarParadasArgs {
  motoristaId: string;
  /** Dia da rota (YYYY-MM-DD). */
  data: string;
  /** As paradas arrastadas, na ordem nova. As demais do dia ficam onde estão. */
  ordem: string[];
}

/**
 * A logística reordena as paradas arrastando os cards na agenda: "arrastar os
 * cards aqui e colocar na ordem que o motorista vai fazer aqueles clientes".
 *
 * Diferente de `definirProximaEntrega` (o motorista, incremental, na estrada),
 * aqui a lista vem inteira e o dia é renumerado — a regra de onde cada parada
 * cai mora em `reordenarSubconjunto`. Só grava as linhas que mudaram.
 *
 * Só viagens agendadas ou em rota podem ser arrastadas: as entregues já
 * aconteceram, e as outras não estão na rota.
 */
export async function reordenarParadas(
  args: ReordenarParadasArgs,
): Promise<{ id: string; ordemRota: number }[]> {
  const { motoristaId, data, ordem } = args;

  const { data: linhas, error } = await supabase
    .from('entregas')
    .select('id, status, ordem_rota, periodo, pedidos(cliente_nome)')
    .eq('motorista_id', motoristaId)
    .eq('data_agendada', data)
    .in('status', ['agendada', 'em_rota', 'entregue']);
  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao ler as paradas do dia: ${error.message}`,
    );
  }

  const paradas = ((linhas ?? []) as unknown as {
    id: string;
    status: StatusEntrega;
    ordem_rota: number | string | null;
    periodo: PeriodoEntrega | null;
    pedidos: { cliente_nome: string | null } | null;
  }[]).map((l) => ({
    id: l.id,
    status: l.status,
    ordemRota: ordemOuNulo(l.ordem_rota),
    periodo: l.periodo,
    clienteNome: l.pedidos?.cliente_nome ?? '',
  }));

  const concluidas = new Set(
    paradas.filter((p) => p.status === 'entregue').map((p) => p.id),
  );
  if (ordem.some((id) => concluidas.has(id))) {
    throw new TransicaoError(
      409,
      'ordem_invalida',
      'Uma parada já entregue não pode mudar de lugar na rota.',
    );
  }

  const r = reordenarSubconjunto(paradas, ordem);
  if (r.erros.length > 0) {
    throw new TransicaoError(409, 'ordem_invalida', r.erros.join(' '));
  }

  const mudaram = paradas.filter((p) => r.ordem.get(p.id) !== p.ordemRota);
  const agora = new Date().toISOString();
  const resultados = await Promise.all(
    mudaram.map((p) =>
      supabase
        .from('entregas')
        .update({ ordem_rota: r.ordem.get(p.id), atualizado_em: agora })
        .eq('id', p.id),
    ),
  );
  const falha = resultados.find((x) => x.error);
  if (falha?.error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao gravar a ordem das paradas: ${falha.error.message}`,
    );
  }

  return [...r.ordem.entries()].map(([id, ordemRota]) => ({ id, ordemRota }));
}
