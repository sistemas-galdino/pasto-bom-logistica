// [AGENTE API] Reservas de caminhão — o "card avulso" pedido pelo Johnny.
//
// O QUE É
// ---------------------------------------------------------------------------
// Uma reserva OCUPA um caminhão num slot (data + período) sem que exista pedido:
// oficina, buscar adubo na fábrica, "reservar o caminhão para fazer outra
// coisa". Nas palavras dele: "a única coisa que bloqueia a gente de agendar é o
// caminhão. Se eu esquecer, pode ser que eu deixe essas agendas vagas e uma hora
// eu esqueço de agendar algum cliente porque não tem cliente para agendar e a
// gente perde, tem que refazer o agendamento."
//
// Então o propósito da reserva NÃO é registrar um serviço: é fazer o dia parecer
// o que ele é. Se a agenda mostra a manhã livre quando o caminhão está na
// oficina, alguém promete uma entrega que depois tem de ser desfeita.
//
// ONDE ELA ENCONTRA A ENTREGA
// ---------------------------------------------------------------------------
// Num lugar só: `validarCargaDoAgendamento` (services/carga.ts). Reserva e
// entrega são tabelas separadas de propósito (ver o cabeçalho da migração 0021),
// e a única coisa que compartilham é a disputa pelo caminhão. Por isso este
// serviço não reimplementa trava nenhuma — ele chama a mesma função que o
// agendamento de cliente chama, com `alvo: 'reserva'`.
//
// A reserva NÃO consome a cota de entregas/dia da 0020 (decisão do David,
// 24/08/2026): o teto é de entregas a cliente.

import type { PeriodoEntrega, Reserva, StatusReserva } from '@pastobom/shared';

import { supabase } from '../db/supabase.js';
import { log } from '../log.js';
import { validarCargaDoAgendamento } from './carga.js';
import { TransicaoError } from './erros.js';

// ---------------------------------------------------------------------------
// Linha do banco e mapeamento
// ---------------------------------------------------------------------------

// String literal única de propósito: concatenar degrada o tipo de retorno do
// supabase-js para GenericStringError[] e a linha vira `never`.
const COLUNAS_RESERVA =
  'id, status, servico, fornecedor_codigo, cidade, produtos, data_agendada, periodo, caminhao_id, motorista_id, peso_previsto_kg, bloqueia_caminhao, observacoes, criado_em';

interface ReservaRow {
  id: string;
  status: StatusReserva;
  servico: string;
  fornecedor_codigo: string | null;
  cidade: string | null;
  produtos: string | null;
  data_agendada: string;
  periodo: PeriodoEntrega;
  caminhao_id: string;
  motorista_id: string | null;
  peso_previsto_kg: number | string | null;
  bloqueia_caminhao: boolean;
  observacoes: string | null;
  criado_em: string;
}

/** Nomes resolvidos em lote (nenhuma das três é FK que o select traga junto). */
interface NomesResolvidos {
  caminhoes: Map<string, string>;
  motoristas: Map<string, string>;
  fornecedores: Map<string, string>;
}

const SEM_NOMES: NomesResolvidos = {
  caminhoes: new Map(),
  motoristas: new Map(),
  fornecedores: new Map(),
};

function numeroOuNulo(v: number | string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapearReserva(row: ReservaRow, nomes: NomesResolvidos): Reserva {
  return {
    id: row.id,
    status: row.status,
    servico: row.servico,
    fornecedorCodigo: row.fornecedor_codigo,
    fornecedorNome: row.fornecedor_codigo
      ? (nomes.fornecedores.get(row.fornecedor_codigo) ?? null)
      : null,
    cidade: row.cidade,
    produtos: row.produtos,
    dataAgendada: row.data_agendada,
    periodo: row.periodo,
    caminhaoId: row.caminhao_id,
    caminhaoNome: nomes.caminhoes.get(row.caminhao_id) ?? null,
    motoristaId: row.motorista_id,
    motoristaNome: row.motorista_id
      ? (nomes.motoristas.get(row.motorista_id) ?? null)
      : null,
    pesoPrevistoKg: numeroOuNulo(row.peso_previsto_kg),
    bloqueiaCaminhao: row.bloqueia_caminhao === true,
    observacoes: row.observacoes,
    criadoEm: row.criado_em,
  };
}

/**
 * Resolve caminhão, motorista e fornecedor em três consultas, não em 3×N.
 *
 * Falha de qualquer uma degrada para nome nulo em vez de derrubar a listagem: o
 * card ainda diz o serviço, a data e o caminhão pelo id — perder o rótulo é
 * ruim, perder a reserva é pior.
 */
async function resolverNomes(rows: ReservaRow[]): Promise<NomesResolvidos> {
  if (rows.length === 0) return SEM_NOMES;

  const idsCaminhao = [...new Set(rows.map((r) => r.caminhao_id))];
  const idsMotorista = [
    ...new Set(
      rows
        .map((r) => r.motorista_id)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];
  const codigosFornecedor = [
    ...new Set(
      rows
        .map((r) => r.fornecedor_codigo)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];

  const [caminhoes, motoristas, fornecedores] = await Promise.all([
    lerNomes('caminhoes', 'id', idsCaminhao),
    lerNomes('profiles', 'id', idsMotorista),
    lerNomes('fornecedores', 'codigo', codigosFornecedor),
  ]);

  return { caminhoes, motoristas, fornecedores };
}

async function lerNomes(
  tabela: 'caminhoes' | 'profiles' | 'fornecedores',
  coluna: 'id' | 'codigo',
  chaves: string[],
): Promise<Map<string, string>> {
  if (chaves.length === 0) return new Map();

  const { data, error } = await supabase
    .from(tabela)
    .select(coluna === 'id' ? 'id, nome' : 'codigo, nome')
    .in(coluna, chaves);

  if (error) {
    log.warn(
      `[reservas] Falha ao resolver nomes em ${tabela}: ${error.message}`,
    );
    return new Map();
  }

  const mapa = new Map<string, string>();
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const chave = r[coluna];
    if (typeof chave !== 'string') continue;
    mapa.set(chave, ((r.nome as string | null) ?? '').trim());
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface FiltroReservas {
  /** Data ISO inicial (inclusive). */
  de?: string;
  /** Data ISO final (inclusive). */
  ate?: string;
  caminhaoId?: string;
  motoristaId?: string;
  /** Ausente = só as ativas (o que ocupa caminhão hoje). */
  status?: StatusReserva;
}

export async function listarReservas(
  filtro: FiltroReservas = {},
): Promise<Reserva[]> {
  let q = supabase
    .from('reservas')
    .select(COLUNAS_RESERVA)
    .eq('status', filtro.status ?? 'ativa');

  if (filtro.de) q = q.gte('data_agendada', filtro.de);
  if (filtro.ate) q = q.lte('data_agendada', filtro.ate);
  if (filtro.caminhaoId) q = q.eq('caminhao_id', filtro.caminhaoId);
  if (filtro.motoristaId) q = q.eq('motorista_id', filtro.motoristaId);

  const { data, error } = await q
    .order('data_agendada', { ascending: true })
    .order('periodo', { ascending: true });

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao listar as reservas: ${error.message}`,
    );
  }

  const rows = (data ?? []) as unknown as ReservaRow[];
  const nomes = await resolverNomes(rows);
  return rows.map((r) => mapearReserva(r, nomes));
}

/** Uma reserva pelo id, com os nomes resolvidos. 404 fica com a rota. */
export async function carregarReserva(id: string): Promise<Reserva | null> {
  const { data, error } = await supabase
    .from('reservas')
    .select(COLUNAS_RESERVA)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao carregar a reserva: ${error.message}`,
    );
  }
  if (!data) return null;

  const row = data as unknown as ReservaRow;
  const nomes = await resolverNomes([row]);
  return mapearReserva(row, nomes);
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export interface CriarReservaArgs {
  servico: string;
  dataAgendada: string;
  periodo: PeriodoEntrega;
  caminhaoId: string;
  motoristaId?: string | null;
  fornecedorCodigo?: string | null;
  cidade?: string | null;
  produtos?: string | null;
  pesoPrevistoKg?: number | null;
  bloqueiaCaminhao?: boolean;
  observacoes?: string | null;
  usuarioId: string | null;
}

/**
 * Cria a reserva depois de passar pelas MESMAS travas do agendamento de cliente.
 *
 * A cidade é resolvida aqui e gravada em texto mesmo quando vem fornecedor: se o
 * cadastro do Órix mudar amanhã, a reserva de ontem não pode se reescrever
 * (mesmo princípio do peso congelado da 0019). Quando a pessoa escolhe o
 * fornecedor e não digita cidade, herdamos a do cadastro — é justamente o atalho
 * que a Natália pediu ("puxar o fornecedor já traz a cidade").
 */
export async function criarReserva(args: CriarReservaArgs): Promise<Reserva> {
  const bloqueiaCaminhao = args.bloqueiaCaminhao ?? true;
  const cidade = await resolverCidade(args.fornecedorCodigo, args.cidade);

  await validarCargaDoAgendamento({
    alvo: 'reserva',
    data: args.dataAgendada,
    periodo: args.periodo,
    motoristaId: args.motoristaId ?? null,
    caminhaoId: args.caminhaoId,
    pesoDaCargaKg: args.pesoPrevistoKg ?? 0,
    exigeExclusividade: bloqueiaCaminhao,
  });

  const { data, error } = await supabase
    .from('reservas')
    .insert({
      servico: args.servico,
      data_agendada: args.dataAgendada,
      periodo: args.periodo,
      caminhao_id: args.caminhaoId,
      motorista_id: args.motoristaId ?? null,
      fornecedor_codigo: args.fornecedorCodigo ?? null,
      cidade,
      produtos: args.produtos ?? null,
      peso_previsto_kg: args.pesoPrevistoKg ?? null,
      bloqueia_caminhao: bloqueiaCaminhao,
      observacoes: args.observacoes ?? null,
      criado_por: args.usuarioId,
    })
    .select(COLUNAS_RESERVA)
    .single();

  if (error || !data) {
    const mensagem = error?.message ?? 'Falha ao criar a reserva.';
    throw new TransicaoError(500, 'erro_banco', mensagem);
  }

  const row = data as unknown as ReservaRow;
  const nomes = await resolverNomes([row]);
  return mapearReserva(row, nomes);
}

export type AtualizarReservaArgs = Partial<Omit<CriarReservaArgs, 'usuarioId'>>;

/**
 * Atualiza a reserva revalidando o slot RESULTANTE, não o que veio no corpo.
 *
 * Por isso a linha atual é lida antes: trocar só o período tem de ser checado
 * com o caminhão e o peso que já estavam gravados, senão a trava avalia um slot
 * que não existe. E `reservaId` vai para a validação para a reserva não competir
 * consigo mesma — mesmo motivo do `entregaId` no reagendamento da Onda B.
 *
 * Reserva cancelada não se edita: o caminho é criar outra. Editar uma cancelada
 * ressuscitaria a ocupação sem passar por trava nenhuma de status.
 */
export async function atualizarReserva(
  id: string,
  patch: AtualizarReservaArgs,
): Promise<Reserva> {
  const atual = await lerLinha(id);
  if (atual.status !== 'ativa') {
    throw new TransicaoError(
      409,
      'reserva_cancelada',
      'Esta reserva está cancelada. Crie uma nova em vez de editá-la.',
    );
  }

  const dataAgendada = patch.dataAgendada ?? atual.data_agendada;
  const periodo = patch.periodo ?? atual.periodo;
  const caminhaoId = patch.caminhaoId ?? atual.caminhao_id;
  const motoristaId =
    patch.motoristaId !== undefined ? patch.motoristaId : atual.motorista_id;
  const pesoPrevistoKg =
    patch.pesoPrevistoKg !== undefined
      ? patch.pesoPrevistoKg
      : numeroOuNulo(atual.peso_previsto_kg);
  const bloqueiaCaminhao =
    patch.bloqueiaCaminhao !== undefined
      ? patch.bloqueiaCaminhao
      : atual.bloqueia_caminhao === true;

  await validarCargaDoAgendamento({
    alvo: 'reserva',
    reservaId: id,
    data: dataAgendada,
    periodo,
    motoristaId: motoristaId ?? null,
    caminhaoId,
    pesoDaCargaKg: pesoPrevistoKg ?? 0,
    exigeExclusividade: bloqueiaCaminhao,
  });

  const alteracoes: Record<string, unknown> = {
    atualizado_em: new Date().toISOString(),
  };
  if (patch.servico !== undefined) alteracoes.servico = patch.servico;
  if (patch.dataAgendada !== undefined) alteracoes.data_agendada = dataAgendada;
  if (patch.periodo !== undefined) alteracoes.periodo = periodo;
  if (patch.caminhaoId !== undefined) alteracoes.caminhao_id = caminhaoId;
  if (patch.motoristaId !== undefined) alteracoes.motorista_id = motoristaId;
  if (patch.produtos !== undefined) alteracoes.produtos = patch.produtos;
  if (patch.observacoes !== undefined)
    alteracoes.observacoes = patch.observacoes;
  if (patch.pesoPrevistoKg !== undefined) {
    alteracoes.peso_previsto_kg = pesoPrevistoKg;
  }
  if (patch.bloqueiaCaminhao !== undefined) {
    alteracoes.bloqueia_caminhao = bloqueiaCaminhao;
  }
  // Fornecedor e cidade andam juntos: trocar o fornecedor sem reavaliar a cidade
  // deixaria o card apontando para a cidade do fornecedor antigo.
  if (patch.fornecedorCodigo !== undefined || patch.cidade !== undefined) {
    const fornecedorCodigo =
      patch.fornecedorCodigo !== undefined
        ? patch.fornecedorCodigo
        : atual.fornecedor_codigo;
    alteracoes.fornecedor_codigo = fornecedorCodigo;
    alteracoes.cidade = await resolverCidade(
      fornecedorCodigo,
      patch.cidade !== undefined ? patch.cidade : atual.cidade,
    );
  }

  const { data, error } = await supabase
    .from('reservas')
    .update(alteracoes)
    .eq('id', id)
    .select(COLUNAS_RESERVA)
    .single();

  if (error || !data) {
    const mensagem = error?.message ?? 'Falha ao atualizar a reserva.';
    throw new TransicaoError(500, 'erro_banco', mensagem);
  }

  const row = data as unknown as ReservaRow;
  const nomes = await resolverNomes([row]);
  return mapearReserva(row, nomes);
}

/**
 * Cancela a reserva. Não apaga: o projeto guarda histórico (mesma escolha de
 * `entregas.cancelada` e do caminhão que só é desativado). Cancelar já libera o
 * caminhão, porque a ocupação só conta reservas 'ativa'.
 */
export async function cancelarReserva(id: string): Promise<Reserva> {
  const atual = await lerLinha(id);
  if (atual.status === 'cancelada') {
    // Idempotente de propósito: dois cliques no botão não podem virar erro na
    // cara de quem já conseguiu o que queria.
    const nomes = await resolverNomes([atual]);
    return mapearReserva(atual, nomes);
  }

  const { data, error } = await supabase
    .from('reservas')
    .update({ status: 'cancelada', atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select(COLUNAS_RESERVA)
    .single();

  if (error || !data) {
    const mensagem = error?.message ?? 'Falha ao cancelar a reserva.';
    throw new TransicaoError(500, 'erro_banco', mensagem);
  }

  const row = data as unknown as ReservaRow;
  const nomes = await resolverNomes([row]);
  return mapearReserva(row, nomes);
}

async function lerLinha(id: string): Promise<ReservaRow> {
  const { data, error } = await supabase
    .from('reservas')
    .select(COLUNAS_RESERVA)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao carregar a reserva: ${error.message}`,
    );
  }
  if (!data) {
    throw new TransicaoError(404, 'nao_encontrado', 'Reserva não encontrada.');
  }
  return data as unknown as ReservaRow;
}

/**
 * Cidade a gravar: a digitada manda; sem ela, a do fornecedor.
 *
 * Falha de leitura do fornecedor não impede a reserva — ela só fica sem cidade.
 * Bloquear a reserva de oficina porque o espelho do Órix está fora do ar seria
 * trocar um dado acessório pela função principal.
 */
async function resolverCidade(
  fornecedorCodigo: string | null | undefined,
  cidade: string | null | undefined,
): Promise<string | null> {
  const digitada = cidade?.trim();
  if (digitada) return digitada;
  if (!fornecedorCodigo) return null;

  const { data, error } = await supabase
    .from('fornecedores')
    .select('cidade')
    .eq('codigo', fornecedorCodigo)
    .maybeSingle<{ cidade: string | null }>();

  if (error) {
    log.warn(
      `[reservas] Falha ao herdar a cidade do fornecedor ${fornecedorCodigo}: ${error.message}`,
    );
    return null;
  }
  return data?.cidade?.trim() || null;
}
