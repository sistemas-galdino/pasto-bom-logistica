// O PERÍODO QUE O CALENDÁRIO MOSTRA — dado a visão (mês/semana/dia) e a âncora.
//
// POR QUE ISTO SAIU DA TELA
// ---------------------------------------------------------------------------
// Esta função existia em DUAS cópias byte a byte: `pages/Agenda.tsx` e
// `pages/Rotas.tsx`. Enquanto a segunda tela era uma aba da primeira dava para
// fingir que não era grave; com a agenda do caminhão virando página própria
// (/agendamento) seriam três, e a terceira nasceria já com a obrigação de não
// divergir das outras duas na primeira correção.
//
// ISO NA ENTRADA E NA SAÍDA, e aritmética em `Date.UTC`. As cópias da tela
// trabalhavam com `Date` LOCAL e tinham de tomar cuidado a cada passo para não
// cair no bug clássico (`new Date('YYYY-MM-DD')` é UTC e no Brasil volta um
// dia). Falando ISO nas duas pontas, o fuso não tem por onde entrar: não há
// meia-noite local no meio do caminho. Quem precisa de `Date` para desenhar
// converte na borda — é o que `components/agenda/periodo.ts` faz.
//
// O RÓTULO NÃO MORA AQUI. `tituloDoPeriodo` ("Setembro de 2026") é pt-BR, e o
// shared não tem i18n: ele é regra de negócio compartilhada entre backend e
// frontend, e o backend não tem por que carregar o vocabulário da tela.

export type VisaoAgenda = 'mes' | 'semana' | 'dia';

export interface IntervaloAgenda {
  /** Primeiro dia mostrado (ISO). Na visão de mês, pode ser do mês anterior. */
  inicio: string;
  /** Último dia mostrado (ISO). Na visão de mês, pode ser do mês seguinte. */
  fim: string;
  /**
   * Todos os dias do intervalo, em ordem e sem buraco.
   *
   * Na visão de mês o tamanho é SEMPRE múltiplo de 7 — é a grade do calendário,
   * que começa num domingo e termina num sábado.
   */
  dias: string[];
}

const DIA_MS = 86_400_000;

/**
 * Epoch UTC de uma data ISO, ou null se a data não existe.
 *
 * A conferência é de ida e volta: `Date.UTC(2027, 1, 30)` não reclama, ele rola
 * para 02/03. Sem comparar o resultado com a entrada, '2027-02-29' viraria um
 * calendário começando no dia errado sem ninguém perceber.
 */
function epochDeIso(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const epoch = Date.UTC(ano, mes - 1, dia);
  const d = new Date(epoch);
  if (
    d.getUTCFullYear() !== ano ||
    d.getUTCMonth() !== mes - 1 ||
    d.getUTCDate() !== dia
  ) {
    return null;
  }
  return epoch;
}

function isoDeEpoch(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10);
}

/** Domingo da semana de `epoch` — a grade do calendário começa no domingo. */
function domingoDaSemana(epoch: number): number {
  return epoch - new Date(epoch).getUTCDay() * DIA_MS;
}

/**
 * O intervalo que a visão mostra.
 *
 * - `dia`: só a âncora.
 * - `semana`: domingo a sábado da semana da âncora. Âncora que JÁ é domingo não
 *   recua sete dias — é o erro de sinal clássico neste cálculo.
 * - `mes`: a grade inteira, do domingo da semana do dia 1 ao sábado da semana
 *   do último dia. Ela cobre dias fora do mês de propósito: é o que a `VisaoMes`
 *   desenha, e cortar nas bordas deixaria as linhas de cima e de baixo tortas.
 *
 * Data inválida LANÇA. Quem chama monta o ISO a partir de uma `Date` que ele
 * mesmo criou, então uma data impossível aqui é defeito de programação — e
 * defeito de programação tem de ser barulhento, não virar um calendário com o
 * mês errado.
 */
export function intervaloDaVisao(
  visao: VisaoAgenda,
  ancoraIso: string,
): IntervaloAgenda {
  const ancora = epochDeIso(ancoraIso);
  if (ancora === null) {
    throw new Error(`Data inválida para a agenda: ${ancoraIso}`);
  }

  if (visao === 'dia') {
    return { inicio: ancoraIso, fim: ancoraIso, dias: [ancoraIso] };
  }

  let inicio: number;
  let fim: number;
  if (visao === 'semana') {
    inicio = domingoDaSemana(ancora);
    fim = inicio + 6 * DIA_MS;
  } else {
    const d = new Date(ancora);
    const primeiro = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    // Dia 0 do mês seguinte = último dia deste mês. Serve para fevereiro e
    // para dezembro (mês 12 rola o ano) sem nenhum caso especial.
    const ultimo = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
    inicio = domingoDaSemana(primeiro);
    fim = domingoDaSemana(ultimo) + 6 * DIA_MS;
  }

  const dias: string[] = [];
  for (let e = inicio; e <= fim; e += DIA_MS) {
    dias.push(isoDeEpoch(e));
  }
  return { inicio: isoDeEpoch(inicio), fim: isoDeEpoch(fim), dias };
}
