import { describe, it, expect } from 'vitest';
import {
  avaliarPesoAgendamento,
  type LinhaPeso,
} from './peso-agendamento.js';

// O caso do print da Natália (12/08/2026): o gesso não tem peso, o calcário tem.
const GESSO: LinhaPeso = {
  produtoCodigo: '14061',
  nomeProduto: 'GESSO AGRICOLA TONELADA CARRETA',
  pesoUnitKg: null,
  pesoOrigem: null,
};
const CALCARIO: LinhaPeso = {
  produtoCodigo: '14272',
  nomeProduto: 'CALCARIO ITAPEVA 20%MAG TONELADA RODOTREM 50T',
  pesoUnitKg: 1000,
  pesoOrigem: 'auto',
};
const SOJA: LinhaPeso = {
  produtoCodigo: '90001',
  nomeProduto: 'SOJA EM GRAOS',
  pesoUnitKg: 60,
  pesoOrigem: 'manual',
};

function avaliar(
  linhas: LinhaPeso[],
  quantidades: Record<string, number>,
  pesos: Record<string, number> = {},
  confirmados: string[] = [],
) {
  return avaliarPesoAgendamento({
    linhas,
    quantidades: new Map(Object.entries(quantidades)),
    pesosInformados: new Map(Object.entries(pesos)),
    confirmados: new Set(confirmados),
  });
}

describe('avaliarPesoAgendamento — produto sem peso', () => {
  it('trava o agendamento e diz qual produto falta', () => {
    const r = avaliar([GESSO, CALCARIO], { '14061': 50, '14272': 133.4 });
    expect(r.podeAgendar).toBe(false);
    expect(r.faltando.map((f) => f.produtoCodigo)).toEqual(['14061']);
  });

  it('destrava quando o peso é digitado', () => {
    const r = avaliar(
      [GESSO, CALCARIO],
      { '14061': 50, '14272': 133.4 },
      { '14061': 1000 },
    );
    expect(r.podeAgendar).toBe(true);
    expect(r.faltando).toEqual([]);
    expect(r.pesosFinais.get('14061')).toBe(1000);
  });

  it('peso digitado zero ou negativo não vale', () => {
    expect(avaliar([GESSO], { '14061': 50 }, { '14061': 0 }).podeAgendar).toBe(
      false,
    );
    expect(avaliar([GESSO], { '14061': 50 }, { '14061': -3 }).podeAgendar).toBe(
      false,
    );
  });

  // Se ela não vai levar o gesso nesta viagem, exigir o peso dele seria pedir um
  // dado que não muda decisão nenhuma.
  it('produto com quantidade zero não trava', () => {
    const r = avaliar([GESSO, CALCARIO], { '14061': 0, '14272': 133.4 });
    expect(r.podeAgendar).toBe(true);
    expect(r.pesosFinais.has('14061')).toBe(false);
  });

  it('produto fora da viagem também não entra no peso final', () => {
    const r = avaliar([CALCARIO], {});
    expect(r.podeAgendar).toBe(true);
    expect(r.pesosFinais.size).toBe(0);
  });
});

describe('avaliarPesoAgendamento — peso manual pede conferência', () => {
  it('a soja pede confirmação a cada agendamento', () => {
    const r = avaliar([SOJA], { '90001': 200 });
    expect(r.podeAgendar).toBe(false);
    expect(r.aConfirmar.map((c) => c.produtoCodigo)).toEqual(['90001']);
    // O peso está lá — o que falta é o aval humano, não o dado.
    expect(r.aConfirmar[0].pesoUnitKg).toBe(60);
  });

  it('marcar o checkbox libera', () => {
    const r = avaliar([SOJA], { '90001': 200 }, {}, ['90001']);
    expect(r.podeAgendar).toBe(true);
    expect(r.pesosFinais.get('90001')).toBe(60);
  });

  // Quem digitou um peso novo acabou de olhar o número: exigir o checkbox
  // depois disso seria burocracia.
  it('digitar um peso novo já conta como confirmar', () => {
    const r = avaliar([SOJA], { '90001': 200 }, { '90001': 58 });
    expect(r.podeAgendar).toBe(true);
    expect(r.pesosFinais.get('90001')).toBe(58);
  });

  // O ruído que NÃO queremos: pedir confirmação do que veio do nome do produto.
  it('peso automático não pede confirmação nenhuma', () => {
    const r = avaliar([CALCARIO], { '14272': 133.4 });
    expect(r.podeAgendar).toBe(true);
    expect(r.aConfirmar).toEqual([]);
  });
});

describe('avaliarPesoAgendamento — arestas', () => {
  it('o peso é do PRODUTO: linha repetida conta uma vez só', () => {
    const r = avaliar([GESSO, { ...GESSO }], { '14061': 50 });
    expect(r.faltando).toHaveLength(1);
  });

  it('soma faltando e a confirmar sem se confundir', () => {
    const r = avaliar([GESSO, SOJA, CALCARIO], {
      '14061': 10,
      '90001': 20,
      '14272': 30,
    });
    expect(r.faltando.map((f) => f.produtoCodigo)).toEqual(['14061']);
    expect(r.aConfirmar.map((c) => c.produtoCodigo)).toEqual(['90001']);
    expect(r.podeAgendar).toBe(false);
  });

  it('lista vazia pode agendar (a trava de quantidade é outra)', () => {
    expect(avaliar([], {}).podeAgendar).toBe(true);
  });

  it('quantidade inválida não trava nem entra na conta', () => {
    const r = avaliar([GESSO], { '14061': Number.NaN });
    expect(r.podeAgendar).toBe(true);
    expect(r.pesosFinais.size).toBe(0);
  });

  it('produto sem código é ignorado', () => {
    const r = avaliar([{ ...GESSO, produtoCodigo: '' }], { '': 10 });
    expect(r.faltando).toEqual([]);
  });
});
