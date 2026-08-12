import { describe, it, expect } from 'vitest';
import { inicioJanelaPoll, deveVarrer } from './janela-poll.js';

const HOJE = '2026-08-12';

describe('inicioJanelaPoll', () => {
  // O BUG QUE ISTO CONSERTA: com o cursor em hoje, a janela virava [hoje, hoje]
  // e o pedido de ontem que entrasse no gatilho hoje nunca era perguntado.
  it('não deixa a janela encolher para um dia quando o cursor está em hoje', () => {
    expect(inicioJanelaPoll({ cursorLastTo: HOJE, hoje: HOJE })).toBe(
      '2026-08-10',
    );
  });

  it('mantém o cursor quando ele é mais antigo que o piso (worker fora do ar)', () => {
    expect(inicioJanelaPoll({ cursorLastTo: '2026-08-01', hoje: HOJE })).toBe(
      '2026-08-01',
    );
  });

  it('usa o fallback largo na primeira execução (sem cursor)', () => {
    expect(inicioJanelaPoll({ cursorLastTo: null, hoje: HOJE })).toBe(
      '2026-07-13',
    );
  });

  it('respeita o piso configurado', () => {
    expect(
      inicioJanelaPoll({ cursorLastTo: HOJE, hoje: HOJE, diasRevisita: 7 }),
    ).toBe('2026-08-05');
  });

  it('atravessa a virada de mês e de ano', () => {
    expect(inicioJanelaPoll({ cursorLastTo: '2026-03-01', hoje: '2026-03-01' })).toBe(
      '2026-02-27',
    );
    expect(inicioJanelaPoll({ cursorLastTo: '2026-01-01', hoje: '2026-01-01' })).toBe(
      '2025-12-30',
    );
  });

  // Relógio torto ou data futura gravada não pode inverter a janela: o Órix
  // devolveria vazio e o tick "passaria" sem ler nada.
  it('nunca devolve data posterior a hoje', () => {
    expect(inicioJanelaPoll({ cursorLastTo: '2027-01-01', hoje: HOJE })).toBe(
      '2026-08-10',
    );
    expect(
      inicioJanelaPoll({ cursorLastTo: '2027-01-01', hoje: HOJE, diasRevisita: 0 }),
    ).toBe(HOJE);
  });

  it('piso zero preserva o comportamento antigo (cursor manda)', () => {
    expect(
      inicioJanelaPoll({ cursorLastTo: HOJE, hoje: HOJE, diasRevisita: 0 }),
    ).toBe(HOJE);
  });
});

// ---------------------------------------------------------------------------

const AGORA = '2026-08-12T14:00:00.000Z';

describe('deveVarrer', () => {
  it('roda quando nunca rodou (primeiro deploy)', () => {
    expect(deveVarrer({ ultimoSucesso: null, agora: AGORA })).toBe(true);
  });

  it('roda quando o intervalo venceu', () => {
    expect(
      deveVarrer({ ultimoSucesso: '2026-08-11T17:00:00.000Z', agora: AGORA }),
    ).toBe(true);
  });

  it('não roda enquanto o intervalo não venceu', () => {
    expect(
      deveVarrer({ ultimoSucesso: '2026-08-12T02:00:00.000Z', agora: AGORA }),
    ).toBe(false);
  });

  it('roda na borda exata do intervalo', () => {
    expect(
      deveVarrer({ ultimoSucesso: '2026-08-11T18:00:00.000Z', agora: AGORA }),
    ).toBe(true);
  });

  it('respeita o intervalo configurado', () => {
    const seisHorasAtras = '2026-08-12T08:00:00.000Z';
    expect(
      deveVarrer({ ultimoSucesso: seisHorasAtras, agora: AGORA, horasIntervalo: 4 }),
    ).toBe(true);
    expect(
      deveVarrer({ ultimoSucesso: seisHorasAtras, agora: AGORA, horasIntervalo: 8 }),
    ).toBe(false);
  });

  // O lado seguro é varrer: a ingestão é idempotente, e travar para sempre por
  // causa de um campo corrompido seria pior do que uma varredura a mais.
  it('timestamp ilegível não trava a varredura para sempre', () => {
    expect(deveVarrer({ ultimoSucesso: 'nao-e-uma-data', agora: AGORA })).toBe(
      true,
    );
  });

  it('registro no futuro (relógio torto) não trava a varredura', () => {
    expect(
      deveVarrer({ ultimoSucesso: '2026-09-01T00:00:00.000Z', agora: AGORA }),
    ).toBe(true);
  });

  // A propriedade que faz o desenho não depender de adivinhar horário: com 20 h,
  // a varredura anda ~4 h por dia no relógio e cedo ou tarde cai na janela em
  // que o Órix está de pé.
  it('com 20 h o horário anda de um dia para o outro', () => {
    const primeira = '2026-08-12T14:00:00.000Z';
    // 20 h depois: ainda não; 20 h e 1 min: sim.
    expect(
      deveVarrer({ ultimoSucesso: primeira, agora: '2026-08-13T09:59:00.000Z' }),
    ).toBe(false);
    expect(
      deveVarrer({ ultimoSucesso: primeira, agora: '2026-08-13T10:01:00.000Z' }),
    ).toBe(true);
  });
});
