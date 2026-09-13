// AS VAGAS DO DIA — quantas entregas ainda cabem em cada caminhão, e quando não
// cabem, por quê.
//
// POR QUE ISTO EXISTE
// ---------------------------------------------------------------------------
// A tela de Agendamento (09/2026) mostra, no cabeçalho de cada dia, uma faixa
// por caminhão dizendo "2/4" e oferecendo o clique que abre o agendamento já
// com data, período e caminhão preenchidos. Isso é o pedido da Natália na
// reunião de 27/08: o Johnny abria o Quadro, não sabia se o caminhão estava
// livre, ia até a Agenda, voltava e agendava.
//
// A conta parece trivial e não é — ela junta três coisas que moram em lugares
// diferentes do payload da agenda, e errar qualquer uma produz um número que
// parece certo:
//
//   1. O teto é POR DIA (`caminhao_limites`, migração 0020) e a agenda é por
//      SLOT (dia × turno). Contar por slot deixaria o caminhão levar 4 de manhã
//      e 4 à tarde com teto de 4.
//   2. Reserva com `bloqueiaCaminhao` é a trava 1 de `carga.ts` — a mais forte
//      do sistema. Oferecer vaga numa manhã reservada é fabricar um 422.
//   3. Baixar o teto NÃO desmarca o que já está agendado (a 0020 diz isso em
//      texto). `usadas: 5, max: 4` é estado legítimo, e sem tratá-lo a tela
//      desenharia "-1 vagas".
//
// O QUE ESTA REGRA NÃO É: autorização. Ela é navegação — diz onde vale a pena
// clicar. Quem recusa agendamento é `validarCargaDoAgendamento`, no servidor, e
// nenhuma trava de lá pode ser afrouxada porque a pílula disse "livre".
//
// E ela NÃO CONHECE "HOJE". Regra pura não lê relógio: quem decide não oferecer
// vaga no passado é a tela, que já sabe qual é o dia de hoje para pintar a
// coluna de hoje.

import { limiteVigente } from './limite-entregas.js';
import type { AgendaLimite, AgendaSlot, PeriodoEntrega } from './types/domain.js';

const PERIODOS: readonly PeriodoEntrega[] = ['manha', 'tarde'];

/**
 * Em que estado está a vaga de um caminhão num dia.
 *
 * `sem_teto` é um estado de verdade, e não um "livre" disfarçado: o caminhão
 * aceita agendamento (nada o recusa desde que o peso deixou de travar, em
 * 09/2026), mas ninguém configurou quantas viagens ele aguenta. A tela precisa
 * poder dizer isso em vez de inventar um número.
 */
export type EstadoVaga = 'livre' | 'cheio' | 'bloqueado' | 'sem_teto';

export interface VagaCaminhaoDia {
  caminhaoId: string;
  /** Data ISO (YYYY-MM-DD). */
  data: string;
  /** Entregas a cliente já marcadas no DIA (manhã + tarde). Reserva não conta. */
  usadas: number;
  /** Teto vigente na data, ou null quando não há janela cadastrada. */
  max: number | null;
  /** Quantas ainda cabem. 0 quando cheio, excedido, bloqueado ou sem teto. */
  livres: number;
  /** `usadas` já passou do teto — acontece quando alguém baixa o teto depois. */
  excedido: boolean;
  estado: EstadoVaga;
  /** Períodos em que uma reserva bloqueia este caminhão neste dia. */
  periodosBloqueados: PeriodoEntrega[];
  /** Os períodos que sobram para agendar. Vazio = dia bloqueado inteiro. */
  periodosLivres: PeriodoEntrega[];
}

export interface OcupacaoCaminhaoDia {
  /** Entregas a cliente no DIA inteiro — é o número que o teto da 0020 conta. */
  entregasNoDia: number;
  /** Peso já marcado no SLOT pedido (entregas + reservas daquele turno). */
  usadoKgNoSlot: number;
  /** Capacidade publicada pela agenda; 0 = desconhecida (caminhão fora da frota). */
  capacidadeKg: number;
  /** Períodos do dia bloqueados por reserva. */
  periodosBloqueados: PeriodoEntrega[];
}

/**
 * O que um caminhão já tem num dia — e, no turno pedido, quanto peso.
 *
 * OS DOIS ESCOPOS SÃO DIFERENTES DE PROPÓSITO: `entregasNoDia` soma os dois
 * turnos porque o teto é diário; `usadoKgNoSlot` é só do turno porque tonelagem
 * é do caminhão naquele período. Somar tudo no mesmo escopo é o erro que faz o
 * aviso de limite falar da semana inteira quando a tela amplia a janela da
 * consulta — e ele recusaria agendamento legítimo com uma frase que parece
 * correta.
 *
 * Por isso `slots` pode conter QUALQUER janela: a função filtra por `data`.
 */
export function ocupacaoDoCaminhaoNoDia(
  slots: readonly AgendaSlot[],
  alvo: { data: string; caminhaoId: string; periodo?: PeriodoEntrega },
): OcupacaoCaminhaoDia {
  let entregasNoDia = 0;
  let usadoKgNoSlot = 0;
  let capacidadeKg = 0;
  const bloqueados = new Set<PeriodoEntrega>();

  for (const slot of slots) {
    if (slot.data !== alvo.data) continue;

    for (const o of slot.ocupacao) {
      if (o.caminhaoId !== alvo.caminhaoId) continue;
      entregasNoDia += o.entregas;
      if (o.capacidadeKg > 0) capacidadeKg = o.capacidadeKg;
      if (alvo.periodo !== undefined && slot.periodo === alvo.periodo) {
        usadoKgNoSlot += o.usadoKg;
      }
    }

    for (const r of slot.reservas) {
      if (r.caminhaoId !== alvo.caminhaoId) continue;
      if (r.bloqueiaCaminhao) bloqueados.add(slot.periodo);
    }
  }

  return {
    entregasNoDia,
    usadoKgNoSlot,
    capacidadeKg,
    periodosBloqueados: PERIODOS.filter((p) => bloqueados.has(p)),
  };
}

/** A vaga de UM caminhão num dia. */
export function vagaDoCaminhaoNoDia(
  slots: readonly AgendaSlot[],
  limites: readonly AgendaLimite[],
  alvo: { data: string; caminhaoId: string },
): VagaCaminhaoDia {
  const ocupacao = ocupacaoDoCaminhaoNoDia(slots, alvo);
  const doCaminhao = limites.filter((l) => l.caminhaoId === alvo.caminhaoId);
  const vigente = limiteVigente(doCaminhao, alvo.data);
  const max = vigente?.maxEntregasDia ?? null;

  const periodosLivres = PERIODOS.filter(
    (p) => !ocupacao.periodosBloqueados.includes(p),
  );
  const excedido = max !== null && ocupacao.entregasNoDia > max;
  const restantes = max === null ? 0 : Math.max(0, max - ocupacao.entregasNoDia);

  // A ORDEM DESTES TESTES É A REGRA. O bloqueio vem primeiro porque é a trava
  // mais forte: caminhão na oficina o dia inteiro não tem vaga nenhuma, tenha o
  // teto que tiver. Depois o teto ausente, que não é "cheio" nem "livre com N".
  let estado: EstadoVaga;
  if (periodosLivres.length === 0) estado = 'bloqueado';
  else if (max === null) estado = 'sem_teto';
  else if (restantes === 0) estado = 'cheio';
  else estado = 'livre';

  return {
    caminhaoId: alvo.caminhaoId,
    data: alvo.data,
    usadas: ocupacao.entregasNoDia,
    max,
    livres: estado === 'livre' ? restantes : 0,
    excedido,
    estado,
    periodosBloqueados: ocupacao.periodosBloqueados,
    periodosLivres,
  };
}

/**
 * As vagas de TODOS os caminhões num dia, na ordem em que a frota veio.
 *
 * A ARMADILHA QUE ESTA ASSINATURA EVITA: quem chama precisa passar os slots
 * COMPLETOS e a lista de dias do intervalo, nunca o resultado de
 * `filtrarSlotsPorCaminhao` nem os slots que a agenda devolveu. Os dois cortam
 * o que está vazio — `filtrarSlotsPorCaminhao` descarta o slot sem entrega e
 * sem reserva daquele caminhão, e `GET /agenda` nem emite slot vazio. O dia
 * MAIS LIVRE, o que tem todas as vagas, é justamente o que some. Por isso a
 * data entra por parâmetro: a vaga existe por causa do calendário, não por
 * causa do que já está marcado nele.
 */
export function vagasDoDia(
  slots: readonly AgendaSlot[],
  limites: readonly AgendaLimite[],
  data: string,
  caminhaoIds: readonly string[],
): VagaCaminhaoDia[] {
  return caminhaoIds.map((caminhaoId) =>
    vagaDoCaminhaoNoDia(slots, limites, { data, caminhaoId }),
  );
}

/**
 * Texto curto do estado, para a pílula e o `title`.
 *
 * Fica no shared junto da regra porque cada variante corresponde a um ramo dela
 * — escrever o texto na tela deixaria a frase e a condição livres para
 * divergirem (é o que aconteceu com "as duas regras valem juntas", que ficou
 * dois meses mentindo depois que a tonelagem parou de travar).
 */
export function rotuloDaVaga(vaga: VagaCaminhaoDia): string {
  if (vaga.estado === 'bloqueado') return 'Caminhão reservado o dia todo';
  if (vaga.estado === 'sem_teto') {
    const n = vaga.usadas;
    return `${n} ${n === 1 ? 'viagem' : 'viagens'} · sem teto`;
  }
  if (vaga.excedido) return `${vaga.max}/${vaga.max} (${vaga.usadas} marcadas)`;
  return `${vaga.usadas}/${vaga.max}`;
}
