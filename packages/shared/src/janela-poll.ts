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

// ---------------------------------------------------------------------------
// QUANDO rodar a varredura profunda
// ---------------------------------------------------------------------------
//
// Por que não é um horário fixo (apontado pelo David em 12/08/2026)
// -----------------------------------------------------------------
// A primeira versão agendava a varredura às 3h20. Só que o servidor não fica
// ligado de madrugada — e a API do Órix também cai à noite. O cron disparava,
// a primeira sub-janela falhava, o circuit-breaker abortava, e a próxima
// tentativa era só no dia seguinte no mesmo horário ruim: a varredura nunca
// rodava, silenciosamente.
//
// A regra passa a ser por INTERVALO: "faz mais de N horas que não roda com
// sucesso?". Assim tanto faz quem dorme (o Órix ou o nosso serviço) e tanto faz
// qual é a janela de disponibilidade — a primeira oportunidade depois do prazo
// serve.
//
// O intervalo padrão é 20 h, não 24, DE PROPÓSITO: 24 fixaria a varredura no
// mesmo horário todo dia, que é justo o problema. Com 20 h ela anda ~4 h por dia
// no relógio e acaba caindo dentro da janela em que o Órix está de pé, sem
// ninguém precisar descobrir qual é essa janela.

/** Horas entre varreduras profundas bem-sucedidas. */
export const HORAS_ENTRE_VARREDURAS_PADRAO = 20;

export interface EntradaVarredura {
  /** `ultimoSucesso` da chave `varredura_profunda` (ISO), ou null se nunca rodou. */
  ultimoSucesso: string | null;
  /** Agora (ISO) — injetado para o teste ser determinístico. */
  agora: string;
  /** Intervalo mínimo, em horas. */
  horasIntervalo?: number;
}

/**
 * Decide se está na hora de rodar a varredura profunda.
 *
 * Nunca rodou → roda. Timestamp ilegível → roda (o lado seguro é varrer de
 * novo: a ingestão é idempotente, e o contrário seria nunca mais varrer por
 * causa de um campo corrompido).
 */
export function deveVarrer(entrada: EntradaVarredura): boolean {
  const {
    ultimoSucesso,
    agora,
    horasIntervalo = HORAS_ENTRE_VARREDURAS_PADRAO,
  } = entrada;

  if (!ultimoSucesso) return true;

  const decorridoMs = Date.parse(agora) - Date.parse(ultimoSucesso);
  if (Number.isNaN(decorridoMs)) return true;

  // Registro no futuro (relógio torto) não pode travar a varredura para sempre.
  if (decorridoMs < 0) return true;

  return decorridoMs >= Math.abs(horasIntervalo) * 3_600_000;
}
