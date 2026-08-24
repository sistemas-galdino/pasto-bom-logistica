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
  avaliarLimiteEntregas,
  pesoDoNomeProduto,
  type ItemPedido,
  type LimiteCaminhao,
  type OrigemPeso,
  type PeriodoEntrega,
} from '@pastobom/shared';

import { supabase } from '../db/supabase.js';
import { log } from '../log.js';
import { TransicaoError } from './erros.js';

// ---------------------------------------------------------------------------
// Peso
// ---------------------------------------------------------------------------

/** O que se sabe do peso de um produto, além do número. */
export interface PesoDetalhado {
  kg: number;
  origem: OrigemPeso;
  atualizadoEm: string | null;
}

/**
 * Peso de cada produto informado, com a procedência.
 *
 * A origem importa na tela de agendamento: peso 'manual' foi a equipe que
 * digitou, então é uma sugestão a conferir (a soja nunca vem com o mesmo peso);
 * peso 'auto' saiu do nome do produto e não precisa de aval humano nenhum.
 */
export async function lerPesosDetalhados(
  codigos: string[],
): Promise<Map<string, PesoDetalhado>> {
  const unicos = [...new Set(codigos.filter((c) => c.length > 0))];
  if (unicos.length === 0) return new Map();

  const { data, error } = await supabase
    .from('produtos_peso')
    .select('produto_codigo, peso_kg, origem, atualizado_em')
    .in('produto_codigo', unicos);

  if (error) {
    log.warn(`[carga] Falha ao ler pesos de produtos: ${error.message}`);
    return new Map();
  }

  const mapa = new Map<string, PesoDetalhado>();
  for (const r of data ?? []) {
    const kg = Number(r.peso_kg);
    if (!Number.isFinite(kg)) continue;
    mapa.set(r.produto_codigo as string, {
      kg,
      origem: r.origem === 'manual' ? 'manual' : 'auto',
      atualizadoEm: (r.atualizado_em as string | null) ?? null,
    });
  }
  return mapa;
}

/** Peso unitário conhecido de cada produto informado (código -> kg). */
export async function lerPesosProdutos(
  codigos: string[],
): Promise<Map<string, number>> {
  const detalhado = await lerPesosDetalhados(codigos);
  return new Map([...detalhado].map(([codigo, p]) => [codigo, p.kg]));
}

/**
 * Grava o peso digitado pela equipe (origem='manual'), sobrescrevendo o que
 * havia. É a porta do agendamento e da correção avulsa na rota de produtos.
 *
 * Sobrescrever é o comportamento certo AGORA que a viagem congela o próprio
 * peso (migração 0019): o cadastro guarda só o último valor informado, para
 * sugerir no próximo pedido. Nenhuma entrega já feita se mexe.
 */
export async function gravarPesosManuais(
  pesos: { produtoCodigo: string; nomeProduto?: string | null; pesoKg: number }[],
  usuarioId: string | null,
): Promise<void> {
  const agora = new Date().toISOString();
  const linhas = pesos
    .filter((p) => p.produtoCodigo && Number.isFinite(p.pesoKg) && p.pesoKg > 0)
    .map((p) => {
      const linha: Record<string, unknown> = {
        produto_codigo: p.produtoCodigo,
        peso_kg: p.pesoKg,
        origem: 'manual',
        atualizado_em: agora,
        atualizado_por: usuarioId,
      };
      // `nome_produto` só entra quando se sabe: mandar null apagaria um nome já
      // gravado, e o upsert não tem como distinguir "não sei" de "apague".
      if (p.nomeProduto) linha.nome_produto = p.nomeProduto;
      return linha;
    });

  if (linhas.length === 0) return;

  const { error } = await supabase
    .from('produtos_peso')
    .upsert(linhas, { onConflict: 'produto_codigo' });

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao gravar o peso do produto: ${error.message}`,
    );
  }
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
 * Lê o que já está marcado num slot e soma o peso por caminhão.
 *
 * A partir da Onda 2 quem ocupa o caminhão é a ENTREGA, não o pedido — e o peso
 * é o das quantidades DAQUELA VIAGEM, não o do pedido inteiro. É essa mudança
 * que destrava a preocupação do Guto na reunião de 16/07: um pedido de 100
 * toneladas deixa de ser impossível de agendar, porque cada viagem pesa só o
 * que leva.
 *
 * `ignorarEntregaId` exclui a própria entrega do cálculo (reagendar não pode
 * competir consigo mesmo pela capacidade).
 *
 * Só contam viagens vivas: 'agendada' e 'em_rota'. Entregue já saiu do caminhão;
 * nao_realizado voltou; cancelada nunca ocupou.
 */
export async function ocupacaoDoSlot(
  data: string,
  periodo: PeriodoEntrega,
  ignorarEntregaId?: string,
): Promise<Map<string, UsoCaminhao>> {
  const { data: linhas, error } = await supabase
    .from('entregas')
    .select('id, motorista_id, caminhao_id')
    .eq('data_agendada', data)
    .eq('periodo', periodo)
    .in('status', ['agendada', 'em_rota']);

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao ler a ocupação do dia: ${error.message}`,
    );
  }

  const relevantes = ((linhas ?? []) as LinhaSlot[]).filter(
    (l) => l.id !== ignorarEntregaId && l.caminhao_id,
  );
  if (relevantes.length === 0) return new Map();

  // Peso de cada entrega: soma dos itens DA VIAGEM × peso unitário do produto.
  const ids = relevantes.map((l) => l.id);
  const { data: itens, error: errItens } = await supabase
    .from('entrega_itens')
    .select('entrega_id, produto_codigo, qtd, peso_unit_kg')
    .in('entrega_id', ids);

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

  const pesoPorEntrega = new Map<string, number>();
  for (const item of itens ?? []) {
    const codigo = (item.produto_codigo as string) ?? '';
    // O peso CONGELADO da viagem manda (migração 0019). O cadastro é o fallback
    // das viagens agendadas antes dela. Sem nenhum dos dois, conta como 0 — a
    // trava de capacidade prefere subestimar a recusar uma viagem por um dado
    // que ninguém tem.
    const congelado = Number(item.peso_unit_kg);
    const unit = Number.isFinite(congelado)
      ? congelado
      : (pesos.get(codigo) ?? 0);
    const qtd = Number(item.qtd) || 0;
    const entregaId = item.entrega_id as string;
    pesoPorEntrega.set(
      entregaId,
      (pesoPorEntrega.get(entregaId) ?? 0) + unit * qtd,
    );
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
    atual.usadoKg += pesoPorEntrega.get(l.id) ?? 0;
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
 *   2) número de entregas do caminhão no DIA, quando há limite configurado;
 *   3) o caminhão não pode sair com dois motoristas no mesmo slot;
 *   4) o motorista não pode levar dois caminhões no mesmo slot.
 *
 * Ponto único: todo mundo que agenda ou reagenda passa por aqui. Se você criar
 * outro caminho de escrita de `entregas`, chame esta função — não copie as
 * travas.
 */
export async function validarCargaDoAgendamento(args: {
  /** Entrega que está sendo criada/reagendada (excluída da ocupação). */
  entregaId?: string;
  data: string;
  periodo: PeriodoEntrega;
  motoristaId: string;
  caminhaoId: string;
  /** Peso das quantidades DESTA viagem, não o do pedido inteiro. */
  pesoDaCargaKg: number;
}): Promise<void> {
  const { entregaId, data, periodo, motoristaId, caminhaoId, pesoDaCargaKg } =
    args;

  const caminhao = await carregarCaminhao(caminhaoId);
  const uso = await ocupacaoDoSlot(data, periodo, entregaId);

  // 1) Capacidade.
  const jaUsado = uso.get(caminhaoId)?.usadoKg ?? 0;
  const totalKg = jaUsado + pesoDaCargaKg;
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

  // 2) Quantidade de entregas no DIA (as duas regras valem juntas, como ela
  //    pediu: tonelagem E número de entregas).
  //
  //    Atenção ao escopo: o teto é por DIA e o slot é dia x turno, então a
  //    contagem soma manhã e tarde. Contar só o slot deixaria o caminhão levar
  //    5 de manhã e 5 à tarde com teto de 5.
  const limites = await lerLimitesDoCaminhao(caminhaoId);
  if (limites.length > 0) {
    const jaNoDia = await contarEntregasNoDia(data, caminhaoId, entregaId);
    const veredicto = avaliarLimiteEntregas({
      limites,
      data,
      entregasNoDia: jaNoDia,
    });
    if (!veredicto.cabe) {
      throw new TransicaoError(
        422,
        'limite_entregas_excedido',
        `O ${caminhao.nome} já tem ${veredicto.entregasNoDia} ${
          veredicto.entregasNoDia === 1 ? 'entrega' : 'entregas'
        } neste dia e o limite configurado é ${veredicto.maxEntregasDia} por dia. Escolha outro caminhão ou outro dia.`,
      );
    }
  }

  // 3) O caminhão já está com OUTRO motorista neste período?
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

  // 4) O motorista já está em OUTRO caminhão neste período?
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

/**
 * Janelas de limite de um caminhão.
 *
 * Lê todas e deixa a escolha da vigente para a regra pura em
 * @pastobom/shared — assim a tela decide igual ao servidor. Lista vazia = sem
 * teto de quantidade, e o caminhão segue limitado só pela tonelagem (nenhum
 * default foi pedido; inventar um faria o sistema recusar agendamento que hoje
 * passa, sem ninguém ter configurado nada).
 */
export async function lerLimitesDoCaminhao(
  caminhaoId: string,
): Promise<LimiteCaminhao[]> {
  const { data, error } = await supabase
    .from('caminhao_limites')
    .select('valido_de, valido_ate, max_entregas_dia')
    .eq('caminhao_id', caminhaoId);

  if (error) {
    // Degrada em vez de derrubar: o limite de quantidade é uma regra a MAIS, e
    // uma falha de leitura aqui não pode impedir a operação de agendar. A
    // tonelagem, que é a regra antiga, continua valendo.
    log.error(
      `[carga] Falha ao ler os limites do caminhão ${caminhaoId}: ${error.message}`,
    );
    return [];
  }

  return (data ?? []).map((l) => ({
    validoDe: String(l.valido_de),
    validoAte: l.valido_ate === null ? null : String(l.valido_ate),
    maxEntregasDia: Number(l.max_entregas_dia),
  }));
}

/**
 * Quantas entregas vivas o caminhão tem NESSE DIA, somando manhã e tarde.
 *
 * `ignorarEntregaId` existe pelo mesmo motivo do `ocupacaoDoSlot`: reagendar
 * dentro do mesmo dia não pode fazer a viagem competir consigo mesma.
 */
async function contarEntregasNoDia(
  data: string,
  caminhaoId: string,
  ignorarEntregaId?: string,
): Promise<number> {
  const { data: linhas, error } = await supabase
    .from('entregas')
    .select('id')
    .eq('data_agendada', data)
    .eq('caminhao_id', caminhaoId)
    .in('status', ['agendada', 'em_rota']);

  if (error) {
    throw new TransicaoError(
      500,
      'erro_banco',
      `Falha ao contar as entregas do dia: ${error.message}`,
    );
  }

  return (linhas ?? []).filter((l) => l.id !== ignorarEntregaId).length;
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
