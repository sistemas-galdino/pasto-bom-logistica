import { describe, it, expect } from 'vitest';
import {
  podeTransicionar,
  podeReverter,
  templateDaTransicao,
  REVERSOES,
  TRANSICOES,
} from './state-machine.js';
import type { StatusLogistico } from './types/domain.js';

const TODOS: StatusLogistico[] = [
  'pendente',
  'agendada',
  'em_rota',
  'entregue',
  'nao_realizado',
  'cancelada',
];

describe('podeReverter', () => {
  it('permite voltar uma etapa', () => {
    expect(podeReverter('em_rota', 'agendada')).toBe(true);
    expect(podeReverter('agendada', 'pendente')).toBe(true);
  });

  it('NÃO permite pular etapas na volta (em_rota -> pendente direto)', () => {
    expect(podeReverter('em_rota', 'pendente')).toBe(false);
  });

  it('NÃO permite voltar a partir de pendente nem de estados finais', () => {
    expect(podeReverter('pendente', 'agendada')).toBe(false); // pendente não volta
    expect(podeReverter('entregue', 'em_rota')).toBe(false);
    expect(podeReverter('cancelada', 'em_rota')).toBe(false);
  });

  it('NÃO permite usar a reversão para ir para frente', () => {
    expect(podeReverter('agendada', 'em_rota')).toBe(false);
    expect(podeReverter('pendente', 'agendada')).toBe(false);
  });

  it('reversões e transições para frente são conjuntos disjuntos', () => {
    for (const de of TODOS) {
      for (const para of REVERSOES[de]) {
        expect(TRANSICOES[de].includes(para)).toBe(false);
        // E o caminho de volta nunca é uma transição válida para frente.
        expect(podeTransicionar(de, para)).toBe(false);
      }
    }
  });
});

describe('nao_realizado (entrega que não deu certo)', () => {
  it('só se chega a nao_realizado saindo de em_rota', () => {
    expect(podeTransicionar('em_rota', 'nao_realizado')).toBe(true);
    for (const de of TODOS.filter((s) => s !== 'em_rota')) {
      expect(podeTransicionar(de, 'nao_realizado')).toBe(false);
    }
  });

  it('sai de nao_realizado voltando para pendente (remarcar do zero)', () => {
    expect(podeReverter('nao_realizado', 'pendente')).toBe(true);
  });

  it('NÃO volta direto para agendada — isso manteria o caminhão ocupado', () => {
    expect(podeReverter('nao_realizado', 'agendada')).toBe(false);
    expect(podeTransicionar('nao_realizado', 'agendada')).toBe(false);
  });

  it('não é um beco sem saída: dá para cancelar de vez', () => {
    expect(podeTransicionar('nao_realizado', 'cancelada')).toBe(true);
  });

  // A REGRA MAIS IMPORTANTE DESTE STATUS.
  it('NUNCA dispara WhatsApp: o cliente não é avisado de que a entrega falhou', () => {
    expect(templateDaTransicao('em_rota', 'nao_realizado')).toBeNull();
  });

  it('nenhuma transição PARA ou A PARTIR de nao_realizado notifica o cliente', () => {
    for (const de of TODOS) {
      expect(templateDaTransicao(de, 'nao_realizado')).toBeNull();
      expect(templateDaTransicao('nao_realizado', de)).toBeNull();
    }
  });

  it('as três notificações de sempre continuam intactas', () => {
    expect(templateDaTransicao('pendente', 'agendada')).toBe('agendamento');
    expect(templateDaTransicao('agendada', 'em_rota')).toBe('em_rota');
    expect(templateDaTransicao('em_rota', 'entregue')).toBe('entregue');
  });
});
