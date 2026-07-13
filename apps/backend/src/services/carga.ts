// [AGENTE API] Carga: peso dos produtos, ocupação dos caminhões e as travas
// pedidas pelo Johnny na reunião de 25/06/2026.
//
// Modelo do domínio (definido na reunião):
//   - Uma entrega é agendada num SLOT = (data, período) — período é manhã/tarde,
//     nunca horário.
//   - No agendamento escolhe-se motorista E caminhão, SEPARADAMENTE.
//   - Dentro de um slot, o par motorista<->caminhão é ÚNICO: um caminhão não sai
//     com dois motoristas, e um motorista não leva dois caminhões. Várias
//     entregas compartilham o mesmo par — isso É a rota.
//   - A soma do peso das entregas de um caminhão no slot não pode passar da
//     capacidade dele.
//
// O peso vem da tabela `produtos_peso` (peso UNITÁRIO por produto), preenchida
// pelo parser do nome (origem='auto') ou digitada pela equipe (origem='manual').
// O campo `peso` da API do Órix é inutilizável — ver packages/shared/src/peso.ts.

import {
  pesoDoNomeProduto,
  type ItemPedido,
  type PeriodoEntrega,
} from '@pastobom/shared';

import { supabase } from '../db/supabase.js';
import { log } from '../log.js';
import { TransicaoError } from './erros.js';

// ---------------------------------------------------------------------------
// Peso
// ---------------------------------------------------------------------------

/** Peso unitário conhecido de cada produto informado (código -> kg). */
export async function lerPesosProdutos(
  codigos: string[],
): Promise<Map<string, number>> {
  const unicos = [...new Set(codigos.filter((c) => c.length > 0))];
  if (unicos.length === 0) return new Map();

  const { data, error } = await supabase
    .from('produtos_peso')
    .select('produto_codigo, peso_kg')
    .in('produto_codigo', unicos);

  if (error) {
    log.warn(`[carga] Falha ao ler pesos de produtos: ${error.message}`);
    return new Map();
  }

  const mapa = new Map<string, number>();
  for (const r of data ?? []) {
    const kg = Number(r.peso_kg);
    if (Number.isFinite(kg)) mapa.set(r.produto_codigo as string, kg);
  }
  return mapa;
}

/**
 * Peso total da carga de um pedido, em kg.
 * `null` se ALGUM item ainda não tem peso — aí o pedido não pode ser agendado
 * enquanto a equipe não completar (era o "ó Johnny, falta esses produtos").
 */
export function pesoTotalDoPedido(itens: ItemPedido[]): number | null {
  if (itens.length === 0) return 0;
  let total = 0;
  for (const item of itens) {
    if (item.pesoUnitKg === null) return null;
    total += item.pesoUnitKg * item.qtd;
  }
  return Math.round(total * 1000) / 1000;
}

/** Itens do pedido que ainda estão sem peso (os que travam o agendamento). */
export function itensSemPeso(itens: ItemPedido[]): ItemPedido[] {
  return itens.filter((i) => i.pesoUnitKg === null);
}

/**
 * Para produtos ainda desconhecidos, tenta extrair o peso do NOME e grava com
 * origem='auto'. Nunca sobrescreve um peso já existente (em especial os
 * 'manual', que são a correção humana). Chamado pela ingestão — assim o
 * cadastro se auto-completa sozinho conforme os pedidos chegam.
 */
export async function semearPesosAuto(
  produtos: { codigo: string; nome: string }[],
): Promise<number> {
  const porCodigo = new Map<string, string>();
  for (const p of produtos) {
    if (p.codigo) porCodigo.set(p.codigo, p.nome);
  }
  if (porCodigo.size === 0) return 0;

  const jaConhecidos = await lerPesosProdutos([...porCodigo.keys()]);

  const novos: {
    produto_codigo: string;
    nome_produto: string;
    peso_kg: number;
    origem: 'auto';
  }[] = [];

  for (const [codigo, nome] of porCodigo) {
    if (jaConhecidos.has(codigo)) continue;
    const kg = pesoDoNomeProduto(nome);
    if (kg === null) continue; // sem embalagem no nome -> fica para o cadastro manual
    novos.push({
      produto_codigo: codigo,
      nome_produto: nome,
      peso_kg: kg,
      origem: 'auto',
    });
  }

  if (novos.length === 0) return 0;

  // onConflict ignora: se outro tick já inseriu (ou a equipe já corrigiu à mão),
  // o registro existente prevalece.
  const { error } = await supabase
    .from('produtos_peso')
    .upsert(novos, { onConflict: 'produto_codigo', ignoreDuplicates: true });

  if (error) {
    log.warn(`[carga] Falha ao semear pesos automáticos: ${error.message}`);
    return 0;
  }

  log.info(`[carga] ${novos.length} peso(s) inferido(s) do nome do produto.`);
  return novos.length;
}

// ---------------------------------------------------------------------------
// Ocupação de um slot (data + período)
// ---------------------------------------------------------------------------

/** Uso de um caminhão dentro de um slot. */
export interface UsoCaminhao {
  caminhaoId: string;
  usadoKg: number;
  motoristaIds: Set<string>;
  entregas: number;
}

interface LinhaSlot {
  id: string;
  motorista_id: string | null;
  caminhao_id: string | null;
}

/**
 * Lê o que já está agendado num slot e soma o peso por caminhão.
 * `ignorarPedidoId` exclui o próprio pedido do cálculo (reagendamento não pode
 * competir consigo mesmo pela capacidade).
 *
 * Só contam pedidos vivos: 'agendada' e 'em_rota'. Entregue já saiu do caminhão;
 * cancelada não ocupa nada.
 */
export async function ocupacaoDoSlot(
  data: string,
  periodo: PeriodoEntrega,
  ignorarPedidoId?: string,
): Promise<Map<string, UsoCaminhao>> {
  const { data: linhas, error } = await supabase
    .from('pedidos')
    .select('id, motorista_id, caminhao_id')
    .eq('data_agendada', data)
    .eq('periodo', periodo)
    .in('status_logistico', ['agendada', 'em_rota']);

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao ler a ocupação do dia: ${error.message}`,
    );
  }

  const relevantes = ((linhas ?? []) as LinhaSlot[]).filter(
    (l) => l.id !== ignorarPedidoId && l.caminhao_id,
  );
  if (relevantes.length === 0) return new Map();

  // Peso de cada pedido do slot: soma dos itens × peso unitário do produto.
  const ids = relevantes.map((l) => l.id);
  const { data: itens, error: errItens } = await supabase
    .from('itens_pedido')
    .select('pedido_id, produto_codigo, qtd')
    .in('pedido_id', ids);

  if (errItens) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao ler os itens do dia: ${errItens.message}`,
    );
  }

  const pesos = await lerPesosProdutos(
    (itens ?? []).map((i) => (i.produto_codigo as string) ?? ''),
  );

  const pesoPorPedido = new Map<string, number>();
  for (const item of itens ?? []) {
    const codigo = (item.produto_codigo as string) ?? '';
    const unit = pesos.get(codigo) ?? 0; // peso desconhecido conta como 0
    const qtd = Number(item.qtd) || 0;
    const pedidoId = item.pedido_id as string;
    pesoPorPedido.set(pedidoId, (pesoPorPedido.get(pedidoId) ?? 0) + unit * qtd);
  }

  const uso = new Map<string, UsoCaminhao>();
  for (const l of relevantes) {
    const caminhaoId = l.caminhao_id as string;
    const atual: UsoCaminhao = uso.get(caminhaoId) ?? {
      caminhaoId,
      usadoKg: 0,
      motoristaIds: new Set<string>(),
      entregas: 0,
    };
    atual.usadoKg += pesoPorPedido.get(l.id) ?? 0;
    atual.entregas += 1;
    if (l.motorista_id) atual.motoristaIds.add(l.motorista_id);
    uso.set(caminhaoId, atual);
  }
  return uso;
}

// ---------------------------------------------------------------------------
// Travas do agendamento
// ---------------------------------------------------------------------------

export interface Caminhao {
  id: string;
  nome: string;
  capacidadeKg: number;
  ativo: boolean;
}

/** Carrega um caminhão pelo id; 422 se não existir ou estiver inativo. */
export async function carregarCaminhao(id: string): Promise<Caminhao> {
  const { data, error } = await supabase
    .from('caminhoes')
    .select('id, nome, capacidade_kg, ativo')
    .eq('id', id)
    .maybeSingle<{
      id: string;
      nome: string;
      capacidade_kg: number | string;
      ativo: boolean;
    }>();

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao carregar o caminhão: ${error.message}`,
    );
  }
  if (!data) {
    throw new TransicaoError(
      422,
      'caminhao_invalido',
      'Caminhão não encontrado.',
    );
  }
  if (!data.ativo) {
    throw new TransicaoError(
      422,
      'caminhao_inativo',
      `O caminhão ${data.nome} está inativo.`,
    );
  }
  return {
    id: data.id,
    nome: data.nome,
    capacidadeKg: Number(data.capacidade_kg) || 0,
    ativo: data.ativo,
  };
}

function formatarT(kg: number): string {
  return `${(kg / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })} t`;
}

/**
 * Valida as três travas do agendamento. Lança TransicaoError 422 com mensagem
 * pronta para a tela.
 *
 *   1) capacidade do caminhão no slot (a carga do dia não pode estourar);
 *   2) o caminhão não pode sair com dois motoristas no mesmo slot;
 *   3) o motorista não pode levar dois caminhões no mesmo slot.
 */
export async function validarCargaDoAgendamento(args: {
  pedidoId: string;
  data: string;
  periodo: PeriodoEntrega;
  motoristaId: string;
  caminhaoId: string;
  pesoDoPedidoKg: number;
}): Promise<void> {
  const { pedidoId, data, periodo, motoristaId, caminhaoId, pesoDoPedidoKg } =
    args;

  const caminhao = await carregarCaminhao(caminhaoId);
  const uso = await ocupacaoDoSlot(data, periodo, pedidoId);

  // 1) Capacidade.
  const jaUsado = uso.get(caminhaoId)?.usadoKg ?? 0;
  const totalKg = jaUsado + pesoDoPedidoKg;
  if (totalKg > caminhao.capacidadeKg) {
    const excedente = totalKg - caminhao.capacidadeKg;
    throw new TransicaoError(
      422,
      'capacidade_excedida',
      `A carga não cabe: o ${caminhao.nome} comporta ${formatarT(
        caminhao.capacidadeKg,
      )} e ficaria com ${formatarT(totalKg)} (excedeu ${formatarT(
        excedente,
      )}). Escolha outro caminhão, outro período ou outro dia.`,
    );
  }

  // 2) O caminhão já está com OUTRO motorista neste período?
  const outrosMotoristas = [...(uso.get(caminhaoId)?.motoristaIds ?? [])].filter(
    (id) => id !== motoristaId,
  );
  if (outrosMotoristas.length > 0) {
    const nome = await nomeDoMotorista(outrosMotoristas[0] as string);
    throw new TransicaoError(
      422,
      'caminhao_ocupado',
      `O ${caminhao.nome} já está com ${nome} neste período. Um caminhão não sai com dois motoristas no mesmo turno.`,
    );
  }

  // 3) O motorista já está em OUTRO caminhão neste período?
  for (const [outroCaminhaoId, u] of uso) {
    if (outroCaminhaoId === caminhaoId) continue;
    if (u.motoristaIds.has(motoristaId)) {
      const outro = await carregarCaminhao(outroCaminhaoId).catch(() => null);
      throw new TransicaoError(
        422,
        'motorista_ocupado',
        `Este motorista já está no ${
          outro?.nome ?? 'outro caminhão'
        } neste período. Ele não pode levar dois caminhões no mesmo turno.`,
      );
    }
  }
}

/** Nome do motorista (profiles) para compor a mensagem de erro. */
async function nomeDoMotorista(id: string): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('nome')
    .eq('id', id)
    .maybeSingle<{ nome: string | null }>();
  const nome = data?.nome?.trim();
  return nome && nome.length > 0 ? nome : 'outro motorista';
}
