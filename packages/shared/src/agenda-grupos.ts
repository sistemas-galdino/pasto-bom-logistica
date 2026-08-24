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

import type {
  AgendaEntrega,
  AgendaOcupacao,
  AgendaReserva,
  AgendaSlot,
} from "./types/domain.js";

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
  /**
   * Reservas do caminhão no slot. Sempre vazia no grupo sem caminhão: reserva
   * exige caminhão (é o caminhão que ela existe para ocupar). Um grupo pode ter
   * reserva e NENHUMA entrega — é o caminhão que foi para a oficina.
   */
  reservas: AgendaReserva[];
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
    if (nomeA === "") return 1;
    if (nomeB === "") return -1;
    const porNome = nomeA.localeCompare(nomeB, "pt-BR", {
      sensitivity: "base",
    });
    if (porNome !== 0) return porNome;
  }
  const porNumero = a.orixNumero.localeCompare(b.orixNumero, "pt-BR", {
    numeric: true,
  });
  if (porNumero !== 0) return porNumero;
  // Desempate final para a ordem não depender da ordem de chegada do banco.
  return a.entregaId.localeCompare(b.entregaId);
}

/**
 * Ordena as reservas de um caminhão: serviço, depois id.
 *
 * Por serviço porque é o título do card (o que a pessoa lê), e por id só para a
 * ordem não depender da ordem de chegada do banco.
 */
function compararReservas(a: AgendaReserva, b: AgendaReserva): number {
  const porServico = a.servico
    .trim()
    .localeCompare(b.servico.trim(), "pt-BR", { sensitivity: "base" });
  if (porServico !== 0) return porServico;
  return a.reservaId.localeCompare(b.reservaId);
}

/**
 * Agrupa as viagens de um slot por caminhão, cada grupo já ordenado.
 *
 * A ordem dos grupos segue `slot.ocupacao`, que o backend já devolve ordenada
 * por nome de caminhão — assim a agenda e a lista de barras contam a mesma
 * história. Um caminhão citado numa viagem mas ausente da ocupação não deveria
 * acontecer (a ocupação nasce das viagens e das reservas), mas se acontecer ele
 * entra depois, por nome, em vez de a viagem desaparecer da tela.
 *
 * As RESERVAS entram no grupo do caminhão delas e podem CRIAR um grupo que
 * nenhuma entrega criaria — o caminhão que passa a manhã na oficina. Ficam antes
 * das entregas no grupo porque são o contexto do caminhão naquele período: quem
 * lê precisa saber que ele está tomado antes de ler o que ele leva.
 */
export function agruparSlotPorCaminhao(
  slot: AgendaSlot,
): GrupoCaminhaoAgenda[] {
  const porCaminhao = new Map<string, AgendaEntrega[]>();
  const reservasPorCaminhao = new Map<string, AgendaReserva[]>();
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

  for (const reserva of slot.reservas ?? []) {
    const atual = reservasPorCaminhao.get(reserva.caminhaoId);
    if (atual) atual.push(reserva);
    else reservasPorCaminhao.set(reserva.caminhaoId, [reserva]);
  }

  const grupos: GrupoCaminhaoAgenda[] = [];

  // 1) Na ordem das barras de ocupação.
  for (const ocupacao of slot.ocupacao) {
    const entregas = porCaminhao.get(ocupacao.caminhaoId) ?? [];
    const reservas = reservasPorCaminhao.get(ocupacao.caminhaoId) ?? [];
    // Uma reserva sozinha JÁ é motivo para o grupo existir: é o caminhão que
    // está tomado sem levar nada. Sair daqui por falta de entrega apagaria da
    // tela exatamente a informação que a reserva existe para dar.
    if (entregas.length === 0 && reservas.length === 0) continue;
    porCaminhao.delete(ocupacao.caminhaoId);
    reservasPorCaminhao.delete(ocupacao.caminhaoId);
    grupos.push({
      caminhaoId: ocupacao.caminhaoId,
      caminhaoNome: ocupacao.caminhaoNome,
      ocupacao,
      reservas: [...reservas].sort(compararReservas),
      entregas: [...entregas].sort(compararEntregas),
    });
  }

  // 2) Sobras sem barra (defensivo), por nome — de entrega ou de reserva.
  const idsSobrando = new Set([
    ...porCaminhao.keys(),
    ...reservasPorCaminhao.keys(),
  ]);
  const sobras = [...idsSobrando]
    .map((caminhaoId) => {
      const entregas = porCaminhao.get(caminhaoId) ?? [];
      const reservas = reservasPorCaminhao.get(caminhaoId) ?? [];
      return {
        caminhaoId,
        caminhaoNome:
          entregas[0]?.caminhaoNome ?? reservas[0]?.caminhaoNome ?? "",
        ocupacao: null,
        reservas: [...reservas].sort(compararReservas),
        entregas: [...entregas].sort(compararEntregas),
      };
    })
    .sort((a, b) => a.caminhaoNome.localeCompare(b.caminhaoNome, "pt-BR"));
  grupos.push(...sobras);

  // 3) Sem caminhão, sempre por último. Nunca tem reserva: ela exige caminhão.
  if (semCaminhao.length > 0) {
    grupos.push({
      caminhaoId: null,
      caminhaoNome: "",
      ocupacao: null,
      reservas: [],
      entregas: [...semCaminhao].sort(compararEntregas),
    });
  }

  return grupos;
}

/**
 * Recorta os slots para um caminhão só — a "agenda do caminhão" da tela de Rota.
 *
 * Filtra `entregas`, `reservas` E `ocupacao`: deixar a ocupação inteira faria a
 * barra continuar mostrando os outros caminhões do dia, que é justamente a
 * confusão que este arquivo existe para desfazer. Slots que ficam sem viagem
 * NEM reserva saem do resultado — um slot em que o caminhão só tem reserva
 * FICA, porque é dia ocupado dele.
 */
export function filtrarSlotsPorCaminhao(
  slots: readonly AgendaSlot[],
  caminhaoId: string,
): AgendaSlot[] {
  const resultado: AgendaSlot[] = [];
  for (const slot of slots) {
    const entregas = slot.entregas.filter((e) => e.caminhaoId === caminhaoId);
    const reservas = (slot.reservas ?? []).filter(
      (r) => r.caminhaoId === caminhaoId,
    );
    if (entregas.length === 0 && reservas.length === 0) continue;
    resultado.push({
      ...slot,
      entregas,
      reservas,
      ocupacao: slot.ocupacao.filter((o) => o.caminhaoId === caminhaoId),
    });
  }
  return resultado;
}
