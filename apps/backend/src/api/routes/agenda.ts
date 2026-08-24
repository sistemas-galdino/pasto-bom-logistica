// [AGENTE API] Agenda de entregas (calendário por slot = data + período).
//
//   GET /api/agenda?de=YYYY-MM-DD&ate=YYYY-MM-DD -> AgendaResposta
//
// A leitura é liberada para logística, almoxarifado e VENDEDOR — o vendedor
// consultar a agenda antes de prometer uma data ao cliente foi o pedido central
// da reunião de 25/06/2026. O motorista fica de fora: ele tem a tela /rota.
//
// O prefixo /api é aplicado no registro do plugin (server.ts).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type {
  AgendaEntrega,
  AgendaOcupacao,
  AgendaReserva,
  AgendaResposta,
  AgendaSlot,
  Caminhao,
  PeriodoEntrega,
  StatusEntrega,
} from '@pastobom/shared';

import { supabase } from '../../db/supabase.js';
import { log } from '../../log.js';
import { lerPesosProdutos } from '../../services/carga.js';

// ---------------------------------------------------------------------------
// Schemas de validação (zod)
// ---------------------------------------------------------------------------

const dataISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Data inválida.' });

const querySchema = z.object({
  de: dataISO,
  ate: dataISO,
});

/** Teto da janela consultável — a tela navega por mês/semana, não por trimestre. */
const MAX_DIAS = 92;

const ORDEM_PERIODO: Record<PeriodoEntrega, number> = { manha: 0, tarde: 1 };

// ---------------------------------------------------------------------------
// Guard local
// ---------------------------------------------------------------------------

/** 403 para o motorista (tem a própria tela); libera os demais papéis. */
function exigirLeituraAgenda(
  req: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const papel = req.usuario?.papel;
  if (
    !req.usuario ||
    papel === 'logistica' ||
    papel === 'almoxarifado' ||
    papel === 'vendedor'
  ) {
    return true;
  }
  reply.code(403).send({
    error: 'sem_permissao',
    message: 'Sem permissão para consultar a agenda.',
  });
  return false;
}

// ---------------------------------------------------------------------------
// Linhas do banco
// ---------------------------------------------------------------------------

interface EntregaAgendaRow {
  id: string;
  orix_numero: string | null;
  cliente_codigo: string | null;
  cliente_nome: string | null;
  cidade_cliente: string | null;
  data_agendada: string;
  periodo: PeriodoEntrega;
  motorista_id: string | null;
  caminhao_id: string | null;
  status: StatusEntrega;
  pedido_id: string;
  entrega_itens?:
    | {
        produto_codigo: string | null;
        qtd: number | string | null;
        /** Peso congelado no agendamento (0019); null nas viagens antigas. */
        peso_unit_kg?: number | string | null;
      }[]
    | null;
  /** O pedido vem embutido: a agenda mostra cliente, não viagem anônima. */
  pedidos?: {
    orix_numero: string | null;
    cliente_codigo: string | null;
    cliente_nome: string | null;
    cidade_cliente: string | null;
  } | null;
}

interface CaminhaoRow {
  id: string;
  nome: string | null;
  placa: string | null;
  capacidade_kg: number | string | null;
  ativo: boolean | null;
}

/** Linha de `reservas` (migração 0021) na janela consultada. */
interface ReservaAgendaRow {
  id: string;
  servico: string;
  cidade: string | null;
  produtos: string | null;
  fornecedor_codigo: string | null;
  data_agendada: string;
  periodo: PeriodoEntrega;
  motorista_id: string | null;
  caminhao_id: string;
  peso_previsto_kg: number | string | null;
  bloqueia_caminhao: boolean;
}

/** Reservas da janela + os nomes que elas precisam, já resolvidos em lote. */
interface ReservasCarregadas {
  linhas: ReservaAgendaRow[];
  /** motorista_id -> nome. */
  motoristas: Map<string, string>;
  /** fornecedor_codigo -> nome. */
  fornecedores: Map<string, string>;
}

const SELECT_RESERVA =
  'id, servico, cidade, produtos, fornecedor_codigo, data_agendada, periodo, ' +
  'motorista_id, caminhao_id, peso_previsto_kg, bloqueia_caminhao';

const SELECT_AGENDA =
  'id, pedido_id, data_agendada, periodo, motorista_id, caminhao_id, status, ' +
  'entrega_itens(produto_codigo, qtd, peso_unit_kg), ' +
  'pedidos(orix_numero, cliente_codigo, cliente_nome, cidade_cliente)';

/** Peso da viagem: total agregado (desconhecido = 0) e o exibível (null se faltar peso). */
interface PesoDoPedido {
  agregadoKg: number;
  totalKg: number | null;
}

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export async function agendaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/agenda', async (req, reply) => {
    if (!exigirLeituraAgenda(req, reply)) return reply;

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'query_invalida',
        message: 'Informe de e ate no formato YYYY-MM-DD.',
        detalhes: parsed.error.issues,
      });
    }

    const { de, ate } = parsed.data;
    const dias = (Date.parse(ate) - Date.parse(de)) / 86_400_000 + 1;
    if (dias < 1 || dias > MAX_DIAS) {
      return reply.code(422).send({
        error: 'janela_invalida',
        message: `A janela precisa começar antes do fim e ter no máximo ${MAX_DIAS} dias.`,
      });
    }

    try {
      // A agenda mostra VIAGENS (Onda 2), não pedidos: dois caminhões levando o
      // mesmo pedido aparecem como dois cartões, cada um com sua carga.
      const { data, error } = await supabase
        .from('entregas')
        .select(SELECT_AGENDA)
        .gte('data_agendada', de)
        .lte('data_agendada', ate)
        .not('periodo', 'is', null)
        .in('status', ['agendada', 'em_rota'])
        .order('data_agendada', { ascending: true });

      if (error) {
        log.error(`[GET /agenda] erro: ${error.message}`);
        return reply
          .code(500)
          .send({ error: 'erro_banco', message: error.message });
      }

      const linhas = (data ?? []) as unknown as EntregaAgendaRow[];

      // Consultas em lote (sem N+1): frota, motoristas, clientes e pesos.
      // As reservas entram aqui e não junto da query de entregas porque não
      // dependem dela: um slot pode ter reserva e nenhuma entrega — é o caso da
      // manhã da oficina, e é exatamente o que a tela precisa mostrar.
      const [frota, motoristas, clientes, pesos, reservas] = await Promise.all([
        lerFrota(),
        resolverNomesMotorista(linhas),
        resolverClientes(linhas),
        lerPesosProdutos(
          linhas.flatMap((l) =>
            (l.entrega_itens ?? []).map((i) => i.produto_codigo ?? ''),
          ),
        ),
        lerReservas(de, ate),
      ]);

      const slots = montarSlots(
        linhas,
        frota,
        motoristas,
        clientes,
        pesos,
        reservas,
      );
      const resposta: AgendaResposta = {
        slots,
        caminhoes: [...frota.values()].filter((c) => c.ativo),
      };
      return reply.send(resposta);
    } catch (err) {
      return responderErro(reply, err, '[GET /agenda]');
    }
  });
}

// ---------------------------------------------------------------------------
// Carga dos dados auxiliares
// ---------------------------------------------------------------------------

/**
 * Frota inteira (id -> Caminhao), já ordenada por nome. Traz também os inativos:
 * um slot passado pode citar um caminhão que saiu de operação depois.
 */
async function lerFrota(): Promise<Map<string, Caminhao>> {
  const { data, error } = await supabase
    .from('caminhoes')
    .select('id, nome, placa, capacidade_kg, ativo')
    .order('nome', { ascending: true });

  if (error) {
    log.warn(`[agenda] Falha ao ler a frota: ${error.message}`);
    return new Map();
  }

  const mapa = new Map<string, Caminhao>();
  for (const row of (data ?? []) as CaminhaoRow[]) {
    const kg = Number(row.capacidade_kg);
    mapa.set(row.id, {
      id: row.id,
      nome: row.nome ?? '',
      placa: row.placa ?? null,
      capacidadeKg: Number.isFinite(kg) ? kg : 0,
      ativo: row.ativo === true,
    });
  }
  return mapa;
}

/** Nomes dos motoristas em lote (não há FK pedidos->profiles). */
async function resolverNomesMotorista(
  linhas: EntregaAgendaRow[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      linhas
        .map((l) => l.motorista_id)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, nome')
    .in('id', ids);

  if (error) {
    log.warn(`[agenda] Falha ao resolver nomes de motorista: ${error.message}`);
    return new Map();
  }

  const mapa = new Map<string, string>();
  for (const r of data ?? []) {
    mapa.set(r.id as string, (r.nome as string) ?? '');
  }
  return mapa;
}

/**
 * Reservas ativas da janela, com nomes de motorista e fornecedor resolvidos.
 *
 * Degrada para vazio em qualquer falha: a agenda de ENTREGAS é a função
 * principal desta rota, e uma falha de leitura de `reservas` (a migração 0021
 * sobe antes do deploy) não pode devolver 500 para a tela toda. O preço é uma
 * reserva que não aparece; o alternativo era o calendário inteiro em branco.
 */
async function lerReservas(
  de: string,
  ate: string,
): Promise<ReservasCarregadas> {
  const vazio: ReservasCarregadas = {
    linhas: [],
    motoristas: new Map(),
    fornecedores: new Map(),
  };

  const { data, error } = await supabase
    .from('reservas')
    .select(SELECT_RESERVA)
    .gte('data_agendada', de)
    .lte('data_agendada', ate)
    .eq('status', 'ativa')
    .order('data_agendada', { ascending: true });

  if (error) {
    log.error(`[agenda] Falha ao ler as reservas: ${error.message}`);
    return vazio;
  }

  const linhas = ((data ?? []) as unknown as ReservaAgendaRow[]).filter(
    (r) => r.caminhao_id,
  );
  if (linhas.length === 0) return vazio;

  const idsMotorista = [
    ...new Set(
      linhas
        .map((r) => r.motorista_id)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];
  const codigosFornecedor = [
    ...new Set(
      linhas
        .map((r) => r.fornecedor_codigo)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];

  const [motoristas, fornecedores] = await Promise.all([
    nomesPorId('profiles', 'id', idsMotorista),
    nomesPorId('fornecedores', 'codigo', codigosFornecedor),
  ]);

  return { linhas, motoristas, fornecedores };
}

/**
 * Mapa chave -> nome para uma tabela que tem coluna `nome`. Usado pelas reservas
 * (motoristas em profiles, fornecedores no espelho do Órix); as entregas têm
 * resolvedores próprios porque partem das linhas, não de uma lista de chaves.
 */
async function nomesPorId(
  tabela: 'profiles' | 'fornecedores',
  coluna: 'id' | 'codigo',
  chaves: string[],
): Promise<Map<string, string>> {
  if (chaves.length === 0) return new Map();

  const { data, error } = await supabase
    .from(tabela)
    .select(coluna === 'id' ? 'id, nome' : 'codigo, nome')
    .in(coluna, chaves);

  if (error) {
    log.warn(`[agenda] Falha ao resolver nomes em ${tabela}: ${error.message}`);
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

/** Bairro e cidade dos clientes em lote (a entrega rural se orienta por eles). */
async function resolverClientes(
  linhas: EntregaAgendaRow[],
): Promise<Map<string, { bairro: string | null; cidade: string | null }>> {
  const codigos = [
    ...new Set(
      linhas
        .map((l) => l.pedidos?.cliente_codigo ?? null)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];
  if (codigos.length === 0) return new Map();

  const { data, error } = await supabase
    .from('clientes')
    .select('codigo, bairro, cidade')
    .in('codigo', codigos);

  if (error) {
    log.warn(`[agenda] Falha ao resolver clientes: ${error.message}`);
    return new Map();
  }

  const mapa = new Map<
    string,
    { bairro: string | null; cidade: string | null }
  >();
  for (const r of data ?? []) {
    mapa.set(r.codigo as string, {
      bairro: (r.bairro as string | null) ?? null,
      cidade: (r.cidade as string | null) ?? null,
    });
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// Montagem dos slots
// ---------------------------------------------------------------------------

/**
 * Peso do pedido nas duas leituras que a agenda precisa:
 *   - `agregadoKg` soma o que se conhece (item sem peso conta 0) — é o que a
 *     ocupação do caminhão mostra;
 *   - `totalKg` é null se ALGUM item está sem peso — a tela sinaliza a pendência.
 */
function pesoDaLinha(
  linha: EntregaAgendaRow,
  pesos: Map<string, number>,
): PesoDoPedido {
  let agregadoKg = 0;
  let completo = true;

  for (const item of linha.entrega_itens ?? []) {
    // O peso CONGELADO na viagem manda (0019); o cadastro só responde pelas
    // viagens agendadas antes da migração. Sem isso, a agenda mostraria um peso
    // e o cartão da entrega outro assim que alguém corrigisse um produto.
    const congelado = Number(item.peso_unit_kg);
    const unit = Number.isFinite(congelado)
      ? congelado
      : pesos.get(item.produto_codigo ?? '');
    const qtd = Number(item.qtd) || 0;
    if (unit === undefined) {
      completo = false;
      continue;
    }
    agregadoKg += unit * qtd;
  }

  const arredondado = Math.round(agregadoKg * 1000) / 1000;
  return {
    agregadoKg: arredondado,
    totalKg: completo ? arredondado : null,
  };
}

function montarSlots(
  linhas: EntregaAgendaRow[],
  frota: Map<string, Caminhao>,
  motoristas: Map<string, string>,
  clientes: Map<string, { bairro: string | null; cidade: string | null }>,
  pesos: Map<string, number>,
  reservas: ReservasCarregadas,
): AgendaSlot[] {
  interface Acumulador {
    data: string;
    periodo: PeriodoEntrega;
    entregas: AgendaEntrega[];
    ocupacao: Map<string, AgendaOcupacao>;
    reservas: AgendaReserva[];
  }

  const porSlot = new Map<string, Acumulador>();

  /** Pega (ou cria) o acumulador do slot. É o que permite a segunda passada das
   *  reservas criar um slot que nenhuma entrega criaria. */
  function pegarSlot(data: string, periodo: PeriodoEntrega): Acumulador {
    const chave = `${data}|${periodo}`;
    const existente = porSlot.get(chave);
    if (existente) return existente;
    const novo: Acumulador = {
      data,
      periodo,
      entregas: [],
      ocupacao: new Map(),
      reservas: [],
    };
    porSlot.set(chave, novo);
    return novo;
  }

  for (const linha of linhas) {
    const slot = pegarSlot(linha.data_agendada, linha.periodo);

    const pedido = linha.pedidos ?? null;
    const cliente = pedido?.cliente_codigo
      ? clientes.get(pedido.cliente_codigo)
      : undefined;
    const caminhao = linha.caminhao_id
      ? frota.get(linha.caminhao_id)
      : undefined;
    const motoristaNome = linha.motorista_id
      ? (motoristas.get(linha.motorista_id) ?? '')
      : null;
    const peso = pesoDaLinha(linha, pesos);

    slot.entregas.push({
      entregaId: linha.id,
      pedidoId: linha.pedido_id,
      orixNumero: pedido?.orix_numero ?? '',
      clienteNome: pedido?.cliente_nome ?? '',
      bairro: cliente?.bairro ?? null,
      cidade: cliente?.cidade ?? pedido?.cidade_cliente ?? '',
      motoristaId: linha.motorista_id,
      motoristaNome,
      caminhaoId: linha.caminhao_id,
      caminhaoNome: caminhao?.nome ?? null,
      pesoTotalKg: peso.totalKg,
      status: linha.status,
    });

    if (!linha.caminhao_id) continue;

    const uso: AgendaOcupacao = slot.ocupacao.get(linha.caminhao_id) ?? {
      caminhaoId: linha.caminhao_id,
      caminhaoNome: caminhao?.nome ?? '',
      capacidadeKg: caminhao?.capacidadeKg ?? 0,
      usadoKg: 0,
      motoristaId: null,
      motoristaNome: null,
      entregas: 0,
    };
    uso.usadoKg = Math.round((uso.usadoKg + peso.agregadoKg) * 1000) / 1000;
    uso.entregas += 1;
    // O par motorista<->caminhão é único no slot: o primeiro define a dupla.
    if (uso.motoristaId === null && linha.motorista_id) {
      uso.motoristaId = linha.motorista_id;
      uso.motoristaNome = motoristaNome;
    }
    slot.ocupacao.set(linha.caminhao_id, uso);
  }

  // Segunda passada: as RESERVAS. Precisa vir depois porque uma reserva se
  // soma à ocupação de um caminhão que talvez já tenha entregas — e precisa
  // existir porque um slot só com reserva jamais seria criado pelo laço acima.
  // Sem ela o dia da oficina volta a parecer vago, que é o erro que a feature
  // existe para evitar.
  for (const r of reservas.linhas) {
    const slot = pegarSlot(r.data_agendada, r.periodo);
    const caminhao = frota.get(r.caminhao_id);
    const motoristaNome = r.motorista_id
      ? (reservas.motoristas.get(r.motorista_id) ?? '')
      : null;
    const pesoNum = Number(r.peso_previsto_kg);
    const pesoPrevistoKg =
      r.peso_previsto_kg === null || !Number.isFinite(pesoNum) ? null : pesoNum;

    slot.reservas.push({
      reservaId: r.id,
      servico: r.servico,
      cidade: r.cidade,
      fornecedorNome: r.fornecedor_codigo
        ? (reservas.fornecedores.get(r.fornecedor_codigo) ?? null)
        : null,
      produtos: r.produtos,
      motoristaId: r.motorista_id,
      motoristaNome,
      caminhaoId: r.caminhao_id,
      caminhaoNome: caminhao?.nome ?? null,
      pesoPrevistoKg,
      bloqueiaCaminhao: r.bloqueia_caminhao === true,
    });

    // A reserva também ocupa o caminhão na barra de ocupação: sem peso ela
    // aparece com 0 kg mas com o caminhão presente (é o que mostra que o
    // caminhão está tomado), com peso ela desconta tonelagem.
    const uso: AgendaOcupacao = slot.ocupacao.get(r.caminhao_id) ?? {
      caminhaoId: r.caminhao_id,
      caminhaoNome: caminhao?.nome ?? '',
      capacidadeKg: caminhao?.capacidadeKg ?? 0,
      usadoKg: 0,
      motoristaId: null,
      motoristaNome: null,
      entregas: 0,
    };
    uso.usadoKg =
      Math.round((uso.usadoKg + (pesoPrevistoKg ?? 0)) * 1000) / 1000;
    // `entregas` NÃO incrementa: reserva não é viagem a cliente, e é esse
    // número que a tela e o teto da 0020 leem como entregas.
    if (uso.motoristaId === null && r.motorista_id) {
      uso.motoristaId = r.motorista_id;
      uso.motoristaNome = motoristaNome;
    }
    slot.ocupacao.set(r.caminhao_id, uso);
  }

  return [...porSlot.values()]
    .map((s) => ({
      data: s.data,
      periodo: s.periodo,
      entregas: s.entregas,
      ocupacao: [...s.ocupacao.values()].sort((a, b) =>
        a.caminhaoNome.localeCompare(b.caminhaoNome, 'pt-BR'),
      ),
      reservas: s.reservas,
    }))
    .sort((a, b) => {
      if (a.data !== b.data) return a.data.localeCompare(b.data);
      return ORDEM_PERIODO[a.periodo] - ORDEM_PERIODO[b.periodo];
    });
}

// ---------------------------------------------------------------------------
// Tratamento de erro inesperado (mesmo padrão de pedidos.ts)
// ---------------------------------------------------------------------------

function responderErro(reply: FastifyReply, err: unknown, contexto: string) {
  const mensagem = err instanceof Error ? err.message : String(err);
  log.error(`${contexto} erro inesperado: ${mensagem}`);
  return reply.code(500).send({ error: 'erro_interno', message: mensagem });
}
