import { describe, it, expect } from 'vitest';
import {
  podeTransicionar,
  podeReverter,
  REVERSOES,
  TRANSICOES,
} from './state-machine.js';
import type { StatusLogistico } from './types/domain.js';

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
    const status: StatusLogistico[] = [
      'pendente',
      'agendada',
      'em_rota',
      'entregue',
      'cancelada',
    ];
    for (const de of status) {
      for (const para of REVERSOES[de]) {
        expect(TRANSICOES[de].includes(para)).toBe(false);
        // E o caminho de volta nunca é uma transição válida para frente.
        expect(podeTransicionar(de, para)).toBe(false);
      }
    }
  });
});
