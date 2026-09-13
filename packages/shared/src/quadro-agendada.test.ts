import { describe, expect, it } from 'vitest';
import { ordenarCartoesAgendada, type ItemAgendado } from './quadro-agendada.js';

interface E extends ItemAgendado {
  id: string;
}
interface R extends ItemAgendado {
  id: string;
}

const e = (id: string, dataAgendada: string, periodo: E['periodo'] = 'manha'): E => ({
  id,
  dataAgendada,
  periodo,
});
const r = (id: string, dataAgendada: string, periodo: 'manha' | 'tarde' = 'manha'): R => ({
  id,
  dataAgendada,
  periodo,
});

/** Rótulo curto para o teste falhar dizendo a ORDEM, e não "objeto != objeto". */
function chaves(cartoes: ReturnType<typeof ordenarCartoesAgendada<E, R>>): string[] {
  return cartoes.map((c) =>
    c.tipo === 'entrega' ? `E:${c.entrega.id}` : `R:${c.reserva.id}`,
  );
}

describe('ordenarCartoesAgendada', () => {
  it('intercala pela data, e não empilha reserva no topo', () => {
    // É a regressão que a mudança existe para evitar: a reserva do mês que vem
    // acima da entrega de amanhã.
    const ordem = ordenarCartoesAgendada(
      [e('amanha', '2026-09-14'), e('mes-que-vem', '2026-10-20')],
      [r('longe', '2026-10-05')],
    );
    expect(chaves(ordem)).toEqual(['E:amanha', 'R:longe', 'E:mes-que-vem']);
  });

  it('manhã vem antes da tarde no mesmo dia', () => {
    const ordem = ordenarCartoesAgendada(
      [e('tarde', '2026-09-14', 'tarde'), e('manha', '2026-09-14', 'manha')],
      [],
    );
    expect(chaves(ordem)).toEqual(['E:manha', 'E:tarde']);
  });

  it('no mesmo slot a reserva vem antes da entrega', () => {
    const ordem = ordenarCartoesAgendada([e('x', '2026-09-14')], [r('oficina', '2026-09-14')]);
    expect(chaves(ordem)).toEqual(['R:oficina', 'E:x']);
  });

  it('reserva da tarde não sobe para a manhã do mesmo dia', () => {
    const ordem = ordenarCartoesAgendada(
      [e('manha', '2026-09-14', 'manha')],
      [r('oficina', '2026-09-14', 'tarde')],
    );
    expect(chaves(ordem)).toEqual(['E:manha', 'R:oficina']);
  });

  it('entrega sem período fica no FIM do dia, não no começo', () => {
    const ordem = ordenarCartoesAgendada(
      [e('legada', '2026-09-14', null), e('manha', '2026-09-14', 'manha')],
      [r('oficina', '2026-09-14', 'tarde')],
    );
    expect(chaves(ordem)).toEqual(['E:manha', 'R:oficina', 'E:legada']);
  });

  it('entrega sem período não vaza para o dia seguinte', () => {
    const ordem = ordenarCartoesAgendada(
      [e('legada', '2026-09-14', null), e('depois', '2026-09-15', 'manha')],
      [],
    );
    expect(chaves(ordem)).toEqual(['E:legada', 'E:depois']);
  });

  it('empate no mesmo slot preserva a ordem de entrada', () => {
    // O chamador já ordenou como quer; esta função não dá uma segunda opinião.
    const ordem = ordenarCartoesAgendada(
      [e('a', '2026-09-14'), e('b', '2026-09-14'), e('c', '2026-09-14')],
      [r('r1', '2026-09-14'), r('r2', '2026-09-14')],
    );
    expect(chaves(ordem)).toEqual(['R:r1', 'R:r2', 'E:a', 'E:b', 'E:c']);
  });

  it('só reservas: a coluna deixa de ser "Nada aqui"', () => {
    // O caso que a Onda C existia para não perder — dia sem entrega nenhuma.
    const ordem = ordenarCartoesAgendada<E, R>([], [r('so-ela', '2026-09-14')]);
    expect(chaves(ordem)).toEqual(['R:so-ela']);
  });

  it('as duas listas vazias devolvem lista vazia', () => {
    expect(ordenarCartoesAgendada<E, R>([], [])).toEqual([]);
  });

  it('não altera as listas recebidas', () => {
    const entregas = [e('b', '2026-09-15'), e('a', '2026-09-14')];
    const reservas = [r('r', '2026-09-14')];
    ordenarCartoesAgendada(entregas, reservas);
    expect(entregas.map((x) => x.id)).toEqual(['b', 'a']);
    expect(reservas.map((x) => x.id)).toEqual(['r']);
  });

  it('data comparada como texto ISO ordena virada de mês e de ano', () => {
    const ordem = ordenarCartoesAgendada(
      [e('jan', '2027-01-02'), e('dez', '2026-12-31'), e('set', '2026-09-30')],
      [r('out', '2026-10-01')],
    );
    expect(chaves(ordem)).toEqual(['E:set', 'R:out', 'E:dez', 'E:jan']);
  });
});
