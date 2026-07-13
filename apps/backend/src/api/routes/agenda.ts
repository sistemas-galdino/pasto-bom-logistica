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
  AgendaResposta,
  AgendaSlot,
  Caminhao,
  PeriodoEntrega,
  StatusLogistico,
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
function exigirLeituraAgenda(req: FastifyRequest, reply: FastifyReply): boolean {
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

interface PedidoAgendaRow {
  id: string;
  orix_numero: string | null;
  cliente_codigo: string | null;
  cliente_nome: string | null;
  cidade_cliente: string | null;
  data_agendada: string;
  periodo: PeriodoEntrega;
  motorista_id: string | null;
  caminhao_id: string | null;
  status_logistico: StatusLogistico;
  itens_pedido?:
    | { produto_codigo: string | null; qtd: number | string | null }[]
    | null;
}

interface CaminhaoRow {
  id: string;
  nome: string | null;
  placa: string | null;
  capacidade_kg: number | string | null;
  ativo: boolean | null;
}

const SELECT_AGENDA =
  'id, orix_numero, cliente_codigo, cliente_nome, cidade_cliente, data_agendada, ' +
  'periodo, motorista_id, caminhao_id, status_logistico, ' +
  'itens_pedido(produto_codigo, qtd)';

/** Peso do pedido: total agregado (desconhecido = 0) e o total exibível (null se faltar peso). */
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
      const { data, error } = await supabase
        .from('pedidos')
        .select(SELECT_AGENDA)
        .gte('data_agendada', de)
        .lte('data_agendada', ate)
        .not('periodo', 'is', null)
        .in('status_logistico', ['agendada', 'em_rota'])
        .order('data_agendada', { ascending: true });

      if (error) {
        log.error(`[GET /agenda] erro: ${error.message}`);
        return reply
          .code(500)
          .send({ error: 'erro_banco', message: error.message });
      }

      const linhas = (data ?? []) as unknown as PedidoAgendaRow[];

      // Consultas em lote (sem N+1): frota, motoristas, clientes e pesos.
      const [frota, motoristas, clientes, pesos] = await Promise.all([
        lerFrota(),
        resolverNomesMotorista(linhas),
        resolverClientes(linhas),
        lerPesosProdutos(
          linhas.flatMap((l) =>
            (l.itens_pedido ?? []).map((i) => i.produto_codigo ?? ''),
          ),
        ),
      ]);

      const slots = montarSlots(linhas, frota, motoristas, clientes, pesos);
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
  linhas: PedidoAgendaRow[],
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

/** Bairro e cidade dos clientes em lote (a entrega rural se orienta por eles). */
async function resolverClientes(
  linhas: PedidoAgendaRow[],
): Promise<Map<string, { bairro: string | null; cidade: string | null }>> {
  const codigos = [
    ...new Set(
      linhas
        .map((l) => l.cliente_codigo)
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

  const mapa = new Map<string, { bairro: string | null; cidade: string | null }>();
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
  linha: PedidoAgendaRow,
  pesos: Map<string, number>,
): PesoDoPedido {
  let agregadoKg = 0;
  let completo = true;

  for (const item of linha.itens_pedido ?? []) {
    const unit = pesos.get(item.produto_codigo ?? '');
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
  linhas: PedidoAgendaRow[],
  frota: Map<string, Caminhao>,
  motoristas: Map<string, string>,
  clientes: Map<string, { bairro: string | null; cidade: string | null }>,
  pesos: Map<string, number>,
): AgendaSlot[] {
  interface Acumulador {
    data: string;
    periodo: PeriodoEntrega;
    entregas: AgendaEntrega[];
    ocupacao: Map<string, AgendaOcupacao>;
  }

  const porSlot = new Map<string, Acumulador>();

  for (const linha of linhas) {
    const chave = `${linha.data_agendada}|${linha.periodo}`;
    const slot: Acumulador = porSlot.get(chave) ?? {
      data: linha.data_agendada,
      periodo: linha.periodo,
      entregas: [],
      ocupacao: new Map(),
    };
    porSlot.set(chave, slot);

    const cliente = linha.cliente_codigo
      ? clientes.get(linha.cliente_codigo)
      : undefined;
    const caminhao = linha.caminhao_id ? frota.get(linha.caminhao_id) : undefined;
    const motoristaNome = linha.motorista_id
      ? motoristas.get(linha.motorista_id) ?? ''
      : null;
    const peso = pesoDaLinha(linha, pesos);

    slot.entregas.push({
      pedidoId: linha.id,
      orixNumero: linha.orix_numero ?? '',
      clienteNome: linha.cliente_nome ?? '',
      bairro: cliente?.bairro ?? null,
      cidade: cliente?.cidade ?? linha.cidade_cliente ?? '',
      motoristaId: linha.motorista_id,
      motoristaNome,
      caminhaoId: linha.caminhao_id,
      caminhaoNome: caminhao?.nome ?? null,
      pesoTotalKg: peso.totalKg,
      statusLogistico: linha.status_logistico,
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

  return [...porSlot.values()]
    .map((s) => ({
      data: s.data,
      periodo: s.periodo,
      entregas: s.entregas,
      ocupacao: [...s.ocupacao.values()].sort((a, b) =>
        a.caminhaoNome.localeCompare(b.caminhaoNome, 'pt-BR'),
      ),
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
