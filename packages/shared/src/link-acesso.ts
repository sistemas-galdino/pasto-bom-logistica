// Regra do LINK DE ACESSO: o link curto que a logística manda para a pessoa
// criar ou redefinir a senha ainda vale?
//
// Por que isso é uma regra pura, e não um `if` no backend (queixa da Natália,
// 12/08/2026)
// ---------------------------------------------------------------------------
// É a decisão que não pode errar nos dois sentidos: frouxa demais, libera acesso
// a uma conta; apertada demais, trava a equipe — que é exatamente a queixa que
// estamos consertando ("o link expira rápido demais").
//
// O desenho antigo mandava o `action_link` cru do Supabase, que é de uso único e
// é gasto por QUEM ABRIR A URL, inclusive o robô de pré-visualização do
// WhatsApp. Agora o link é nosso: abrir a página não consome nada, e o link do
// Supabase só nasce quando a pessoa clica no botão.

/** Situação de um link curto de acesso. */
export type SituacaoLinkAcesso =
  /** Pode ser usado: mostra o botão. */
  | 'valido'
  /** Passou do prazo (7 dias). */
  | 'expirado'
  /** Não existe, foi substituído por um novo, ou a senha já foi criada. */
  | 'invalido';

export interface EntradaLinkAcesso {
  /** `profiles.acesso_expira_em` (ISO), ou null se não há link ativo. */
  expiraEm: string | null;
  /** Agora (ISO) — injetado para o teste ser determinístico. */
  agora: string;
}

/**
 * Decide se um link curto de acesso ainda vale.
 *
 * Note o que NÃO entra aqui: o primeiro clique não invalida o link. Se o
 * redirecionamento falhar, a pessoa tem de poder tentar de novo — matar o link
 * ali recriaria a queixa que motivou esta mudança. O link morre quando a senha
 * é definida (o backend limpa as colunas) ou quando o prazo vence.
 *
 * Prazo ilegível é tratado como inválido: sem saber até quando vale, o lado
 * seguro é recusar. Aqui o custo do erro é assimétrico — negar pede um link
 * novo à logística, aceitar entrega uma conta.
 */
export function avaliarLinkAcesso(
  entrada: EntradaLinkAcesso,
): SituacaoLinkAcesso {
  const { expiraEm, agora } = entrada;

  // Sem prazo gravado não há link ativo: ou nunca houve, ou já foi encerrado.
  if (!expiraEm) return 'invalido';

  const restanteMs = Date.parse(expiraEm) - Date.parse(agora);
  if (Number.isNaN(restanteMs)) return 'invalido';

  return restanteMs > 0 ? 'valido' : 'expirado';
}

/** Dias de validade do link curto (decidido com o David em 12/08/2026). */
export const DIAS_VALIDADE_LINK_ACESSO = 7;
