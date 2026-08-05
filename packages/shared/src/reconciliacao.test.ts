import { describe, it, expect } from 'vitest';
import {
  decidirReconciliacao,
  decidirAusencia,
  type EntradaReconciliacao,
  type EntradaAusencia,
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

// ---------------------------------------------------------------------------

/** Entrada base da ausência: pendente, dentro da janela, sem viagem, 1ª vez. */
function ausencia(over: Partial<EntradaAusencia> = {}): EntradaAusencia {
  return {
    statusLogistico: 'pendente',
    dataPedido: '2026-07-10',
    janelaInicial: '2026-05-19',
    janelaFinal: '2026-08-05',
    temEntregaAtiva: false,
    ausenteDesde: null,
    agora: '2026-08-05T12:00:00.000Z',
    ...over,
  };
}

describe('decidirAusencia', () => {
  it('na primeira ausência apenas carimba, nunca descarta', () => {
    expect(decidirAusencia(ausencia(), 24)).toBe('marcar_ausente');
  });

  it('descarta quando a carência venceu', () => {
    expect(
      decidirAusencia(
        ausencia({ ausenteDesde: '2026-08-04T11:00:00.000Z' }),
        24,
      ),
    ).toBe('descartar');
  });

  it('espera enquanto a carência não venceu', () => {
    expect(
      decidirAusencia(
        ausencia({ ausenteDesde: '2026-08-05T06:00:00.000Z' }),
        24,
      ),
    ).toBe('nada');
  });

  it('com carência zero descarta já na primeira leitura (script one-shot)', () => {
    expect(decidirAusencia(ausencia(), 0)).toBe('descartar');
    expect(
      decidirAusencia(ausencia({ ausenteDesde: '2026-08-05T12:00:00.000Z' }), 0),
    ).toBe('descartar');
  });

  it('carência zero NÃO atropela as guardas', () => {
    expect(decidirAusencia(ausencia({ statusLogistico: 'entregue' }), 0)).toBe(
      'nada',
    );
    expect(decidirAusencia(ausencia({ temEntregaAtiva: true }), 0)).toBe('nada');
    expect(decidirAusencia(ausencia({ dataPedido: '2026-05-18' }), 0)).toBe(
      'nada',
    );
  });

  it('nunca rebaixa um desfecho', () => {
    for (const s of ['entregue', 'cancelada'] as StatusLogistico[]) {
      expect(
        decidirAusencia(
          ausencia({ statusLogistico: s, ausenteDesde: '2026-01-01T00:00:00.000Z' }),
          24,
        ),
      ).toBe('nada');
    }
  });

  it('protege o pedido sem data (não dá para provar que foi perguntado)', () => {
    expect(
      decidirAusencia(
        ausencia({ dataPedido: null, ausenteDesde: '2026-01-01T00:00:00.000Z' }),
        24,
      ),
    ).toBe('nada');
  });

  it('protege o pedido fora da janela consultada', () => {
    // Anterior ao início: a varredura tem teto e ele não foi perguntado.
    expect(
      decidirAusencia(
        ausencia({
          dataPedido: '2026-05-18',
          ausenteDesde: '2026-01-01T00:00:00.000Z',
        }),
        24,
      ),
    ).toBe('nada');
    // Posterior ao fim: pedido futuro, idem.
    expect(
      decidirAusencia(
        ausencia({
          dataPedido: '2026-08-06',
          ausenteDesde: '2026-01-01T00:00:00.000Z',
        }),
        24,
      ),
    ).toBe('nada');
  });

  it('aceita o pedido exatamente nas bordas da janela', () => {
    expect(decidirAusencia(ausencia({ dataPedido: '2026-05-19' }), 24)).toBe(
      'marcar_ausente',
    );
    expect(decidirAusencia(ausencia({ dataPedido: '2026-08-05' }), 24)).toBe(
      'marcar_ausente',
    );
  });

  it('não arranca do quadro uma viagem em andamento', () => {
    expect(
      decidirAusencia(
        ausencia({
          temEntregaAtiva: true,
          ausenteDesde: '2026-01-01T00:00:00.000Z',
        }),
        24,
      ),
    ).toBe('nada');
  });

  it('carimbo ilegível não vira descarte', () => {
    expect(
      decidirAusencia(ausencia({ ausenteDesde: 'nao-e-uma-data' }), 24),
    ).toBe('nada');
  });
});
