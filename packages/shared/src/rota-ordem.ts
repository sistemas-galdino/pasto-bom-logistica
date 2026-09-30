// Ordem das paradas da rota do dia — item 11 do documento da Natália (08/2026).
//
// O PROBLEMA
// ---------------------------------------------------------------------------
// "Informar qual será o próximo cliente/entrega após a conclusão da entrega
// atual." A partir da migração 0022 cada viagem pode ter `ordemRota`, informada
// pelo próprio motorista ao concluir a parada anterior. Mas a lista real é
// SEMPRE mista: as paradas que ele já sequenciou e as que ainda não, no mesmo
// dia. Ordenar isso tem casos de borda suficientes para não morar na tela:
//
//   - a não sequenciada (ordemRota null) não é "a parada zero" — é a que ainda
//     não entrou na fila, então vai DEPOIS de todas as sequenciadas;
//   - o banco não tem unicidade de propósito (empate travaria a rota na
//     estrada), então duas paradas podem ter a mesma ordem e o desempate precisa
//     ser estável;
//   - manhã antes de tarde é a única ordem natural que sobra quando não há
//     sequência nenhuma — e é a ordem que a rota do dia sempre teve.
//
// POR QUE AQUI, E NÃO EM lib/ DO FRONTEND
// ---------------------------------------------------------------------------
// Mesmo motivo de agenda-grupos.ts e limite-entregas.ts: é decisão com casos de
// borda, e o frontend não tem test runner. Em lib/ isto ficaria sem teste.

import type { PeriodoEntrega } from './types/domain.js';

/** O mínimo que uma parada precisa expor para ser ordenada. */
export interface ParadaOrdenavel {
  id: string;
  /** null = ainda não sequenciada pelo motorista. */
  ordemRota: number | null;
  periodo: PeriodoEntrega | null;
  clienteNome: string;
}

const ORDEM_PERIODO: Record<PeriodoEntrega, number> = { manha: 0, tarde: 1 };

/** Período sem valor vai por último: dado incompleto não é "manhã". */
function pesoPeriodo(periodo: PeriodoEntrega | null): number {
  return periodo === null ? 2 : ORDEM_PERIODO[periodo];
}

/**
 * Compara duas paradas: sequenciadas primeiro, na ordem informada; depois as
 * ainda não sequenciadas, por período e nome do cliente.
 *
 * O desempate final é o id, para a ordem não depender da ordem de chegada do
 * banco — a mesma lista tem de sair igual em duas leituras seguidas.
 */
export function compararParadas(
  a: ParadaOrdenavel,
  b: ParadaOrdenavel,
): number {
  const temA = a.ordemRota !== null;
  const temB = b.ordemRota !== null;

  if (temA !== temB) return temA ? -1 : 1;
  if (temA && temB && a.ordemRota !== b.ordemRota) {
    return (a.ordemRota as number) - (b.ordemRota as number);
  }

  const porPeriodo = pesoPeriodo(a.periodo) - pesoPeriodo(b.periodo);
  if (porPeriodo !== 0) return porPeriodo;

  const nomeA = a.clienteNome.trim();
  const nomeB = b.clienteNome.trim();
  if (nomeA !== nomeB) {
    // Cliente sem nome no fim: é dado incompleto, não o "cliente A".
    if (nomeA === '') return 1;
    if (nomeB === '') return -1;
    const porNome = nomeA.localeCompare(nomeB, 'pt-BR', {
      sensitivity: 'base',
    });
    if (porNome !== 0) return porNome;
  }

  return a.id.localeCompare(b.id);
}

/** Copia a lista ordenada (não muta a original — ela costuma vir do cache). */
export function ordenarParadas<T extends ParadaOrdenavel>(
  paradas: readonly T[],
): T[] {
  return [...paradas].sort(compararParadas);
}

// ---------------------------------------------------------------------------
// Reordenar arrastando — pedido da Natália, reunião de 24/09/2026
// ---------------------------------------------------------------------------

export interface ReordenacaoParadas {
  /** id -> nova ordem (1..N) de TODAS as paradas do dia, não só as arrastadas. */
  ordem: Map<string, number>;
  /** Não vazio = nada deve ser gravado. */
  erros: string[];
}

/**
 * Aplica uma nova ordem a UM SUBCONJUNTO das paradas do dia do motorista.
 *
 * A logística arrasta os cards de um caminhão, num período, na agenda. Mas
 * `ordemRota` é a sequência do MOTORISTA no dia inteiro — é como a tela dele lê
 * (`ordenarParadas`). Nos dias em que um motorista tem viagens em dois caminhões,
 * ou de manhã e à tarde, reordenar um grupo não pode mexer no outro.
 *
 * Por isso é uma permutação NO LUGAR: as paradas arrastadas trocam de posição só
 * entre si, ocupando as posições que já eram delas na ordem atual. Todas as
 * outras ficam exatamente onde estavam. Depois, o dia inteiro é renumerado
 * 1..N — o que também congela a ordem que a tela mostrava para as paradas que
 * ninguém tinha sequenciado, e é essa a ordem que o motorista passa a ver.
 */
export function reordenarSubconjunto<T extends ParadaOrdenavel>(
  paradas: readonly T[],
  novaOrdem: readonly string[],
): ReordenacaoParadas {
  const erros: string[] = [];
  const base = ordenarParadas(paradas);
  const porId = new Map(base.map((p) => [p.id, p]));

  const vistos = new Set<string>();
  for (const id of novaOrdem) {
    if (vistos.has(id)) erros.push(`A parada ${id} aparece duas vezes.`);
    vistos.add(id);
    if (!porId.has(id)) erros.push(`A parada ${id} não é deste motorista neste dia.`);
  }
  if (erros.length > 0) return { ordem: new Map(), erros };

  const posicoes: number[] = [];
  base.forEach((p, i) => {
    if (vistos.has(p.id)) posicoes.push(i);
  });

  const resultado = [...base];
  posicoes.forEach((pos, k) => {
    resultado[pos] = porId.get(novaOrdem[k] as string) as T;
  });

  return {
    ordem: new Map(resultado.map((p, i) => [p.id, i + 1])),
    erros: [],
  };
}
