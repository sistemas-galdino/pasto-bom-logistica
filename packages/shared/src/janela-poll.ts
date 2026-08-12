// Regra da JANELA do polling: a partir de que data perguntar ao Órix.
//
// Por que isso é uma regra, e não uma conta solta no worker (investigação de
// 11/08/2026)
// ---------------------------------------------------------------------------
// A API do Órix só filtra por DATA DO PEDIDO — não existe "alterado desde". E o
// pedido NÃO nasce em um status de gatilho: ele vira 00027 "Parcial" dias ou
// meses depois, quando sai o faturamento parcial.
//
// O código antigo perguntava "[cursor, hoje]" e gravava o cursor como hoje ao
// fim de cada tick. A janela encolhia para um único dia, e o pedido de ontem
// que entrasse no gatilho hoje nunca mais era perguntado: ficava fora do
// sistema para sempre. Em 11/08 faltavam 24 dos 135 pedidos elegíveis — os 6
// mais recentes, todos 00027.
//
// A correção tem duas partes, e esta é a barata: um PISO de alguns dias, que
// dá uma segunda olhada no passado recente sem custo nenhum. O resto (pedido
// que entra no gatilho meses depois) é a varredura profunda, que roda 1x/dia.
//
// O cursor continua importando para o caso oposto: worker fora do ar por dias.
// Por isso a regra é "o mais antigo entre o cursor e o piso" — as duas redes
// somadas, nunca uma anulando a outra.

/** Dias de piso do tick rápido: sempre reperguntar este passado recente. */
export const DIAS_REVISITA_PADRAO = 2;
/** Janela inicial quando ainda não há cursor (primeira execução). */
export const DIAS_FALLBACK_PADRAO = 30;

export interface EntradaJanelaPoll {
  /** `poll_cursor.last_to` (yyyy-mm-dd), ou null na primeira execução. */
  cursorLastTo: string | null;
  /** Hoje (yyyy-mm-dd). */
  hoje: string;
  /** Piso de revisita, em dias. */
  diasRevisita?: number;
  /** Fallback quando não há cursor, em dias. */
  diasFallback?: number;
}

function somarDias(iso: string, dias: number): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  );
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Calcula a data inicial da janela do tick rápido.
 *
 * Sempre o MAIS ANTIGO entre o cursor e (hoje - diasRevisita); nunca depois de
 * hoje. Datas são comparadas como string ISO, que ordena lexicograficamente.
 */
export function inicioJanelaPoll(entrada: EntradaJanelaPoll): string {
  const {
    cursorLastTo,
    hoje,
    diasRevisita = DIAS_REVISITA_PADRAO,
    diasFallback = DIAS_FALLBACK_PADRAO,
  } = entrada;

  const piso = somarDias(hoje, -Math.abs(diasRevisita));
  // Sem cursor (primeira execução) o fallback manda — e ele é mais largo que o
  // piso, então não há risco de estreitar a primeira carga.
  const base = cursorLastTo ?? somarDias(hoje, -Math.abs(diasFallback));

  const inicio = base < piso ? base : piso;
  // Cursor adiantado (relógio torto, data futura gravada) não pode gerar janela
  // invertida: o Órix devolveria vazio e o tick "passaria" sem ler nada.
  return inicio > hoje ? hoje : inicio;
}
