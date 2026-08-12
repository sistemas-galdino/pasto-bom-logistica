import { describe, it, expect } from 'vitest';
import { avaliarLinkAcesso } from './link-acesso.js';

const AGORA = '2026-08-12T14:00:00.000Z';

describe('avaliarLinkAcesso', () => {
  it('vale enquanto o prazo não venceu', () => {
    expect(
      avaliarLinkAcesso({ expiraEm: '2026-08-19T14:00:00.000Z', agora: AGORA }),
    ).toBe('valido');
  });

  it('expira depois do prazo', () => {
    expect(
      avaliarLinkAcesso({ expiraEm: '2026-08-12T13:59:59.000Z', agora: AGORA }),
    ).toBe('expirado');
  });

  it('na borda exata já está expirado', () => {
    expect(avaliarLinkAcesso({ expiraEm: AGORA, agora: AGORA })).toBe(
      'expirado',
    );
  });

  // Sem prazo gravado não há link ativo: ou nunca houve, ou a senha já foi
  // criada e o backend limpou as colunas.
  it('sem prazo é inválido', () => {
    expect(avaliarLinkAcesso({ expiraEm: null, agora: AGORA })).toBe(
      'invalido',
    );
  });

  // Custo assimétrico: negar pede um link novo; aceitar entrega uma conta.
  it('prazo ilegível é inválido, não válido', () => {
    expect(
      avaliarLinkAcesso({ expiraEm: 'nao-e-uma-data', agora: AGORA }),
    ).toBe('invalido');
  });

  // O PONTO DA MUDANÇA: abrir a página não gasta o link. O robô de
  // pré-visualização do WhatsApp abre, e a pessoa ainda tem de conseguir usar.
  it('continua válido depois de já ter sido aberto', () => {
    const entrada = { expiraEm: '2026-08-19T14:00:00.000Z', agora: AGORA };
    expect(avaliarLinkAcesso(entrada)).toBe('valido');
    expect(avaliarLinkAcesso(entrada)).toBe('valido');
    expect(avaliarLinkAcesso(entrada)).toBe('valido');
  });
});
