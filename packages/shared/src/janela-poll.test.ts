import { describe, it, expect } from 'vitest';
import { inicioJanelaPoll } from './janela-poll.js';

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
