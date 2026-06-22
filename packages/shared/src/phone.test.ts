import { describe, it, expect } from 'vitest';
import { normalizarWhatsApp, escolherNumeroWhatsApp } from './phone.js';

describe('normalizarWhatsApp', () => {
  it.each([
    // entrada                         e164 esperado       tipo
    ['(35) 99999-8888',               '5535999998888',   'movel'],
    ['5535999998888',                 '5535999998888',   'movel'],
    ['+55 (35) 99999-8888',           '5535999998888',   'movel'],
    ['0055 35 99999-8888',            '5535999998888',   'movel'],
    ['035 99999-8888',                '5535999998888',   'movel'], // DDD com 0
    ['+055 35 99999-8888',            '5535999998888',   'movel'], // exemplo do David
    ['(35) 9988-7766',                '5535999887766',   'movel'], // legado sem o 9º dígito
  ])('reconhece móvel: %s', (entrada, e164, tipo) => {
    const r = normalizarWhatsApp(entrada);
    expect(r.tipo).toBe(tipo);
    expect(r.e164).toBe(e164);
  });

  it('classifica fixo como não-alcançável (e164 null)', () => {
    const r = normalizarWhatsApp('(35) 3201-1234');
    expect(r.tipo).toBe('fixo');
    expect(r.e164).toBeNull();
  });

  it.each([
    ['', 'vazio'],
    ['   ', 'vazio'],
    ['sem numero', 'vazio'],
    [null, 'vazio'],
    [undefined, 'vazio'],
  ])('trata vazio: %s', (entrada, tipo) => {
    const r = normalizarWhatsApp(entrada as string);
    expect(r.tipo).toBe(tipo);
    expect(r.e164).toBeNull();
  });

  it.each([
    ['123'],
    ['+1 202 555 0143'], // número estrangeiro (EUA)
  ])('rejeita irreconhecível/estrangeiro: %s', (entrada) => {
    const r = normalizarWhatsApp(entrada);
    expect(r.tipo).not.toBe('movel');
    expect(r.e164).toBeNull();
  });
});

describe('escolherNumeroWhatsApp', () => {
  it('usa o telefone quando o celular está vazio', () => {
    const r = escolherNumeroWhatsApp('', '(35) 99999-8888');
    expect(r).toEqual({ e164: '5535999998888', tipo: 'movel', origem: 'telefone' });
  });

  it('prefere o celular quando ambos são móveis', () => {
    const r = escolherNumeroWhatsApp('(35) 98888-7777', '(35) 97777-6666');
    expect(r.origem).toBe('celular');
    expect(r.tipo).toBe('movel');
    expect(r.e164).toBe('5535988887777');
  });

  it('prefere o móvel do telefone quando o celular é fixo', () => {
    const r = escolherNumeroWhatsApp('(35) 3201-1234', '(35) 98888-7777');
    expect(r.origem).toBe('telefone');
    expect(r.tipo).toBe('movel');
    expect(r.e164).toBe('5535988887777');
  });

  it('devolve fixo (sem e164) quando não há móvel', () => {
    const r = escolherNumeroWhatsApp('(35) 3201-1234', '');
    expect(r.tipo).toBe('fixo');
    expect(r.e164).toBeNull();
    expect(r.origem).toBe('celular');
  });

  it('devolve vazio quando ambos estão vazios', () => {
    const r = escolherNumeroWhatsApp('', '');
    expect(r).toEqual({ e164: null, tipo: 'vazio', origem: null });
  });
});
