import { describe, it, expect } from 'vitest';
import { mapearWmo, type IconeClima } from './clima.js';

describe('mapearWmo', () => {
  it.each<[number, IconeClima]>([
    [0, 'sol'],
    [1, 'sol'],
    [2, 'poucas_nuvens'],
    [3, 'nublado'],
    [45, 'nevoeiro'],
    [48, 'nevoeiro'],
    [51, 'chuva'], // garoa
    [61, 'chuva'], // chuva fraca
    [63, 'chuva'], // chuva
    [65, 'chuva_forte'], // chuva forte
    [80, 'chuva'], // pancadas
    [82, 'chuva_forte'], // pancadas fortes
    [71, 'neve'],
    [86, 'neve'], // pancadas de neve
    [95, 'tempestade'],
    [99, 'tempestade'], // trovoada com granizo
  ])('código %i → ícone %s', (codigo, icone) => {
    expect(mapearWmo(codigo).icone).toBe(icone);
  });

  it('código desconhecido cai em "desconhecido"', () => {
    const r = mapearWmo(1234);
    expect(r.icone).toBe('desconhecido');
    expect(r.descricao).toBe('Indefinido');
  });

  it('sempre devolve descrição não-vazia', () => {
    for (const c of [0, 3, 65, 95, 71, 48, 7777]) {
      expect(mapearWmo(c).descricao.length).toBeGreaterThan(0);
    }
  });

  it('distingue chuva de chuva forte', () => {
    expect(mapearWmo(63).icone).toBe('chuva');
    expect(mapearWmo(65).icone).toBe('chuva_forte');
  });
});
