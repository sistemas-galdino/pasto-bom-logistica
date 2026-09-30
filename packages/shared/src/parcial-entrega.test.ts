import { describe, it, expect } from 'vitest';
import { avaliarConclusao, temDivergencia } from './parcial-entrega.js';

const CALCARIO = { produtoCodigo: '00028', nomeProduto: 'CALCARIO ITAPEVA', qtd: 40 };
const ADUBO = { produtoCodigo: '00100', nomeProduto: 'ADUBO 20-05-20', qtd: 10 };

describe('avaliarConclusao — o caso que bate', () => {
  it('sem declaração nenhuma, vale o carregado e não diverge', () => {
    const r = avaliarConclusao([CALCARIO, ADUBO]);
    expect(r.divergiu).toBe(false);
    expect(r.erros).toEqual([]);
    expect(r.restante).toEqual([]);
    expect(r.entregues).toEqual({ '00028': 40, '00100': 10 });
  });

  it('declarar exatamente o carregado não diverge', () => {
    const r = avaliarConclusao([CALCARIO], { '00028': 40 });
    expect(r.divergiu).toBe(false);
    expect(r.restante).toEqual([]);
  });

  it('produto omitido ou null vale o carregado', () => {
    const r = avaliarConclusao([CALCARIO, ADUBO], { '00028': null });
    expect(r.entregues).toEqual({ '00028': 40, '00100': 10 });
    expect(r.divergiu).toBe(false);
  });
});

describe('avaliarConclusao — a parcial', () => {
  // Reunião de 24/09/2026: levou 40, o cliente aceitou 20.
  it('o caso da Natália: 20 de 40 devolve 20', () => {
    const r = avaliarConclusao([CALCARIO], { '00028': 20 });
    expect(r.divergiu).toBe(true);
    expect(r.entregues).toEqual({ '00028': 20 });
    expect(r.restante).toEqual([
      { produtoCodigo: '00028', nomeProduto: 'CALCARIO ITAPEVA', qtd: 20 },
    ]);
  });

  it('zero é declaração legítima: levou e não entregou nada daquele produto', () => {
    const r = avaliarConclusao([CALCARIO, ADUBO], { '00100': 0 });
    expect(r.divergiu).toBe(true);
    expect(r.restante).toEqual([
      { produtoCodigo: '00100', nomeProduto: 'ADUBO 20-05-20', qtd: 10 },
    ]);
    expect(r.entregues['00028']).toBe(40);
  });

  it('o restante lista só os produtos que voltaram', () => {
    const r = avaliarConclusao([CALCARIO, ADUBO], { '00028': 35, '00100': 10 });
    expect(r.restante.map((x) => x.produtoCodigo)).toEqual(['00028']);
    expect(r.restante[0]?.qtd).toBe(5);
  });

  it('não inventa divergência por ponto flutuante', () => {
    const r = avaliarConclusao(
      [{ produtoCodigo: 'X', nomeProduto: 'X', qtd: 0.3 }],
      { X: 0.1 + 0.2 },
    );
    expect(r.divergiu).toBe(false);
  });

  it('quantidade fracionária de verdade diverge', () => {
    const r = avaliarConclusao(
      [{ produtoCodigo: 'X', nomeProduto: 'X', qtd: 6.5 }],
      { X: 6 },
    );
    expect(r.divergiu).toBe(true);
    expect(r.restante[0]?.qtd).toBe(0.5);
  });
});

describe('avaliarConclusao — o que recusa', () => {
  it('mais do que foi carregado', () => {
    const r = avaliarConclusao([CALCARIO], { '00028': 41 });
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]?.mensagem).toContain('foram carregados 40');
    expect(r.divergiu).toBe(false);
  });

  it('negativo e NaN', () => {
    expect(avaliarConclusao([CALCARIO], { '00028': -1 }).erros).toHaveLength(1);
    expect(avaliarConclusao([CALCARIO], { '00028': Number.NaN }).erros).toHaveLength(1);
  });

  it('produto que não está na viagem', () => {
    const r = avaliarConclusao([CALCARIO], { '99999': 5 });
    expect(r.erros[0]?.produtoCodigo).toBe('99999');
  });

  it('com erro, não devolve restante — nada deve ser gravado pela metade', () => {
    const r = avaliarConclusao([CALCARIO, ADUBO], { '00028': 20, '00100': 11 });
    expect(r.erros).toHaveLength(1);
    expect(r.restante).toEqual([]);
    expect(r.divergiu).toBe(false);
  });
});

describe('temDivergencia — a tag amarela', () => {
  it('não declarado não é parcial (toda entrega anterior à 0025)', () => {
    expect(temDivergencia([{ qtd: 40, qtdEntregue: null }])).toBe(false);
  });

  it('declarado igual ao carregado não é parcial', () => {
    expect(temDivergencia([{ qtd: 40, qtdEntregue: 40 }])).toBe(false);
  });

  it('entregou menos do que levou é parcial', () => {
    expect(temDivergencia([{ qtd: 40, qtdEntregue: 40 }, { qtd: 10, qtdEntregue: 0 }])).toBe(true);
  });

  it('viagem sem itens não é parcial', () => {
    expect(temDivergencia([])).toBe(false);
  });
});
