import { describe, it, expect } from 'vitest';
import {
  TRANSICOES_ENTREGA,
  REVERSOES_ENTREGA,
  podeTransicionarEntrega,
  podeReverterEntrega,
  templateDaTransicaoEntrega,
} from './entrega-state-machine.js';
import type { StatusEntrega } from './types/domain.js';

const TODOS: StatusEntrega[] = [
  'agendada',
  'em_rota',
  'entregue',
  'nao_realizado',
  'cancelada',
];

describe('fluxo da viagem', () => {
  it('agendada -> em rota -> entregue', () => {
    expect(podeTransicionarEntrega('agendada', 'em_rota')).toBe(true);
    expect(podeTransicionarEntrega('em_rota', 'entregue')).toBe(true);
  });

  it('desfazer o agendamento só vale antes de sair', () => {
    expect(podeTransicionarEntrega('agendada', 'cancelada')).toBe(true);
    // Depois de em_rota o desfecho é entregue ou não realizado — não some.
    expect(podeTransicionarEntrega('em_rota', 'cancelada')).toBe(false);
  });

  it('não pula etapa: agendada não vai direto para entregue', () => {
    expect(podeTransicionarEntrega('agendada', 'entregue')).toBe(false);
  });

  it('entregue, nao_realizado e cancelada não andam para frente', () => {
    for (const terminal of ['entregue', 'nao_realizado', 'cancelada'] as const) {
      expect(TRANSICOES_ENTREGA[terminal]).toEqual([]);
    }
  });

  it('cancelada não tem volta — reagendar é criar outra entrega', () => {
    expect(REVERSOES_ENTREGA.cancelada).toEqual([]);
  });

  it('só se chega a nao_realizado saindo de em_rota (o caminhão foi)', () => {
    expect(podeTransicionarEntrega('em_rota', 'nao_realizado')).toBe(true);
    for (const de of TODOS.filter((s) => s !== 'em_rota')) {
      expect(podeTransicionarEntrega(de, 'nao_realizado')).toBe(false);
    }
  });
});

describe('reversões', () => {
  it('desfaz um despacho feito por engano', () => {
    expect(podeReverterEntrega('em_rota', 'agendada')).toBe(true);
  });

  // Reunião de 24/09/2026: o desfecho marcado por engano precisa ter volta.
  it('desfaz entregue e nao_realizado, voltando para em rota', () => {
    expect(podeReverterEntrega('entregue', 'em_rota')).toBe(true);
    expect(podeReverterEntrega('nao_realizado', 'em_rota')).toBe(true);
  });

  it('o desfecho volta para em rota, nunca para agendada (o caminhão saiu)', () => {
    expect(podeReverterEntrega('nao_realizado', 'agendada')).toBe(false);
    expect(podeReverterEntrega('entregue', 'agendada')).toBe(false);
  });

  it('reverte uma etapa só', () => {
    for (const de of TODOS) {
      expect(REVERSOES_ENTREGA[de].length).toBeLessThanOrEqual(1);
    }
  });

  it('reversões e transições para frente são conjuntos disjuntos', () => {
    for (const de of TODOS) {
      for (const para of REVERSOES_ENTREGA[de]) {
        expect(TRANSICOES_ENTREGA[de].includes(para)).toBe(false);
      }
    }
  });
});

describe('WhatsApp', () => {
  it('avisa que saiu para entrega', () => {
    expect(templateDaTransicaoEntrega('agendada', 'em_rota')).toBe('em_rota');
  });

  it('entrega completa manda a mensagem de sempre', () => {
    expect(templateDaTransicaoEntrega('em_rota', 'entregue', false)).toBe('entregue');
  });

  // Dizer "entregue com sucesso" quando foram 100 de 180 é mentira.
  it('entrega PARCIAL usa a mensagem própria, não a de sucesso', () => {
    expect(templateDaTransicaoEntrega('em_rota', 'entregue', true)).toBe(
      'entregue_parcial',
    );
  });

  // A REGRA MAIS IMPORTANTE.
  it('NUNCA avisa o cliente de que a entrega falhou', () => {
    expect(templateDaTransicaoEntrega('em_rota', 'nao_realizado')).toBeNull();
    expect(templateDaTransicaoEntrega('em_rota', 'nao_realizado', true)).toBeNull();
  });

  it('cancelar o agendamento não avisa ninguém', () => {
    expect(templateDaTransicaoEntrega('agendada', 'cancelada')).toBeNull();
  });

  it('transição inválida não dispara nada', () => {
    for (const de of TODOS) {
      for (const para of TODOS) {
        if (!podeTransicionarEntrega(de, para)) {
          expect(templateDaTransicaoEntrega(de, para)).toBeNull();
          expect(templateDaTransicaoEntrega(de, para, true)).toBeNull();
        }
      }
    }
  });
});
