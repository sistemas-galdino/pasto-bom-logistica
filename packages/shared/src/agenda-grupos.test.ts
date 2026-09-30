import { describe, expect, it } from 'vitest';
import {
  agruparSlotPorCaminhao,
  filtrarSlotsPorCaminhao,
  reordenacoesPorMotorista,
} from './agenda-grupos.js';
import type {
  AgendaEntrega,
  AgendaOcupacao,
  AgendaReserva,
  AgendaSlot,
} from './types/domain.js';

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
    ordemRota: null,
    pedidoParcial: false,
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

function reserva(over: Partial<AgendaReserva> = {}): AgendaReserva {
  return {
    reservaId: 'r1',
    servico: 'oficina',
    cidade: null,
    fornecedorNome: null,
    produtos: null,
    motoristaId: null,
    motoristaNome: null,
    caminhaoId: 'c1',
    // Mesmo nome do ocupacao(): reserva e barra têm de falar do mesmo caminhão.
    caminhaoNome: 'Stradinha',
    pesoPrevistoKg: null,
    bloqueiaCaminhao: true,
    ...over,
  };
}

function slot(over: Partial<AgendaSlot> = {}): AgendaSlot {
  return {
    data: '2026-08-19',
    periodo: 'manha',
    entregas: [],
    ocupacao: [],
    reservas: [],
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

  it('cria o grupo do caminhão que só tem reserva, sem entrega nenhuma', () => {
    // A armadilha central das reservas: antes, grupo sem entrega era descartado,
    // e o caminhão parado na oficina desaparecia da tela justamente no dia em
    // que a logística mais precisa vê-lo.
    const s = slot({
      ocupacao: [ocupacao()],
      entregas: [],
      reservas: [reserva({ reservaId: 'r-oficina' })],
    });
    const grupos = agruparSlotPorCaminhao(s);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.caminhaoId).toBe('c1');
    expect(grupos[0]!.ocupacao).not.toBeNull();
    expect(grupos[0]!.reservas.map((r) => r.reservaId)).toEqual(['r-oficina']);
    expect(grupos[0]!.entregas).toEqual([]);
  });

  it('reserva e viagens convivem no mesmo grupo, com as viagens ainda ordenadas', () => {
    const s = slot({
      ocupacao: [ocupacao()],
      entregas: [
        entrega({ entregaId: 'z', clienteNome: 'ZEZE' }),
        entrega({ entregaId: 'a', clienteNome: 'ANA' }),
      ],
      reservas: [reserva({ reservaId: 'r-adubo', servico: 'buscar adubo' })],
    });
    const [grupo] = agruparSlotPorCaminhao(s);
    expect(grupo!.reservas.map((r) => r.reservaId)).toEqual(['r-adubo']);
    expect(grupo!.entregas.map((e) => e.entregaId)).toEqual(['a', 'z']);
  });

  it('ordena as reservas por serviço ignorando acento e caixa, id desempata', () => {
    const s = slot({
      ocupacao: [ocupacao()],
      reservas: [
        reserva({ reservaId: 'r2', servico: 'OFICINA' }),
        reserva({ reservaId: 'r1', servico: 'Óficina' }),
        reserva({ reservaId: 'r0', servico: 'buscar adubo' }),
      ],
    });
    const [grupo] = agruparSlotPorCaminhao(s);
    // 'buscar adubo' < 'oficina'; as duas "oficina" empatam por serviço (mesma
    // base, sensitivity: 'base') e só então o id decide.
    expect(grupo!.reservas.map((r) => r.reservaId)).toEqual(['r0', 'r1', 'r2']);
  });

  it('não perde a reserva de um caminhão que não veio na ocupação', () => {
    const s = slot({
      ocupacao: [],
      reservas: [
        reserva({ reservaId: 'orfa', caminhaoId: 'cX', caminhaoNome: 'Fantasma' }),
      ],
    });
    const grupos = agruparSlotPorCaminhao(s);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.caminhaoId).toBe('cX');
    // Sem barra, o único nome disponível é o que a própria reserva carrega.
    expect(grupos[0]!.caminhaoNome).toBe('Fantasma');
    expect(grupos[0]!.ocupacao).toBeNull();
    expect(grupos[0]!.reservas.map((r) => r.reservaId)).toEqual(['orfa']);
    expect(grupos[0]!.entregas).toEqual([]);
  });

  it('o grupo sem caminhão nunca recebe reserva', () => {
    const s = slot({
      ocupacao: [ocupacao()],
      entregas: [entrega({ entregaId: 'sem', caminhaoId: null, caminhaoNome: null })],
      reservas: [reserva()],
    });
    const grupos = agruparSlotPorCaminhao(s);
    const semCaminhao = grupos.find((g) => g.caminhaoId === null);
    expect(semCaminhao!.reservas).toEqual([]);
  });

  it('a soma das reservas dos grupos é a do slot (nenhuma reserva se perde)', () => {
    const s = slot({
      ocupacao: [ocupacao({ caminhaoId: 'c1' }), ocupacao({ caminhaoId: 'c2' })],
      entregas: [entrega({ entregaId: '1', caminhaoId: 'c1' })],
      reservas: [
        reserva({ reservaId: 'r1', caminhaoId: 'c1' }),
        reserva({ reservaId: 'r2', caminhaoId: 'c2' }),
        reserva({ reservaId: 'r3', caminhaoId: 'cX', caminhaoNome: 'Fora' }),
      ],
    });
    const grupos = agruparSlotPorCaminhao(s);
    const ids = grupos.flatMap((g) => g.reservas.map((r) => r.reservaId)).sort();
    expect(ids).toEqual(['r1', 'r2', 'r3']);
  });
});

// Ordem da rota dentro do grupo — pedido da Natália, 24/09/2026: arrastar os
// cards "na ordem que o motorista vai fazer aqueles clientes". A lista tem de
// MOSTRAR a ordem gravada, senão o arrasto some no próximo refetch.
describe('agruparSlotPorCaminhao — ordem da rota', () => {
  function entregasDoGrupo(entregas: AgendaEntrega[]): string[] {
    const [grupo] = agruparSlotPorCaminhao(
      slot({ ocupacao: [ocupacao()], entregas }),
    );
    return grupo!.entregas.map((e) => e.entregaId);
  }

  it('segue ordemRota ascendente, mesmo contra a ordem alfabética', () => {
    expect(
      entregasDoGrupo([
        entrega({ entregaId: 'ana', clienteNome: 'ANA', ordemRota: 3 }),
        entrega({ entregaId: 'zeze', clienteNome: 'ZEZE', ordemRota: 1 }),
        entrega({ entregaId: 'bia', clienteNome: 'BIA', ordemRota: 2 }),
      ]),
    ).toEqual(['zeze', 'bia', 'ana']);
  });

  it('sequenciadas antes das não sequenciadas; estas pela regra do nome', () => {
    expect(
      entregasDoGrupo([
        entrega({ entregaId: 'ana', clienteNome: 'ANA', ordemRota: null }),
        entrega({ entregaId: 'zeze', clienteNome: 'ZEZE', ordemRota: 7 }),
        entrega({ entregaId: 'caio', clienteNome: 'CAIO', ordemRota: null }),
      ]),
    ).toEqual(['zeze', 'ana', 'caio']);
  });

  it('null não é "a parada zero": ordemRota 0 ainda vem antes', () => {
    expect(
      entregasDoGrupo([
        entrega({ entregaId: 'sem', clienteNome: 'AAA', ordemRota: null }),
        entrega({ entregaId: 'zero', clienteNome: 'ZZZ', ordemRota: 0 }),
      ]),
    ).toEqual(['zero', 'sem']);
  });

  it('empate de ordemRota cai na regra antiga (nome, nº, id)', () => {
    // Dois motoristas no mesmo caminhão numeram cada um a sua rota, e o banco
    // não tem unicidade: o empate precisa sair estável.
    expect(
      entregasDoGrupo([
        entrega({ entregaId: 'z', clienteNome: 'ZEZE', ordemRota: 1 }),
        entrega({ entregaId: 'a10', clienteNome: 'ANA', orixNumero: '10', ordemRota: 1 }),
        entrega({ entregaId: 'a9', clienteNome: 'ANA', orixNumero: '9', ordemRota: 1 }),
      ]),
    ).toEqual(['a9', 'a10', 'z']);
  });

  it('a ordem da rota também vale no grupo sem caminhão', () => {
    const grupos = agruparSlotPorCaminhao(
      slot({
        entregas: [
          entrega({ entregaId: 'a', clienteNome: 'ANA', caminhaoId: null, ordemRota: 2 }),
          entrega({ entregaId: 'b', clienteNome: 'BIA', caminhaoId: null, ordemRota: 1 }),
        ],
      }),
    );
    expect(grupos[0]!.entregas.map((e) => e.entregaId)).toEqual(['b', 'a']);
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

  it('mantém o slot em que o caminhão só tem reserva', () => {
    // Dia ocupado do caminhão é dia da agenda dele, mesmo sem levar nada.
    const s = slot({
      ocupacao: [ocupacao({ caminhaoId: 'c1' })],
      entregas: [],
      reservas: [reserva({ reservaId: 'r-oficina', caminhaoId: 'c1' })],
    });
    const [filtrado] = filtrarSlotsPorCaminhao([s], 'c1');
    expect(filtrado!.entregas).toEqual([]);
    expect(filtrado!.reservas.map((r) => r.reservaId)).toEqual(['r-oficina']);
  });

  it('tira do slot as reservas dos outros caminhões', () => {
    const s = slot({
      ocupacao: [ocupacao({ caminhaoId: 'c1' }), ocupacao({ caminhaoId: 'c2' })],
      entregas: [entrega({ entregaId: '1', caminhaoId: 'c1' })],
      reservas: [
        reserva({ reservaId: 'minha', caminhaoId: 'c1' }),
        reserva({ reservaId: 'alheia', caminhaoId: 'c2' }),
      ],
    });
    const [filtrado] = filtrarSlotsPorCaminhao([s], 'c1');
    expect(filtrado!.reservas.map((r) => r.reservaId)).toEqual(['minha']);
  });

  it('descarta o slot sem viagem NEM reserva do caminhão pedido', () => {
    const s = slot({
      ocupacao: [ocupacao({ caminhaoId: 'c2' })],
      entregas: [entrega({ caminhaoId: 'c2' })],
      reservas: [reserva({ caminhaoId: 'c2' })],
    });
    expect(filtrarSlotsPorCaminhao([s], 'c1')).toEqual([]);
  });
});

describe('reordenacoesPorMotorista', () => {
  const a = entrega({ entregaId: 'a', motoristaId: 'm1' });
  const b = entrega({ entregaId: 'b', motoristaId: 'm1' });
  const c = entrega({ entregaId: 'c', motoristaId: 'm1' });
  const x = entrega({ entregaId: 'x', motoristaId: 'm2' });
  const y = entrega({ entregaId: 'y', motoristaId: 'm2' });
  const sem = entrega({ entregaId: 'sem', motoristaId: null });

  it('um motorista: manda TODAS as viagens dele no grupo, na ordem nova', () => {
    expect(reordenacoesPorMotorista([a, b, c], [c, a, b])).toEqual([
      { motoristaId: 'm1', ordem: ['c', 'a', 'b'] },
    ]);
  });

  it('nada mudou: nenhuma chamada', () => {
    expect(reordenacoesPorMotorista([a, b, c], [a, b, c])).toEqual([]);
  });

  it('dois motoristas: uma chamada por motorista cuja ordem relativa mudou', () => {
    expect(
      reordenacoesPorMotorista([a, x, b, y], [b, y, a, x]),
    ).toEqual([
      { motoristaId: 'm1', ordem: ['b', 'a'] },
      { motoristaId: 'm2', ordem: ['y', 'x'] },
    ]);
  });

  it('passar o card de um motorista por cima do outro não regrava a ordem de ninguém', () => {
    // a, b de m1 continuam na mesma ordem relativa; x de m2 só trocou de lugar
    // em relação a eles.
    expect(reordenacoesPorMotorista([a, b, x], [x, a, b])).toEqual([]);
  });

  it('só o motorista que mudou é chamado', () => {
    expect(reordenacoesPorMotorista([a, b, x, y], [b, a, x, y])).toEqual([
      { motoristaId: 'm1', ordem: ['b', 'a'] },
    ]);
  });

  it('viagem sem motorista nunca vira chamada', () => {
    expect(reordenacoesPorMotorista([sem, a, b], [b, a, sem])).toEqual([
      { motoristaId: 'm1', ordem: ['b', 'a'] },
    ]);
  });
});
