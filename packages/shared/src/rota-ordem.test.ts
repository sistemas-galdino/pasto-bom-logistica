import { describe, expect, it } from 'vitest';

import {
  compararParadas,
  ordenarParadas,
  reordenarSubconjunto,
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

describe('reordenarSubconjunto', () => {
  const ordem = (r: { ordem: Map<string, number> }): string[] =>
    [...r.ordem.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);

  it('reordena as paradas arrastadas e numera o dia inteiro', () => {
    const lista = [
      parada({ id: 'a', ordemRota: 1 }),
      parada({ id: 'b', ordemRota: 2 }),
      parada({ id: 'c', ordemRota: 3 }),
    ];
    const r = reordenarSubconjunto(lista, ['c', 'a', 'b']);
    expect(r.erros).toEqual([]);
    expect(ordem(r)).toEqual(['c', 'a', 'b']);
    expect(r.ordem.get('c')).toBe(1);
  });

  // O motorista com viagens em dois caminhões: arrastar o grupo de um caminhão
  // não pode embaralhar o outro.
  it('as paradas que não foram arrastadas ficam onde estavam', () => {
    const lista = [
      parada({ id: 'b1', ordemRota: 1 }),
      parada({ id: 'x1', ordemRota: 2 }), // outro caminhão
      parada({ id: 'b2', ordemRota: 3 }),
      parada({ id: 'x2', ordemRota: 4 }), // outro caminhão
    ];
    const r = reordenarSubconjunto(lista, ['b2', 'b1']);
    expect(ordem(r)).toEqual(['b2', 'x1', 'b1', 'x2']);
  });

  it('arrastar a tarde não joga a manhã para depois', () => {
    const lista = [
      parada({ id: 'm1', periodo: 'manha', clienteNome: 'A' }),
      parada({ id: 'm2', periodo: 'manha', clienteNome: 'B' }),
      parada({ id: 't1', periodo: 'tarde', clienteNome: 'C' }),
      parada({ id: 't2', periodo: 'tarde', clienteNome: 'D' }),
    ];
    const r = reordenarSubconjunto(lista, ['t2', 't1']);
    expect(ordem(r)).toEqual(['m1', 'm2', 't2', 't1']);
  });

  it('congela a ordem que a tela mostrava para quem não tinha sequência', () => {
    const lista = [
      parada({ id: 'z', clienteNome: 'Zeca' }),
      parada({ id: 'a', clienteNome: 'Abel' }),
    ];
    const r = reordenarSubconjunto(lista, ['a']);
    expect(ordem(r)).toEqual(['a', 'z']);
    expect(r.ordem.size).toBe(2);
  });

  it('recusa parada de outro motorista e parada repetida', () => {
    const lista = [parada({ id: 'a' }), parada({ id: 'b' })];
    expect(reordenarSubconjunto(lista, ['a', 'zzz']).erros).toHaveLength(1);
    expect(reordenarSubconjunto(lista, ['a', 'a']).erros).toHaveLength(1);
    expect(reordenarSubconjunto(lista, ['a', 'zzz']).ordem.size).toBe(0);
  });
});
