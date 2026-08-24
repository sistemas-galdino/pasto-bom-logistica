import { describe, expect, it } from 'vitest';

import {
  compararParadas,
  ordenarParadas,
  type ParadaOrdenavel,
} from './rota-ordem.js';

function parada(over: Partial<ParadaOrdenavel> = {}): ParadaOrdenavel {
  return {
    id: 'e1',
    ordemRota: null,
    periodo: 'manha',
    clienteNome: 'Fazenda Boa Vista',
    ...over,
  };
}

const ids = (lista: ParadaOrdenavel[]): string[] => lista.map((p) => p.id);

describe('ordenarParadas', () => {
  it('respeita a ordem informada pelo motorista', () => {
    const lista = [
      parada({ id: 'c', ordemRota: 3 }),
      parada({ id: 'a', ordemRota: 1 }),
      parada({ id: 'b', ordemRota: 2 }),
    ];
    expect(ids(ordenarParadas(lista))).toEqual(['a', 'b', 'c']);
  });

  it('põe as NÃO sequenciadas depois de todas as sequenciadas', () => {
    // O ponto central: null não é "parada zero", é "ainda não entrou na fila".
    const lista = [
      parada({ id: 'sem-1' }),
      parada({ id: 'com-9', ordemRota: 9 }),
      parada({ id: 'sem-2', clienteNome: 'Zebu Agro' }),
    ];
    expect(ids(ordenarParadas(lista))).toEqual(['com-9', 'sem-1', 'sem-2']);
  });

  it('sem sequência nenhuma, ordena por período e depois por cliente', () => {
    const lista = [
      parada({ id: 'tarde-a', periodo: 'tarde', clienteNome: 'Agro Alfa' }),
      parada({ id: 'manha-z', periodo: 'manha', clienteNome: 'Zebu Agro' }),
      parada({ id: 'manha-a', periodo: 'manha', clienteNome: 'Agro Alfa' }),
    ];
    expect(ids(ordenarParadas(lista))).toEqual([
      'manha-a',
      'manha-z',
      'tarde-a',
    ]);
  });

  it('ignora acento e caixa no nome do cliente', () => {
    const lista = [
      parada({ id: 'b', clienteNome: 'irmãos silva' }),
      parada({ id: 'a', clienteNome: 'Fazenda Água Boa' }),
    ];
    expect(ids(ordenarParadas(lista))).toEqual(['a', 'b']);
  });

  it('cliente sem nome vai para o fim', () => {
    const lista = [
      parada({ id: 'vazio', clienteNome: '   ' }),
      parada({ id: 'zebu', clienteNome: 'Zebu Agro' }),
    ];
    expect(ids(ordenarParadas(lista))).toEqual(['zebu', 'vazio']);
  });

  it('período nulo vai depois de manhã e tarde', () => {
    const lista = [
      parada({ id: 'nulo', periodo: null }),
      parada({ id: 'tarde', periodo: 'tarde' }),
      parada({ id: 'manha', periodo: 'manha' }),
    ];
    expect(ids(ordenarParadas(lista))).toEqual(['manha', 'tarde', 'nulo']);
  });

  it('empate de ordem (o banco permite) desempata estável, sem travar', () => {
    // Não há unique em (data, caminhão, ordem) de propósito: erro de banco na
    // estrada é pior que ordem duplicada. Então o empate tem de sair resolvido.
    const lista = [
      parada({ id: 'z', ordemRota: 2, clienteNome: 'Zebu Agro' }),
      parada({ id: 'a', ordemRota: 2, clienteNome: 'Agro Alfa' }),
    ];
    expect(ids(ordenarParadas(lista))).toEqual(['a', 'z']);
    // E a mesma lista invertida sai igual — é o que "estável" significa aqui.
    expect(ids(ordenarParadas([...lista].reverse()))).toEqual(['a', 'z']);
  });

  it('não muta a lista original (ela vem do cache do react-query)', () => {
    const lista = [
      parada({ id: 'b', ordemRota: 2 }),
      parada({ id: 'a', ordemRota: 1 }),
    ];
    ordenarParadas(lista);
    expect(ids(lista)).toEqual(['b', 'a']);
  });

  it('compararParadas devolve 0 só para a mesma parada', () => {
    const p = parada({ ordemRota: 1 });
    expect(compararParadas(p, { ...p })).toBe(0);
  });
});
