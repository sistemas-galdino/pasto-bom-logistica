import { describe, it, expect } from 'vitest';
import {
  decidirReconciliacao,
  type EntradaReconciliacao,
} from './reconciliacao.js';
import type { StatusLogistico } from './types/domain.js';

const CANCELADO = ['00031'];

/** Entrada base: pedido pendente, aguardando entrega, nada mudou. */
function entrada(over: Partial<EntradaReconciliacao> = {}): EntradaReconciliacao {
  return {
    statusLogistico: 'pendente',
    statusOrixAtual: '00041',
    statusOrixNovo: '00041',
    statusOrixNomeAtual: 'Venda aguardando entrega para faturamento',
    statusOrixNomeNovo: 'Venda aguardando entrega para faturamento',
    ...over,
  };
}

describe('decidirReconciliacao', () => {
  it('não faz nada quando nada mudou', () => {
    expect(decidirReconciliacao(entrada(), CANCELADO)).toBe('nada');
  });

  it('atualiza quando só o status do Órix mudou (00041 -> 00027)', () => {
    expect(
      decidirReconciliacao(
        entrada({
          statusOrixNovo: '00027',
          statusOrixNomeNovo: 'Venda aguardando faturamento (parcial)',
        }),
        CANCELADO,
      ),
    ).toBe('atualizar_orix');
  });

  it('atualiza quando só o NOME do status mudou (renomeado no ERP)', () => {
    expect(
      decidirReconciliacao(
        entrada({ statusOrixNomeNovo: 'Venda aguardando entrega' }),
        CANCELADO,
      ),
    ).toBe('atualizar_orix');
  });

  // O PEDIDO DA REUNIÃO: cancelou no Órix, some do painel do Johnny.
  it('cancela o pedido aberto quando a OV vira cancelada no Órix', () => {
    const abertos: StatusLogistico[] = [
      'pendente',
      'agendada',
      'em_rota',
      'nao_realizado',
    ];
    for (const statusLogistico of abertos) {
      expect(
        decidirReconciliacao(
          entrada({ statusLogistico, statusOrixNovo: '00031' }),
          CANCELADO,
        ),
      ).toBe('cancelar');
    }
  });

  // A TRAVA MAIS IMPORTANTE: o caminhão não desentrega.
  it('NUNCA cancela um pedido já entregue (cancelamento posterior é fiscal)', () => {
    expect(
      decidirReconciliacao(
        entrada({ statusLogistico: 'entregue', statusOrixNovo: '00031' }),
        CANCELADO,
      ),
    ).toBe('atualizar_orix');
  });

  it('não mexe em pedido já cancelado por aqui', () => {
    expect(
      decidirReconciliacao(
        entrada({ statusLogistico: 'cancelada', statusOrixNovo: '00031' }),
        CANCELADO,
      ),
    ).toBe('atualizar_orix');
  });

  it('não ressuscita: sair do cancelado no Órix não devolve o pedido à fila', () => {
    // Estava cancelado dos dois lados; o Órix voltou para um status de gatilho.
    expect(
      decidirReconciliacao(
        entrada({
          statusLogistico: 'cancelada',
          statusOrixAtual: '00031',
          statusOrixNovo: '00041',
          statusOrixNomeAtual: 'Venda cancelada',
        }),
        CANCELADO,
      ),
    ).toBe('atualizar_orix');
  });

  it('status novo vazio não decide nada (API não devolveu o campo)', () => {
    expect(
      decidirReconciliacao(
        entrada({ statusOrixNovo: '', statusOrixNomeNovo: '' }),
        CANCELADO,
      ),
    ).toBe('nada');
  });

  it('respeita a lista configurável de cancelamento', () => {
    // Se amanhã o Órix criar outro código de cancelamento, basta a config mudar.
    expect(
      decidirReconciliacao(entrada({ statusOrixNovo: '00099' }), ['00099']),
    ).toBe('cancelar');
    // E o 00031 deixa de cancelar se sair da lista.
    expect(
      decidirReconciliacao(entrada({ statusOrixNovo: '00031' }), ['00099']),
    ).toBe('atualizar_orix');
  });
});
