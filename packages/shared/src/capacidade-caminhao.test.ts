import { describe, expect, it } from 'vitest';
import { avaliarCapacidade } from './capacidade-caminhao.js';

// O caminhão do print que a Natália mandou: Cargo 816, 6,5 t.
const CARGO_816 = 6_500;

describe('avaliarCapacidade', () => {
  it('carga que cabe é folga', () => {
    const r = avaliarCapacidade({
      capacidadeKg: CARGO_816,
      usadoKg: 2_000,
      adicionalKg: 3_000,
    });
    expect(r.nivel).toBe('folga');
    expect(r.excedeu).toBe(false);
    expect(r.totalKg).toBe(5_000);
    expect(r.excedenteKg).toBe(0);
    expect(r.percentual).toBeCloseTo(76.923, 2);
  });

  // A divergência que existia entre a tela (>=, vermelho) e o servidor (>,
  // recusava). Resolvida a favor do servidor: fechar não é passar.
  it('fechar exatamente na capacidade é cheio, NÃO excedido', () => {
    const r = avaliarCapacidade({
      capacidadeKg: CARGO_816,
      usadoKg: 4_000,
      adicionalKg: 2_500,
    });
    expect(r.nivel).toBe('cheio');
    expect(r.excedeu).toBe(false);
    expect(r.excedenteKg).toBe(0);
    expect(r.percentual).toBe(100);
  });

  it('passar da capacidade é excedido, com o excedente exato', () => {
    // O caso do print: 5,0 t já no período + 2,0 t desta viagem num 6,5 t.
    const r = avaliarCapacidade({
      capacidadeKg: CARGO_816,
      usadoKg: 5_000,
      adicionalKg: 2_000,
    });
    expect(r.nivel).toBe('excedido');
    expect(r.excedeu).toBe(true);
    expect(r.totalKg).toBe(7_000);
    expect(r.excedenteKg).toBe(500);
  });

  it('capacidade 0 é desconhecida, não é "não cabe nada"', () => {
    // agenda.ts monta a ocupação com `caminhao?.capacidadeKg ?? 0` quando o
    // caminhão saiu da frota depois do agendamento.
    const r = avaliarCapacidade({ capacidadeKg: 0, usadoKg: 3_000 });
    expect(r.percentual).toBeNull();
    expect(r.excedeu).toBe(false);
    expect(r.nivel).toBe('folga');
    expect(r.excedenteKg).toBe(0);
  });

  it('capacidade NaN cai no mesmo caso de desconhecida', () => {
    const r = avaliarCapacidade({ capacidadeKg: Number.NaN, usadoKg: 3_000 });
    expect(r.percentual).toBeNull();
    expect(r.excedeu).toBe(false);
  });

  it('slot que já estourou sem adicional nenhum continua excedido', () => {
    // É a agenda lendo um dia que a logística encheu de propósito.
    const r = avaliarCapacidade({ capacidadeKg: CARGO_816, usadoKg: 8_200 });
    expect(r.nivel).toBe('excedido');
    expect(r.excedenteKg).toBe(1_700);
  });

  it('adicional ausente vale zero', () => {
    const r = avaliarCapacidade({ capacidadeKg: CARGO_816, usadoKg: 4_000 });
    expect(r.totalKg).toBe(4_000);
    expect(r.nivel).toBe('folga');
  });

  // Sem o arredondamento, isto vira "excedeu 0,0001 kg" e o caminhão fica
  // vermelho sem ter passado de nada.
  it('ponto flutuante não inventa estouro', () => {
    const r = avaliarCapacidade({
      capacidadeKg: 7_000,
      usadoKg: 6_999.9995,
      adicionalKg: 0.0006,
    });
    expect(r.nivel).toBe('cheio');
    expect(r.excedeu).toBe(false);
  });

  it('usado negativo (lixo) conta como zero', () => {
    const r = avaliarCapacidade({
      capacidadeKg: CARGO_816,
      usadoKg: -500,
      adicionalKg: 1_000,
    });
    expect(r.usadoKg).toBe(0);
    expect(r.totalKg).toBe(1_000);
  });

  // Quem escreve o texto precisa poder dizer "126% da capacidade"; quem desenha
  // a barra é que limita em 100.
  it('percentual acima de 100 é devolvido acima de 100', () => {
    const r = avaliarCapacidade({ capacidadeKg: 7_000, usadoKg: 8_820 });
    expect(r.percentual).toBe(126);
  });
});
