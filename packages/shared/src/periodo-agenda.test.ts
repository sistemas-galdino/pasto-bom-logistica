import { describe, expect, it } from 'vitest';
import { intervaloDaVisao } from './periodo-agenda.js';

describe('intervaloDaVisao', () => {
  it('dia é só a âncora', () => {
    const r = intervaloDaVisao('dia', '2026-09-13');
    expect(r).toEqual({
      inicio: '2026-09-13',
      fim: '2026-09-13',
      dias: ['2026-09-13'],
    });
  });

  it('semana vai de domingo a sábado', () => {
    // 16/09/2026 é uma quarta-feira.
    const r = intervaloDaVisao('semana', '2026-09-16');
    expect(r.inicio).toBe('2026-09-13');
    expect(r.fim).toBe('2026-09-19');
    expect(r.dias).toHaveLength(7);
  });

  // O erro de sinal clássico: recuar 7 dias quando já se está no domingo.
  it('âncora que já é domingo não recua uma semana', () => {
    const r = intervaloDaVisao('semana', '2026-09-13');
    expect(r.inicio).toBe('2026-09-13');
    expect(r.fim).toBe('2026-09-19');
  });

  it('âncora no sábado fecha a semana nela mesma', () => {
    const r = intervaloDaVisao('semana', '2026-09-19');
    expect(r.inicio).toBe('2026-09-13');
    expect(r.fim).toBe('2026-09-19');
  });

  it('semana atravessando a virada de mês não perde nem duplica dia', () => {
    const r = intervaloDaVisao('semana', '2026-09-30');
    expect(r.dias).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
  });

  it('semana atravessando a virada de ano', () => {
    const r = intervaloDaVisao('semana', '2026-12-31');
    expect(r.inicio).toBe('2026-12-27');
    expect(r.fim).toBe('2027-01-02');
    expect(new Set(r.dias).size).toBe(7);
  });

  it('mês vira grade completa, sempre múltiplo de 7', () => {
    const r = intervaloDaVisao('mes', '2026-09-13');
    expect(r.inicio).toBe('2026-08-30');
    expect(r.fim).toBe('2026-10-03');
    expect(r.dias.length % 7).toBe(0);
    expect(r.dias).toHaveLength(35);
  });

  // Um setembro que não pode virar 31/08: dia 1 é terça, então a grade recua.
  it('a grade do mês inclui os dias do mês anterior, e eles existem', () => {
    const r = intervaloDaVisao('mes', '2026-09-01');
    expect(r.dias[0]).toBe('2026-08-30');
    expect(r.dias[1]).toBe('2026-08-31');
    expect(r.dias).toContain('2026-09-01');
    expect(r.dias).not.toContain('2026-08-32');
  });

  it('mês que começa num domingo não ganha uma semana em branco na frente', () => {
    // 01/11/2026 é domingo.
    const r = intervaloDaVisao('mes', '2026-11-15');
    expect(r.inicio).toBe('2026-11-01');
  });

  it('mês que termina num sábado não ganha uma semana em branco no fim', () => {
    // 31/10/2026 é sábado.
    const r = intervaloDaVisao('mes', '2026-10-10');
    expect(r.fim).toBe('2026-10-31');
    expect(r.dias.length % 7).toBe(0);
  });

  it('fevereiro bissexto entra inteiro', () => {
    const r = intervaloDaVisao('mes', '2028-02-10');
    expect(r.dias).toContain('2028-02-29');
    expect(r.dias).not.toContain('2028-02-30');
  });

  it('fevereiro comum para no dia 28', () => {
    const r = intervaloDaVisao('mes', '2026-02-10');
    expect(r.dias).toContain('2026-02-28');
    expect(r.dias).not.toContain('2026-02-29');
  });

  it('dezembro rola o ano sem caso especial', () => {
    const r = intervaloDaVisao('mes', '2026-12-15');
    expect(r.dias).toContain('2026-12-31');
    expect(r.fim).toBe('2027-01-02');
  });

  it('janeiro puxa dias de dezembro do ano anterior', () => {
    const r = intervaloDaVisao('mes', '2027-01-15');
    expect(r.inicio).toBe('2026-12-27');
  });

  it('os dias são contíguos, sem buraco e sem repetição', () => {
    const r = intervaloDaVisao('mes', '2026-09-13');
    expect(new Set(r.dias).size).toBe(r.dias.length);
    expect(r.dias[0]).toBe(r.inicio);
    expect(r.dias[r.dias.length - 1]).toBe(r.fim);
    for (let i = 1; i < r.dias.length; i += 1) {
      const anterior = Date.parse(`${r.dias[i - 1]}T00:00:00Z`);
      const atual = Date.parse(`${r.dias[i]}T00:00:00Z`);
      expect(atual - anterior).toBe(86_400_000);
    }
  });

  // Date.UTC(2027, 1, 30) não reclama: rola para 02/03. Sem o round-trip, uma
  // data impossível viraria calendário começando no dia errado, em silêncio.
  it('data que não existe é recusada, não rolada', () => {
    expect(() => intervaloDaVisao('semana', '2027-02-29')).toThrow(/inválida/i);
    expect(() => intervaloDaVisao('dia', '2026-13-01')).toThrow(/inválida/i);
    expect(() => intervaloDaVisao('mes', '13/09/2026')).toThrow(/inválida/i);
  });
});
