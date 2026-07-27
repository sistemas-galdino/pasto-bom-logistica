import { describe, it, expect } from 'vitest';
import {
  calcularSaldo,
  consomeSaldo,
  temSaldo,
  apenasComSaldo,
  pesoDaCarga,
  validarQuantidades,
  type LinhaItemPedido,
  type LinhaItemEntrega,
} from './saldo.js';

/** O pedido do Jonathan, o exemplo que a Natália usou na reunião: 180 de adubo. */
const PEDIDO_180: LinhaItemPedido[] = [
  { produtoCodigo: 'ADU1', nomeProduto: 'ADUBO 19-04-19 50KG', qtd: 180, pesoUnitKg: 50 },
];

describe('consomeSaldo', () => {
  it('agendada, em_rota e entregue seguram mercadoria', () => {
    expect(consomeSaldo('agendada')).toBe(true);
    expect(consomeSaldo('em_rota')).toBe(true);
    expect(consomeSaldo('entregue')).toBe(true);
  });

  // A REGRA QUE FAZ O SALDO VOLTAR SOZINHO.
  it('nao_realizado e cancelada devolvem a mercadoria para a fila', () => {
    expect(consomeSaldo('nao_realizado')).toBe(false);
    expect(consomeSaldo('cancelada')).toBe(false);
  });
});

describe('calcularSaldo — o caso da reunião (180, entrega 100)', () => {
  it('sem entrega nenhuma, o saldo é o pedido inteiro', () => {
    const saldo = calcularSaldo(PEDIDO_180, []);
    expect(saldo).toEqual([
      {
        produtoCodigo: 'ADU1',
        nomeProduto: 'ADUBO 19-04-19 50KG',
        qtdPedido: 180,
        qtdComprometida: 0,
        qtdSaldo: 180,
        pesoUnitKg: 50,
      },
    ]);
  });

  it('com 100 agendados, restam 80', () => {
    const saldo = calcularSaldo(PEDIDO_180, [
      { produtoCodigo: 'ADU1', qtd: 100, statusEntrega: 'agendada' },
    ]);
    expect(saldo[0]?.qtdSaldo).toBe(80);
    expect(saldo[0]?.qtdComprometida).toBe(100);
  });

  it('entregues os 100, ainda restam 80 (entregue continua consumindo)', () => {
    const saldo = calcularSaldo(PEDIDO_180, [
      { produtoCodigo: 'ADU1', qtd: 100, statusEntrega: 'entregue' },
    ]);
    expect(saldo[0]?.qtdSaldo).toBe(80);
  });

  it('as duas viagens concluídas zeram o saldo', () => {
    const saldo = calcularSaldo(PEDIDO_180, [
      { produtoCodigo: 'ADU1', qtd: 100, statusEntrega: 'entregue' },
      { produtoCodigo: 'ADU1', qtd: 80, statusEntrega: 'entregue' },
    ]);
    expect(saldo[0]?.qtdSaldo).toBe(0);
    expect(temSaldo(saldo)).toBe(false);
  });

  // O COMPORTAMENTO MAIS IMPORTANTE DO MODELO.
  it('a viagem que não deu certo devolve a carga para a fila', () => {
    const saldo = calcularSaldo(PEDIDO_180, [
      { produtoCodigo: 'ADU1', qtd: 100, statusEntrega: 'nao_realizado' },
    ]);
    expect(saldo[0]?.qtdSaldo).toBe(180);
    expect(saldo[0]?.qtdComprometida).toBe(0);
  });

  it('desfazer o agendamento devolve a carga para a fila', () => {
    const saldo = calcularSaldo(PEDIDO_180, [
      { produtoCodigo: 'ADU1', qtd: 100, statusEntrega: 'cancelada' },
    ]);
    expect(saldo[0]?.qtdSaldo).toBe(180);
  });

  // O CASO QUE ESCOLHEU O MODELO: vários caminhões ao mesmo tempo.
  it('três caminhões simultâneos somam no comprometido', () => {
    const saldo = calcularSaldo(PEDIDO_180, [
      { produtoCodigo: 'ADU1', qtd: 60, statusEntrega: 'em_rota' },
      { produtoCodigo: 'ADU1', qtd: 60, statusEntrega: 'em_rota' },
      { produtoCodigo: 'ADU1', qtd: 40, statusEntrega: 'agendada' },
    ]);
    expect(saldo[0]?.qtdComprometida).toBe(160);
    expect(saldo[0]?.qtdSaldo).toBe(20);
  });

  it('mistura de viagens boas e ruins conta só as que valem', () => {
    const saldo = calcularSaldo(PEDIDO_180, [
      { produtoCodigo: 'ADU1', qtd: 100, statusEntrega: 'entregue' },
      { produtoCodigo: 'ADU1', qtd: 50, statusEntrega: 'nao_realizado' },
      { produtoCodigo: 'ADU1', qtd: 30, statusEntrega: 'cancelada' },
      { produtoCodigo: 'ADU1', qtd: 20, statusEntrega: 'agendada' },
    ]);
    expect(saldo[0]?.qtdComprometida).toBe(120);
    expect(saldo[0]?.qtdSaldo).toBe(60);
  });
});

describe('calcularSaldo — casos do mundo real', () => {
  it('agrega o MESMO produto em duas linhas do pedido', () => {
    // Existem pedidos assim no banco; para a entrega o que importa é o total.
    const saldo = calcularSaldo(
      [
        { produtoCodigo: 'ADU1', nomeProduto: 'ADUBO', qtd: 100 },
        { produtoCodigo: 'ADU1', nomeProduto: 'ADUBO', qtd: 80 },
      ],
      [],
    );
    expect(saldo).toHaveLength(1);
    expect(saldo[0]?.qtdPedido).toBe(180);
  });

  it('mantém o item zerado na lista (a tela precisa saber que ele existe)', () => {
    const saldo = calcularSaldo(
      [
        { produtoCodigo: 'ADU1', nomeProduto: 'ADUBO', qtd: 100 },
        { produtoCodigo: 'SEM1', nomeProduto: 'SEMENTE', qtd: 20 },
      ],
      [{ produtoCodigo: 'ADU1', qtd: 100, statusEntrega: 'entregue' }],
    );
    expect(saldo).toHaveLength(2);
    expect(saldo[0]?.qtdSaldo).toBe(0);
    expect(apenasComSaldo(saldo)).toHaveLength(1);
  });

  it('preserva a ordem em que os produtos aparecem no pedido', () => {
    const saldo = calcularSaldo(
      [
        { produtoCodigo: 'C', nomeProduto: 'C', qtd: 1 },
        { produtoCodigo: 'A', nomeProduto: 'A', qtd: 1 },
        { produtoCodigo: 'B', nomeProduto: 'B', qtd: 1 },
      ],
      [],
    );
    expect(saldo.map((s) => s.produtoCodigo)).toEqual(['C', 'A', 'B']);
  });

  it('NUNCA devolve saldo negativo (a faturista pode reduzir a OV no Órix)', () => {
    // Saíram 180, e depois o Órix passou a dizer que o pedido é de 100.
    const saldo = calcularSaldo(
      [{ produtoCodigo: 'ADU1', nomeProduto: 'ADUBO', qtd: 100 }],
      [{ produtoCodigo: 'ADU1', qtd: 180, statusEntrega: 'entregue' }],
    );
    expect(saldo[0]?.qtdSaldo).toBe(0);
  });

  it('ignora entrega de produto que não está mais no pedido', () => {
    const saldo = calcularSaldo(PEDIDO_180, [
      { produtoCodigo: 'SUMIU', qtd: 10, statusEntrega: 'entregue' },
    ]);
    expect(saldo).toHaveLength(1);
    expect(saldo[0]?.qtdSaldo).toBe(180);
  });

  it('não deixa resíduo de ponto flutuante em quantidade fracionária', () => {
    const saldo = calcularSaldo(
      [{ produtoCodigo: 'X', nomeProduto: 'X', qtd: 0.3 }],
      [{ produtoCodigo: 'X', qtd: 0.1, statusEntrega: 'agendada' }],
    );
    expect(saldo[0]?.qtdSaldo).toBe(0.2);
  });
});

describe('pesoDaCarga', () => {
  it('soma peso unitário × quantidade', () => {
    expect(pesoDaCarga([{ qtd: 100, pesoUnitKg: 50 }])).toBe(5000);
  });

  // É isso que trava o agendamento pedindo o peso que falta.
  it('null quando ALGUM produto está sem peso cadastrado', () => {
    expect(
      pesoDaCarga([
        { qtd: 100, pesoUnitKg: 50 },
        { qtd: 10, pesoUnitKg: null },
      ]),
    ).toBeNull();
  });

  it('carga vazia pesa zero', () => {
    expect(pesoDaCarga([])).toBe(0);
  });

  // O DESTRAVE PEDIDO PELO GUTO: o peso é o da quantidade AGENDADA.
  it('agendar parte da carga pesa só a parte agendada', () => {
    const pedidoInteiro = pesoDaCarga([{ qtd: 180, pesoUnitKg: 50 }]);
    const soAParte = pesoDaCarga([{ qtd: 100, pesoUnitKg: 50 }]);
    expect(pedidoInteiro).toBe(9000); // não cabe num caminhão de 8 t
    expect(soAParte).toBe(5000); // cabe
  });
});

describe('validarQuantidades', () => {
  const saldo = calcularSaldo(PEDIDO_180, [
    { produtoCodigo: 'ADU1', qtd: 100, statusEntrega: 'entregue' },
  ]);

  it('aceita quantidade dentro do saldo', () => {
    expect(validarQuantidades(saldo, new Map([['ADU1', 80]]))).toEqual([]);
  });

  it('recusa quantidade acima do saldo, dizendo quanto resta', () => {
    const erros = validarQuantidades(saldo, new Map([['ADU1', 81]]));
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain('restam 80');
  });

  it('recusa entrega vazia', () => {
    const erros = validarQuantidades(saldo, new Map([['ADU1', 0]]));
    expect(erros[0]).toContain('pelo menos um produto');
  });

  it('recusa produto que não é do pedido', () => {
    const erros = validarQuantidades(saldo, new Map([['OUTRO', 5]]));
    expect(erros.some((e) => e.includes('não faz parte'))).toBe(true);
  });

  it('recusa quantidade negativa ou inválida', () => {
    expect(validarQuantidades(saldo, new Map([['ADU1', -5]])).length).toBeGreaterThan(0);
    expect(validarQuantidades(saldo, new Map([['ADU1', NaN]])).length).toBeGreaterThan(0);
  });
});
