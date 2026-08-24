import { describe, expect, it } from 'vitest';
import {
  agruparSlotPorCaminhao,
  filtrarSlotsPorCaminhao,
} from './agenda-grupos.js';
import type { AgendaEntrega, AgendaOcupacao, AgendaSlot } from './types/domain.js';

function entrega(over: Partial<AgendaEntrega> = {}): AgendaEntrega {
  return {
    entregaId: 'e1',
    pedidoId: 'p1',
    orixNumero: '1000',
    clienteNome: 'CLIENTE',
    bairro: null,
    cidade: 'BOTELHOS',
    motoristaId: 'm1',
    motoristaNome: 'Natália',
    caminhaoId: 'c1',
    caminhaoNome: 'Stradinha',
    pesoTotalKg: 200,
    status: 'agendada',
    ...over,
  };
}

function ocupacao(over: Partial<AgendaOcupacao> = {}): AgendaOcupacao {
  return {
    caminhaoId: 'c1',
    caminhaoNome: 'Stradinha',
    capacidadeKg: 500,
    usadoKg: 200,
    motoristaId: 'm1',
    motoristaNome: 'Natália',
    entregas: 1,
    ...over,
  };
}

function slot(over: Partial<AgendaSlot> = {}): AgendaSlot {
  return {
    data: '2026-08-19',
    periodo: 'manha',
    entregas: [],
    ocupacao: [],
    ...over,
  };
}

describe('agruparSlotPorCaminhao', () => {
  it('slot vazio não gera grupo', () => {
    expect(agruparSlotPorCaminhao(slot())).toEqual([]);
  });

  it('separa as viagens por caminhão, na ordem das barras de ocupação', () => {
    // O print da Natália: três caminhões, cards embaralhados embaixo.
    const s = slot({
      ocupacao: [
        ocupacao({ caminhaoId: 'c1', caminhaoNome: '1620', usadoKg: 16000, capacidadeKg: 16000 }),
        ocupacao({ caminhaoId: 'c2', caminhaoNome: 'Cargo 816', usadoKg: 6600, capacidadeKg: 7000 }),
        ocupacao({ caminhaoId: 'c3', caminhaoNome: 'Stradinha', usadoKg: 200, capacidadeKg: 500 }),
      ],
      entregas: [
        entrega({ entregaId: 'a', caminhaoId: 'c3', caminhaoNome: 'Stradinha', clienteNome: 'JOAO BATISTA BARBOSA' }),
        entrega({ entregaId: 'b', caminhaoId: 'c2', caminhaoNome: 'Cargo 816', clienteNome: 'PEDRO PAULO VIANA' }),
        entrega({ entregaId: 'c', caminhaoId: 'c1', caminhaoNome: '1620', clienteNome: 'JOSE DURVAL DE CARVALHO' }),
      ],
    });
    const grupos = agruparSlotPorCaminhao(s);
    expect(grupos.map((g) => g.caminhaoNome)).toEqual(['1620', 'Cargo 816', 'Stradinha']);
    expect(grupos.map((g) => g.entregas.map((e) => e.entregaId))).toEqual([['c'], ['b'], ['a']]);
  });

  it('ordena os clientes alfabeticamente dentro do caminhão', () => {
    const s = slot({
      ocupacao: [ocupacao()],
      entregas: [
        entrega({ entregaId: 'z', clienteNome: 'ZEZE' }),
        entrega({ entregaId: 'a', clienteNome: 'ANA' }),
        entrega({ entregaId: 'm', clienteNome: 'MARCOS' }),
      ],
    });
    const [grupo] = agruparSlotPorCaminhao(s);
    expect(grupo!.entregas.map((e) => e.clienteNome)).toEqual(['ANA', 'MARCOS', 'ZEZE']);
  });

  it('deixa os pedidos do mesmo cliente adjacentes e em ordem numérica de OV', () => {
    const s = slot({
      ocupacao: [ocupacao()],
      entregas: [
        entrega({ entregaId: '1', clienteNome: 'FAZENDA BOA VISTA', orixNumero: '1233' }),
        entrega({ entregaId: '2', clienteNome: 'ANA', orixNumero: '999' }),
        // Fora de ordem e com nº menor: tem de vir antes da 1233 e junto dela.
        entrega({ entregaId: '3', clienteNome: 'FAZENDA BOA VISTA', orixNumero: '984' }),
      ],
    });
    const [grupo] = agruparSlotPorCaminhao(s);
    expect(grupo!.entregas.map((e) => e.orixNumero)).toEqual(['999', '984', '1233']);
  });

  it('ordena nº de OV como número, não como texto', () => {
    const s = slot({
      ocupacao: [ocupacao()],
      entregas: [
        entrega({ entregaId: '1', orixNumero: '10' }),
        entrega({ entregaId: '2', orixNumero: '9' }),
      ],
    });
    const [grupo] = agruparSlotPorCaminhao(s);
    expect(grupo!.entregas.map((e) => e.orixNumero)).toEqual(['9', '10']);
  });

  it('ignora acentuação ao ordenar clientes', () => {
    const s = slot({
      ocupacao: [ocupacao()],
      entregas: [
        entrega({ entregaId: '1', clienteNome: 'ALVES' }),
        entrega({ entregaId: '2', clienteNome: 'ÁLVARO' }),
      ],
    });
    const [grupo] = agruparSlotPorCaminhao(s);
    expect(grupo!.entregas.map((e) => e.clienteNome)).toEqual(['ÁLVARO', 'ALVES']);
  });

  it('põe as viagens sem caminhão num grupo próprio, sempre por último', () => {
    const s = slot({
      ocupacao: [ocupacao({ caminhaoId: 'c9', caminhaoNome: 'Zebra' })],
      entregas: [
        entrega({ entregaId: 'sem', caminhaoId: null, caminhaoNome: null, clienteNome: 'AAA' }),
        entrega({ entregaId: 'com', caminhaoId: 'c9', caminhaoNome: 'Zebra', clienteNome: 'ZZZ' }),
      ],
    });
    const grupos = agruparSlotPorCaminhao(s);
    expect(grupos).toHaveLength(2);
    expect(grupos[0]!.caminhaoId).toBe('c9');
    expect(grupos[1]!.caminhaoId).toBeNull();
    expect(grupos[1]!.ocupacao).toBeNull();
    expect(grupos[1]!.entregas.map((e) => e.entregaId)).toEqual(['sem']);
  });

  it('não cria grupo sem caminhão quando todas as viagens têm caminhão', () => {
    const s = slot({ ocupacao: [ocupacao()], entregas: [entrega()] });
    expect(agruparSlotPorCaminhao(s).some((g) => g.caminhaoId === null)).toBe(false);
  });

  it('não perde a viagem de um caminhão que não veio na ocupação', () => {
    // Não deveria acontecer (a ocupação nasce das viagens), mas perder o card
    // seria pior que mostrá-lo sem barra.
    const s = slot({
      ocupacao: [],
      entregas: [entrega({ entregaId: 'orfa', caminhaoId: 'cX', caminhaoNome: 'Fantasma' })],
    });
    const grupos = agruparSlotPorCaminhao(s);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.caminhaoNome).toBe('Fantasma');
    expect(grupos[0]!.ocupacao).toBeNull();
    expect(grupos[0]!.entregas.map((e) => e.entregaId)).toEqual(['orfa']);
  });

  it('não inventa grupo para caminhão com barra mas sem viagem', () => {
    const s = slot({ ocupacao: [ocupacao({ caminhaoId: 'vazio' })], entregas: [] });
    expect(agruparSlotPorCaminhao(s)).toEqual([]);
  });

  it('cliente sem nome vai para o fim, não para o começo', () => {
    const s = slot({
      ocupacao: [ocupacao()],
      entregas: [
        entrega({ entregaId: 'anon', clienteNome: '   ' }),
        entrega({ entregaId: 'nome', clienteNome: 'ZEZE' }),
      ],
    });
    const [grupo] = agruparSlotPorCaminhao(s);
    expect(grupo!.entregas.map((e) => e.entregaId)).toEqual(['nome', 'anon']);
  });

  it('não muta o slot recebido', () => {
    const original = [
      entrega({ entregaId: 'z', clienteNome: 'ZEZE' }),
      entrega({ entregaId: 'a', clienteNome: 'ANA' }),
    ];
    const s = slot({ ocupacao: [ocupacao()], entregas: original });
    agruparSlotPorCaminhao(s);
    expect(s.entregas.map((e) => e.entregaId)).toEqual(['z', 'a']);
  });

  it('a soma das viagens dos grupos é a do slot (nenhum card se perde)', () => {
    const s = slot({
      ocupacao: [ocupacao({ caminhaoId: 'c1' }), ocupacao({ caminhaoId: 'c2' })],
      entregas: [
        entrega({ entregaId: '1', caminhaoId: 'c1' }),
        entrega({ entregaId: '2', caminhaoId: 'c2' }),
        entrega({ entregaId: '3', caminhaoId: null, caminhaoNome: null }),
        entrega({ entregaId: '4', caminhaoId: 'cX', caminhaoNome: 'Fora' }),
      ],
    });
    const total = agruparSlotPorCaminhao(s).reduce((n, g) => n + g.entregas.length, 0);
    expect(total).toBe(4);
  });
});

describe('filtrarSlotsPorCaminhao', () => {
  it('mantém só as viagens e a barra do caminhão pedido', () => {
    const s = slot({
      ocupacao: [ocupacao({ caminhaoId: 'c1' }), ocupacao({ caminhaoId: 'c2' })],
      entregas: [
        entrega({ entregaId: '1', caminhaoId: 'c1' }),
        entrega({ entregaId: '2', caminhaoId: 'c2' }),
      ],
    });
    const [filtrado] = filtrarSlotsPorCaminhao([s], 'c1');
    expect(filtrado!.entregas.map((e) => e.entregaId)).toEqual(['1']);
    expect(filtrado!.ocupacao.map((o) => o.caminhaoId)).toEqual(['c1']);
  });

  it('descarta o slot que fica sem viagem nenhuma', () => {
    const s = slot({
      ocupacao: [ocupacao({ caminhaoId: 'c2' })],
      entregas: [entrega({ caminhaoId: 'c2' })],
    });
    expect(filtrarSlotsPorCaminhao([s], 'c1')).toEqual([]);
  });

  it('viagem sem caminhão nunca aparece num filtro por caminhão', () => {
    const s = slot({
      ocupacao: [],
      entregas: [entrega({ caminhaoId: null, caminhaoNome: null })],
    });
    expect(filtrarSlotsPorCaminhao([s], 'c1')).toEqual([]);
  });

  it('não muta os slots recebidos', () => {
    const s = slot({
      ocupacao: [ocupacao({ caminhaoId: 'c1' }), ocupacao({ caminhaoId: 'c2' })],
      entregas: [
        entrega({ entregaId: '1', caminhaoId: 'c1' }),
        entrega({ entregaId: '2', caminhaoId: 'c2' }),
      ],
    });
    filtrarSlotsPorCaminhao([s], 'c1');
    expect(s.entregas).toHaveLength(2);
    expect(s.ocupacao).toHaveLength(2);
  });
});
