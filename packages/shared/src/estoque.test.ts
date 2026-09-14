import { describe, expect, it } from 'vitest';
import { avaliarEstoque, horasDesde } from './estoque.js';

describe('avaliarEstoque', () => {
  it('estoque suficiente não avisa', () => {
    const r = avaliarEstoque({ quantidadeEstoque: 100, quantidadePedida: 40 });
    expect(r.nivel).toBe('ok');
    expect(r.avisar).toBe(false);
  });

  it('mandar exatamente o que tem ainda é ok', () => {
    const r = avaliarEstoque({ quantidadeEstoque: 40, quantidadePedida: 40 });
    expect(r.nivel).toBe('ok');
    expect(r.avisar).toBe(false);
  });

  it('mandar mais do que tem avisa, com o que falta', () => {
    // O caso do teste de aceitação: agendar 100 de um produto com estoque 40.
    const r = avaliarEstoque({ quantidadeEstoque: 40, quantidadePedida: 100 });
    expect(r.nivel).toBe('insuficiente');
    expect(r.avisar).toBe(true);
    expect(r.faltamUnidades).toBe(60);
  });

  it('estoque zero com pedido positivo é insuficiente', () => {
    const r = avaliarEstoque({ quantidadeEstoque: 0, quantidadePedida: 5 });
    expect(r.nivel).toBe('insuficiente');
    expect(r.faltamUnidades).toBe(5);
  });

  // A distinção que o arquivo existe para proteger.
  it('null é DESCONHECIDO, não zero — e não avisa', () => {
    const r = avaliarEstoque({ quantidadeEstoque: null, quantidadePedida: 100 });
    expect(r.nivel).toBe('desconhecido');
    expect(r.avisar).toBe(false);
    expect(r.faltamUnidades).toBe(0);
  });

  it('undefined e NaN caem no mesmo caso de desconhecido', () => {
    expect(
      avaliarEstoque({ quantidadeEstoque: undefined, quantidadePedida: 10 }).nivel,
    ).toBe('desconhecido');
    expect(
      avaliarEstoque({ quantidadeEstoque: Number.NaN, quantidadePedida: 10 }).nivel,
    ).toBe('desconhecido');
  });

  it('estoque negativo avisa sozinho, mesmo sem nada sendo mandado', () => {
    const r = avaliarEstoque({ quantidadeEstoque: -12, quantidadePedida: 0 });
    expect(r.nivel).toBe('negativo');
    expect(r.avisar).toBe(true);
  });

  it('estoque negativo com pedido conta o buraco inteiro', () => {
    const r = avaliarEstoque({ quantidadeEstoque: -12, quantidadePedida: 8 });
    expect(r.nivel).toBe('negativo');
    expect(r.faltamUnidades).toBe(20);
  });

  it('item que não vai nesta viagem não avisa', () => {
    // O item está na tela com quantidade 0 — a pessoa já decidiu deixá-lo fora.
    const r = avaliarEstoque({ quantidadeEstoque: 0, quantidadePedida: 0 });
    expect(r.avisar).toBe(false);
  });

  // O produto 08402, medido contra a API em 14/09/2026.
  it('lixo de ponto flutuante não vira estoque negativo', () => {
    const r = avaliarEstoque({
      quantidadeEstoque: -4.44089209850063e-16,
      quantidadePedida: 0,
    });
    expect(r.nivel).toBe('ok');
    expect(r.avisar).toBe(false);
  });

  it('quantidade pedida ilegível conta como zero', () => {
    const r = avaliarEstoque({
      quantidadeEstoque: 10,
      quantidadePedida: Number.NaN,
    });
    expect(r.nivel).toBe('ok');
  });

  it('funciona com fração (adubo vendido a granel)', () => {
    const r = avaliarEstoque({ quantidadeEstoque: 2.5, quantidadePedida: 3.25 });
    expect(r.nivel).toBe('insuficiente');
    expect(r.faltamUnidades).toBe(0.75);
  });
});

describe('horasDesde', () => {
  const AGORA = Date.parse('2026-09-14T12:00:00.000Z');

  it('conta as horas desde a leitura', () => {
    expect(horasDesde('2026-09-14T10:00:00.000Z', AGORA)).toBe(2);
  });

  it('meia hora vira fração', () => {
    expect(horasDesde('2026-09-14T11:30:00.000Z', AGORA)).toBe(0.5);
  });

  it('data ausente ou ilegível devolve null', () => {
    expect(horasDesde(null, AGORA)).toBeNull();
    expect(horasDesde(undefined, AGORA)).toBeNull();
    expect(horasDesde('', AGORA)).toBeNull();
    expect(horasDesde('ontem', AGORA)).toBeNull();
  });

  it('relógio torto não vira idade negativa na tela', () => {
    expect(horasDesde('2026-09-14T14:00:00.000Z', AGORA)).toBe(0);
  });
});
