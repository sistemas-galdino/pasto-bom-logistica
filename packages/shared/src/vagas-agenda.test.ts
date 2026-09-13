import { describe, expect, it } from 'vitest';
import {
  ocupacaoDoCaminhaoNoDia,
  rotuloDaVaga,
  vagaDoCaminhaoNoDia,
  vagasDoDia,
} from './vagas-agenda.js';
import type {
  AgendaLimite,
  AgendaOcupacao,
  AgendaReserva,
  AgendaSlot,
  PeriodoEntrega,
} from './types/domain.js';

const CARGO = 'cam-816';
const OUTRO = 'cam-1620';

function ocupacao(
  caminhaoId: string,
  entregas: number,
  usadoKg = 0,
): AgendaOcupacao {
  return {
    caminhaoId,
    caminhaoNome: caminhaoId,
    capacidadeKg: 6_500,
    usadoKg,
    motoristaId: null,
    motoristaNome: null,
    entregas,
  };
}

function reserva(caminhaoId: string, bloqueiaCaminhao: boolean): AgendaReserva {
  return {
    reservaId: `r-${caminhaoId}-${bloqueiaCaminhao ? 'b' : 'n'}`,
    servico: 'oficina',
    cidade: null,
    fornecedorNome: null,
    produtos: null,
    motoristaId: null,
    motoristaNome: null,
    caminhaoId,
    caminhaoNome: caminhaoId,
    pesoPrevistoKg: null,
    bloqueiaCaminhao,
  };
}

function slot(
  data: string,
  periodo: PeriodoEntrega,
  ocupacoes: AgendaOcupacao[] = [],
  reservas: AgendaReserva[] = [],
): AgendaSlot {
  return { data, periodo, entregas: [], ocupacao: ocupacoes, reservas };
}

const teto = (
  caminhaoId: string,
  maxEntregasDia: number,
  validoDe = '2026-01-01',
  validoAte: string | null = null,
): AgendaLimite => ({ caminhaoId, validoDe, validoAte, maxEntregasDia });

describe('ocupacaoDoCaminhaoNoDia', () => {
  // O TESTE CENTRAL da onda: o teto é por DIA, a tonelagem é por SLOT.
  it('soma entregas dos DOIS turnos, mas peso só do turno pedido', () => {
    const slots = [
      slot('2026-09-14', 'manha', [ocupacao(CARGO, 2, 3_000)]),
      slot('2026-09-14', 'tarde', [ocupacao(CARGO, 1, 1_500)]),
    ];
    const r = ocupacaoDoCaminhaoNoDia(slots, {
      data: '2026-09-14',
      caminhaoId: CARGO,
      periodo: 'manha',
    });
    expect(r.entregasNoDia).toBe(3);
    expect(r.usadoKgNoSlot).toBe(3_000);
  });

  // A REGRESSÃO SILENCIOSA que o modal de agendar corre ao ampliar a janela da
  // consulta para a semana inteira: sem filtrar por data, `entregasNoDia`
  // passaria a somar a semana e o aviso de limite recusaria agendamento
  // legítimo com uma frase que parece correta.
  it('ignora slots de OUTROS dias, mesmo vindo tudo na mesma consulta', () => {
    const slots = [
      slot('2026-09-13', 'manha', [ocupacao(CARGO, 4, 6_000)]),
      slot('2026-09-14', 'manha', [ocupacao(CARGO, 1, 1_000)]),
      slot('2026-09-15', 'tarde', [ocupacao(CARGO, 3, 5_000)]),
    ];
    const r = ocupacaoDoCaminhaoNoDia(slots, {
      data: '2026-09-14',
      caminhaoId: CARGO,
      periodo: 'manha',
    });
    expect(r.entregasNoDia).toBe(1);
    expect(r.usadoKgNoSlot).toBe(1_000);
  });

  it('ignora os outros caminhões do mesmo slot', () => {
    const slots = [
      slot('2026-09-14', 'manha', [ocupacao(CARGO, 1, 1_000), ocupacao(OUTRO, 5, 9_000)]),
    ];
    const r = ocupacaoDoCaminhaoNoDia(slots, {
      data: '2026-09-14',
      caminhaoId: CARGO,
      periodo: 'manha',
    });
    expect(r.entregasNoDia).toBe(1);
    expect(r.usadoKgNoSlot).toBe(1_000);
  });

  it('sem período pedido, o peso do slot não é somado', () => {
    const slots = [slot('2026-09-14', 'manha', [ocupacao(CARGO, 2, 3_000)])];
    const r = ocupacaoDoCaminhaoNoDia(slots, {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(r.entregasNoDia).toBe(2);
    expect(r.usadoKgNoSlot).toBe(0);
  });

  it('reserva que bloqueia marca o período; a que não bloqueia, não', () => {
    const slots = [
      slot('2026-09-14', 'manha', [], [reserva(CARGO, true)]),
      slot('2026-09-14', 'tarde', [], [reserva(CARGO, false)]),
    ];
    const r = ocupacaoDoCaminhaoNoDia(slots, {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(r.periodosBloqueados).toEqual(['manha']);
  });
});

describe('vagaDoCaminhaoNoDia', () => {
  it('dia vazio com teto 4 tem 4 vagas', () => {
    const v = vagaDoCaminhaoNoDia([], [teto(CARGO, 4)], {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(v.estado).toBe('livre');
    expect(v.usadas).toBe(0);
    expect(v.livres).toBe(4);
    expect(rotuloDaVaga(v)).toBe('0/4');
  });

  it('teto 4 com 2 de manhã e 1 à tarde deixa 1 vaga, não 2', () => {
    const slots = [
      slot('2026-09-14', 'manha', [ocupacao(CARGO, 2)]),
      slot('2026-09-14', 'tarde', [ocupacao(CARGO, 1)]),
    ];
    const v = vagaDoCaminhaoNoDia(slots, [teto(CARGO, 4)], {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(v.usadas).toBe(3);
    expect(v.livres).toBe(1);
    expect(rotuloDaVaga(v)).toBe('3/4');
  });

  it('fechar o teto é cheio, sem vaga', () => {
    const slots = [slot('2026-09-14', 'manha', [ocupacao(CARGO, 4)])];
    const v = vagaDoCaminhaoNoDia(slots, [teto(CARGO, 4)], {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(v.estado).toBe('cheio');
    expect(v.livres).toBe(0);
    expect(v.excedido).toBe(false);
  });

  // Baixar o teto NÃO desmarca o que já está agendado (a 0020 diz isso).
  it('teto baixado depois: 5 marcadas num teto de 3 não vira -2 vagas', () => {
    const slots = [slot('2026-09-14', 'manha', [ocupacao(CARGO, 5)])];
    const v = vagaDoCaminhaoNoDia(slots, [teto(CARGO, 3)], {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(v.estado).toBe('cheio');
    expect(v.excedido).toBe(true);
    expect(v.livres).toBe(0);
    expect(rotuloDaVaga(v)).toBe('3/3 (5 marcadas)');
  });

  it('sem janela cadastrada é sem_teto, e não cheio', () => {
    const slots = [slot('2026-09-14', 'manha', [ocupacao(CARGO, 2)])];
    const v = vagaDoCaminhaoNoDia(slots, [], {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(v.estado).toBe('sem_teto');
    expect(v.max).toBeNull();
    expect(v.usadas).toBe(2);
    expect(rotuloDaVaga(v)).toBe('2 viagens · sem teto');
  });

  it('sem teto e sem nenhuma viagem fala no singular certo', () => {
    const slots = [slot('2026-09-14', 'manha', [ocupacao(CARGO, 1)])];
    const v = vagaDoCaminhaoNoDia(slots, [], {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(rotuloDaVaga(v)).toBe('1 viagem · sem teto');
  });

  it('janela vencida não vale: volta a ser sem_teto', () => {
    const v = vagaDoCaminhaoNoDia([], [teto(CARGO, 4, '2026-01-01', '2026-08-31')], {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(v.estado).toBe('sem_teto');
  });

  it('janela do outro caminhão não vale para este', () => {
    const v = vagaDoCaminhaoNoDia([], [teto(OUTRO, 4)], {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(v.max).toBeNull();
  });

  it('reserva bloqueando a manhã deixa só a tarde para agendar', () => {
    const slots = [slot('2026-09-14', 'manha', [], [reserva(CARGO, true)])];
    const v = vagaDoCaminhaoNoDia(slots, [teto(CARGO, 4)], {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(v.estado).toBe('livre');
    expect(v.periodosBloqueados).toEqual(['manha']);
    expect(v.periodosLivres).toEqual(['tarde']);
  });

  // O bloqueio é a trava mais forte de carga.ts: manda mesmo com teto sobrando.
  it('caminhão reservado nos dois períodos é bloqueado, com teto vago', () => {
    const slots = [
      slot('2026-09-14', 'manha', [], [reserva(CARGO, true)]),
      slot('2026-09-14', 'tarde', [], [reserva(CARGO, true)]),
    ];
    const v = vagaDoCaminhaoNoDia(slots, [teto(CARGO, 4)], {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(v.estado).toBe('bloqueado');
    expect(v.livres).toBe(0);
    expect(v.periodosLivres).toEqual([]);
    expect(rotuloDaVaga(v)).toBe('Caminhão reservado o dia todo');
  });

  it('bloqueio manda também quando não há teto cadastrado', () => {
    const slots = [
      slot('2026-09-14', 'manha', [], [reserva(CARGO, true)]),
      slot('2026-09-14', 'tarde', [], [reserva(CARGO, true)]),
    ];
    const v = vagaDoCaminhaoNoDia(slots, [], {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(v.estado).toBe('bloqueado');
  });

  it('reserva que NÃO bloqueia deixa o dia inteiro disponível', () => {
    const slots = [slot('2026-09-14', 'manha', [], [reserva(CARGO, false)])];
    const v = vagaDoCaminhaoNoDia(slots, [teto(CARGO, 2)], {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(v.estado).toBe('livre');
    expect(v.periodosLivres).toEqual(['manha', 'tarde']);
  });

  // Reserva ocupa caminhão mas NÃO é entrega a cliente: carga.ts de propósito
  // não a passa por contarEntregasNoDia.
  it('reserva não consome vaga do teto', () => {
    const slots = [slot('2026-09-14', 'manha', [ocupacao(CARGO, 0, 2_000)], [reserva(CARGO, false)])];
    const v = vagaDoCaminhaoNoDia(slots, [teto(CARGO, 3)], {
      data: '2026-09-14',
      caminhaoId: CARGO,
    });
    expect(v.usadas).toBe(0);
    expect(v.livres).toBe(3);
  });

  it('duas janelas sobrepostas: vence a de validoDe mais recente', () => {
    const v = vagaDoCaminhaoNoDia(
      [],
      [teto(CARGO, 10, '2026-01-01'), teto(CARGO, 2, '2026-09-01')],
      { data: '2026-09-14', caminhaoId: CARGO },
    );
    expect(v.max).toBe(2);
  });
});

describe('vagasDoDia', () => {
  it('devolve uma vaga por caminhão, na ordem da frota', () => {
    const slots = [slot('2026-09-14', 'manha', [ocupacao(CARGO, 1)])];
    const vagas = vagasDoDia(slots, [teto(CARGO, 2)], '2026-09-14', [CARGO, OUTRO]);
    expect(vagas.map((v) => v.caminhaoId)).toEqual([CARGO, OUTRO]);
    expect(vagas[0]?.livres).toBe(1);
    expect(vagas[1]?.estado).toBe('sem_teto');
  });

  // A armadilha do E4: o dia MAIS LIVRE é o que some de `filtrarSlotsPorCaminhao`
  // e o que `GET /agenda` nem emite. A data entra por parâmetro justamente para
  // a vaga não depender de o dia existir no payload.
  it('dia que não aparece no payload ainda tem vagas', () => {
    const vagas = vagasDoDia([], [teto(CARGO, 4)], '2026-09-20', [CARGO]);
    expect(vagas[0]?.estado).toBe('livre');
    expect(vagas[0]?.livres).toBe(4);
  });

  it('frota vazia devolve lista vazia', () => {
    expect(vagasDoDia([], [], '2026-09-14', [])).toEqual([]);
  });
});
