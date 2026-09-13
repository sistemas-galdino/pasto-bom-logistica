import { describe, expect, it } from 'vitest';
import { casaBusca, normalizarBusca } from './busca-texto.js';

describe('normalizarBusca', () => {
  it('tira acento', () => {
    expect(normalizarBusca('João')).toBe('joao');
    expect(normalizarBusca('JOÃO')).toBe('joao');
    expect(normalizarBusca('Cabo Verde')).toBe('cabo verde');
  });

  it('cobre os acentos do português', () => {
    expect(normalizarBusca('ÁÉÍÓÚ àèìòù âêîôû ãõ ç ü')).toBe(
      'aeiou aeiou aeiou ao c u',
    );
  });

  it('apara o que veio do copiar-e-colar', () => {
    expect(normalizarBusca('  12345 ')).toBe('12345');
  });

  it('null e undefined viram string vazia', () => {
    expect(normalizarBusca(null)).toBe('');
    expect(normalizarBusca(undefined)).toBe('');
  });

  // O ponto do arquivo: se o regex de combinantes for redigitado errado, ESTE
  // teste cai e nenhum outro sintoma aparece.
  it('texto já composto e texto decomposto viram a mesma coisa', () => {
    const composto = 'ão';
    const decomposto = 'ão';
    expect(composto).not.toBe(decomposto);
    expect(normalizarBusca(composto)).toBe(normalizarBusca(decomposto));
  });
});

describe('casaBusca', () => {
  it('termo vazio casa com tudo', () => {
    expect(casaBusca('', ['qualquer coisa'])).toBe(true);
    expect(casaBusca('', [null])).toBe(true);
  });

  it('casa por pedaço, em qualquer um dos campos', () => {
    expect(casaBusca('verde', ['Fazenda Boa Vista', 'Cabo Verde'])).toBe(true);
    expect(casaBusca('4567', ['12345', 'Cliente'])).toBe(false);
  });

  it('casa sem acento e sem caixa', () => {
    expect(casaBusca('joao', ['João da Silva'])).toBe(true);
    expect(casaBusca('acucar', ['AÇÚCAR CRISTAL'])).toBe(true);
  });

  it('campo nulo não casa e não quebra', () => {
    expect(casaBusca('x', [null, undefined, ''])).toBe(false);
  });

  it('lista de campos vazia não casa', () => {
    expect(casaBusca('x', [])).toBe(false);
  });
});
