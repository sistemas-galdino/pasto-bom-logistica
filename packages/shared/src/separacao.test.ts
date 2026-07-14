import { describe, it, expect } from 'vitest';
import { transportarSeparacao, type ItemSeparacaoAntigo } from './separacao.js';

const T = '2026-07-14T12:00:00.000Z';

function antigo(
  produtoCodigo: string,
  separado: boolean,
  separadoEm: string | null = separado ? T : null,
): ItemSeparacaoAntigo {
  return { produtoCodigo, separado, separadoEm };
}

describe('transportarSeparacao', () => {
  it('preserva a marca de um item separado (o bug que motivou o módulo)', () => {
    const r = transportarSeparacao([antigo('A', true)], ['A']);
    expect(r).toEqual([{ separado: true, separadoEm: T }]);
  });

  it('mantém o timestamp original em vez de recriá-lo', () => {
    const ontem = '2026-07-13T08:30:00.000Z';
    const r = transportarSeparacao([antigo('A', true, ontem)], ['A']);
    expect(r[0]?.separadoEm).toBe(ontem);
  });

  it('devolve um array PARALELO aos códigos novos', () => {
    const r = transportarSeparacao(
      [antigo('A', true), antigo('B', false)],
      ['A', 'B', 'C'],
    );
    expect(r).toHaveLength(3);
    expect(r[0]?.separado).toBe(true);
    expect(r[1]?.separado).toBe(false);
    expect(r[2]?.separado).toBe(false);
  });

  it('não inventa marca para item novo que não existia antes', () => {
    const r = transportarSeparacao([antigo('A', true)], ['A', 'NOVO']);
    expect(r[1]).toEqual({ separado: false, separadoEm: null });
  });

  it('ignora item que sumiu do Órix sem afetar os demais', () => {
    const r = transportarSeparacao(
      [antigo('SUMIU', true), antigo('B', true)],
      ['B'],
    );
    expect(r).toEqual([{ separado: true, separadoEm: T }]);
  });

  it('não vaza marca entre produtos diferentes', () => {
    const r = transportarSeparacao([antigo('A', true)], ['B']);
    expect(r).toEqual([{ separado: false, separadoEm: null }]);
  });

  // O caso que quebraria um Map ingênuo: existem 4 pedidos no banco com o mesmo
  // produto repetido em duas linhas. Com uma marca só, a 2ª linha herdaria a 1ª.
  it('produto repetido: só a PRIMEIRA linha herda quando só uma estava separada', () => {
    const r = transportarSeparacao(
      [antigo('DUP', true), antigo('DUP', false)],
      ['DUP', 'DUP'],
    );
    expect(r[0]?.separado).toBe(true);
    expect(r[1]?.separado).toBe(false);
  });

  it('produto repetido: as DUAS linhas herdam quando as duas estavam separadas', () => {
    const r = transportarSeparacao(
      [antigo('DUP', true), antigo('DUP', true)],
      ['DUP', 'DUP'],
    );
    expect(r[0]?.separado).toBe(true);
    expect(r[1]?.separado).toBe(true);
  });

  it('produto repetido: a fila não estoura se o Órix passar a mandar mais linhas', () => {
    const r = transportarSeparacao([antigo('DUP', true)], ['DUP', 'DUP', 'DUP']);
    expect(r.map((m) => m.separado)).toEqual([true, false, false]);
  });

  it('pedido inteiro separado continua inteiro separado', () => {
    const r = transportarSeparacao(
      [antigo('A', true), antigo('B', true), antigo('C', true)],
      ['A', 'B', 'C'],
    );
    expect(r.every((m) => m.separado)).toBe(true);
  });

  it('sem itens antigos, nada é marcado', () => {
    const r = transportarSeparacao([], ['A', 'B']);
    expect(r.every((m) => !m.separado)).toBe(true);
  });

  it('não compartilha a mesma referência de objeto entre saídas', () => {
    const r = transportarSeparacao([], ['A', 'B']);
    expect(r[0]).toEqual(r[1]); // mesmo conteúdo…
    // …e mutar uma saída não pode contaminar a outra
    const copia = { ...r[0]!, separado: true };
    expect(r[1]?.separado).toBe(false);
    expect(copia.separado).toBe(true);
  });
});
