import { describe, it, expect } from 'vitest';
import {
  podeTransicionar,
  podeReverter,
  templateDaTransicao,
  REVERSOES,
  TRANSICOES,
} from './state-machine.js';
import type { StatusLogistico } from './types/domain.js';

// Esta é a máquina do PEDIDO. Depois da Onda 2 ela responde só pela situação da
// ordem de venda; o ciclo da viagem está em entrega-state-machine.test.ts.

const TODOS: StatusLogistico[] = [
  'pendente',
  'agendada',
  'em_rota',
  'entregue',
  'nao_realizado',
  'cancelada',
];

/** Estados de VIAGEM, que não valem mais para o pedido (legado do enum). */
const LEGADO: StatusLogistico[] = ['agendada', 'em_rota', 'nao_realizado'];

describe('escopo do pedido', () => {
  it('a única transição manual é descartar (pendente -> cancelada)', () => {
    expect(podeTransicionar('pendente', 'cancelada')).toBe(true);
    expect(TRANSICOES.pendente).toEqual(['cancelada']);
  });

  it('agendar deixou de ser transição do pedido — virou criar entrega', () => {
    expect(podeTransicionar('pendente', 'agendada')).toBe(false);
  });

  it('os estados de viagem não levam o pedido a lugar nenhum', () => {
    for (const status of LEGADO) {
      expect(TRANSICOES[status]).toEqual([]);
      expect(REVERSOES[status]).toEqual([]);
    }
  });

  it('entregue não é destino manual (quem põe lá é o saldo zerado)', () => {
    for (const de of TODOS) {
      expect(podeTransicionar(de, 'entregue')).toBe(false);
    }
  });
});

describe('reversão', () => {
  it('restaura um descarte feito por engano', () => {
    expect(podeReverter('cancelada', 'pendente')).toBe(true);
  });

  it('não existe reversão a partir de pendente nem de entregue', () => {
    expect(REVERSOES.pendente).toEqual([]);
    expect(REVERSOES.entregue).toEqual([]);
  });

  it('reversões e transições para frente são conjuntos disjuntos', () => {
    for (const de of TODOS) {
      for (const para of REVERSOES[de]) {
        expect(TRANSICOES[de].includes(para)).toBe(false);
        expect(podeTransicionar(de, para)).toBe(false);
      }
    }
  });
});

describe('WhatsApp', () => {
  // A garantia mais importante deste módulo hoje: nenhuma mudança de PEDIDO
  // fala com o cliente. Toda mensagem nasce de uma viagem.
  it('NENHUMA transição de pedido dispara mensagem', () => {
    for (const de of TODOS) {
      for (const para of TODOS) {
        expect(templateDaTransicao(de, para)).toBeNull();
      }
    }
  });

  it('em especial, descartar um pedido não avisa o cliente', () => {
    expect(templateDaTransicao('pendente', 'cancelada')).toBeNull();
  });
});
