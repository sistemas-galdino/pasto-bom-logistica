// Agrupamento e ordenação dos cards da agenda — pedidos 5 e 6 do documento da
// Natália (08/2026).
//
// O PROBLEMA
// ---------------------------------------------------------------------------
// Dentro de um slot (dia + período), a agenda mostrava as barras de capacidade
// dos caminhões no topo e, embaixo, uma lista PLANA de cards. Duas queixas,
// ambas corretas:
//
//   "quando possuir mais de um caminhão no dia agrupar os clientes conforme o
//    agendamento do caminhão, o exemplo abaixo fica confuso ver qual cliente
//    está em cada caminhão"
//   "quando possuir mais de um pedido do mesmo cliente, agrupar ou colocar
//    eles próximos no grid (por ordem alfabética)"
//
// E não era questão de ordenação errada: não havia ordenação nenhuma. Os cards
// saíam na ordem em que o Postgres devolveu as linhas, então dois pedidos do
// mesmo cliente podiam ficar em pontas opostas da lista, e o caminhão de cada
// card só aparecia lendo o rodapé de cada um.
//
// POR QUE AQUI, E NÃO NA TELA
// ---------------------------------------------------------------------------
// Mesmo motivo de avaliarPesoAgendamento e de saldo.ts: é decisão, tem casos de
// borda (entrega sem caminhão, cliente sem nome, acentuação) e o frontend não
// tem test runner. Em lib/ do frontend isto ficaria sem teste.

import type { AgendaEntrega, AgendaOcupacao, AgendaSlot } from './types/domain.js';

/**
 * Um caminhão do slot com as suas viagens.
 *
 * `caminhaoId: null` é o balde das viagens agendadas SEM caminhão: elas existem
 * (o agendamento não exige caminhão em toda a base histórica) e hoje se
 * escondem no meio da lista plana. Agrupadas e jogadas para o fim, viram o que
 * são: pendência a resolver.
 */
export interface GrupoCaminhaoAgenda {
  caminhaoId: string | null;
  /** '' no grupo sem caminhão — o rótulo é decisão da tela. */
  caminhaoNome: string;
  /** null no grupo sem caminhão: não há capacidade a medir. */
  ocupacao: AgendaOcupacao | null;
  entregas: AgendaEntrega[];
}

/**
 * Ordena as viagens de um caminhão: cliente, depois número da OV.
 *
 * O primeiro critério é o que atende ao pedido de "pedidos do mesmo cliente
 * próximos": mesmo nome ⇒ mesma chave ⇒ ficam adjacentes por construção, sem
 * precisar de agrupamento visual por cliente. O segundo dá ordem estável entre
 * as viagens desse cliente, e é numérico porque nº de OV cresce como número
 * ('9' antes de '10'), não como texto.
 *
 * Cliente sem nome cai no fim: é dado incompleto, não é o "cliente A".
 */
function compararEntregas(a: AgendaEntrega, b: AgendaEntrega): number {
  const nomeA = a.clienteNome.trim();
  const nomeB = b.clienteNome.trim();
  if (nomeA !== nomeB) {
    if (nomeA === '') return 1;
    if (nomeB === '') return -1;
    const porNome = nomeA.localeCompare(nomeB, 'pt-BR', { sensitivity: 'base' });
    if (porNome !== 0) return porNome;
  }
  const porNumero = a.orixNumero.localeCompare(b.orixNumero, 'pt-BR', {
    numeric: true,
  });
  if (porNumero !== 0) return porNumero;
  // Desempate final para a ordem não depender da ordem de chegada do banco.
  return a.entregaId.localeCompare(b.entregaId);
}

/**
 * Agrupa as viagens de um slot por caminhão, cada grupo já ordenado.
 *
 * A ordem dos grupos segue `slot.ocupacao`, que o backend já devolve ordenada
 * por nome de caminhão — assim a agenda e a lista de barras contam a mesma
 * história. Um caminhão citado numa viagem mas ausente da ocupação não deveria
 * acontecer (a ocupação nasce das viagens), mas se acontecer ele entra depois,
 * por nome, em vez de a viagem desaparecer da tela.
 */
export function agruparSlotPorCaminhao(slot: AgendaSlot): GrupoCaminhaoAgenda[] {
  const porCaminhao = new Map<string, AgendaEntrega[]>();
  const semCaminhao: AgendaEntrega[] = [];

  for (const entrega of slot.entregas) {
    if (entrega.caminhaoId === null) {
      semCaminhao.push(entrega);
      continue;
    }
    const atual = porCaminhao.get(entrega.caminhaoId);
    if (atual) atual.push(entrega);
    else porCaminhao.set(entrega.caminhaoId, [entrega]);
  }

  const grupos: GrupoCaminhaoAgenda[] = [];

  // 1) Na ordem das barras de ocupação.
  for (const ocupacao of slot.ocupacao) {
    const entregas = porCaminhao.get(ocupacao.caminhaoId);
    if (!entregas) continue;
    porCaminhao.delete(ocupacao.caminhaoId);
    grupos.push({
      caminhaoId: ocupacao.caminhaoId,
      caminhaoNome: ocupacao.caminhaoNome,
      ocupacao,
      entregas: [...entregas].sort(compararEntregas),
    });
  }

  // 2) Sobras sem barra (defensivo), por nome.
  const sobras = [...porCaminhao.entries()]
    .map(([caminhaoId, entregas]) => ({
      caminhaoId,
      caminhaoNome: entregas[0]?.caminhaoNome ?? '',
      ocupacao: null,
      entregas: [...entregas].sort(compararEntregas),
    }))
    .sort((a, b) => a.caminhaoNome.localeCompare(b.caminhaoNome, 'pt-BR'));
  grupos.push(...sobras);

  // 3) Sem caminhão, sempre por último.
  if (semCaminhao.length > 0) {
    grupos.push({
      caminhaoId: null,
      caminhaoNome: '',
      ocupacao: null,
      entregas: [...semCaminhao].sort(compararEntregas),
    });
  }

  return grupos;
}

/**
 * Recorta os slots para um caminhão só — a "agenda do caminhão" da tela de Rota.
 *
 * Filtra `entregas` E `ocupacao`: deixar a ocupação inteira faria a barra
 * continuar mostrando os outros caminhões do dia, que é justamente a confusão
 * que este arquivo existe para desfazer. Slots que ficam sem viagem nenhuma
 * saem do resultado.
 */
export function filtrarSlotsPorCaminhao(
  slots: readonly AgendaSlot[],
  caminhaoId: string,
): AgendaSlot[] {
  const resultado: AgendaSlot[] = [];
  for (const slot of slots) {
    const entregas = slot.entregas.filter((e) => e.caminhaoId === caminhaoId);
    if (entregas.length === 0) continue;
    resultado.push({
      ...slot,
      entregas,
      ocupacao: slot.ocupacao.filter((o) => o.caminhaoId === caminhaoId),
    });
  }
  return resultado;
}
