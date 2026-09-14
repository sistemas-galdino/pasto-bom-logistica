// ROTA DE CIDADE — "toda terça-feira eu vou para Cabo Verde na parte da manhã".
//
// O QUE ELA É, E O QUE ELA NÃO É
// ---------------------------------------------------------------------------
// É um LETREIRO NO DIA. Não reserva caminhão, não ocupa slot, não consome o
// teto de entregas e não impede agendar outra cidade no mesmo período. Foi
// assim que a Natália descreveu na reunião de 27/08, e é por isso que ela NÃO
// entra em `AgendaSlot`: o slot é a estrutura que `filtrarSlotsPorCaminhao`
// recorta por caminhão, e a rota não é de um caminhão. Posta lá dentro, filtrar
// a agenda por caminhão apagaria o chip de Cabo Verde — exatamente onde ela
// pediu que ele aparecesse ("na hora que ele vier aqui na agenda do caminhão,
// vai mostrar para ele").
//
// AS TRÊS ARMADILHAS QUE ESTE ARQUIVO EXISTE PARA FECHAR
// ---------------------------------------------------------------------------
// 1. FUSO. `new Date('2026-09-15')` é UTC; em UTC-3 ele volta um dia e a rota
//    de terça aparece na segunda. Tudo aqui anda em `Date.UTC` e nenhuma data
//    do laço é reparseada — a varredura soma 86.400.000 sobre o epoch, então
//    virada de mês, bissexto e horário de verão não têm por onde entrar.
// 2. GRAFIA. "CABO VERDE", "Cabo Verde" e "cabo  verde" são a mesma cidade para
//    efeito de duplicata, e NÃO são normalizadas para exibição: o chip mostra o
//    que a pessoa cadastrou. Reescrever "são joão" para "São João" erra em nome
//    composto e em "del-Rei".
// 3. DUPLICATA. Cadastrar a mesma cidade duas vezes na mesma terça de manhã não
//    é erro de operação, é erro de configuração — mas ele ACONTECE (dois
//    cliques, edição direta no banco), e um chip repetido no mesmo dia parece
//    defeito do sistema. A rota recusa no cadastro (409) e a expansão deduplica
//    na leitura: são duas defesas para dois problemas diferentes.
//
// CIDADES DIFERENTES NO MESMO DIA NUNCA CONFLITAM. É o pedido, não o problema:
// dá para ir a Cabo Verde de manhã e a Boa Esperança à tarde.

import { janelasSeSobrepoem } from './limite-entregas.js';
import type { PeriodoEntrega } from './types/domain.js';

/** Domingo = 0 … sábado = 6, a numeração de `Date#getDay` e de `extract(dow)`. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Uma configuração de rota de cidade, como está na tabela `rotas_cidade`. */
export interface RotaCidadeConfig {
  id: string;
  /** A grafia digitada, que é a que aparece no chip. */
  cidade: string;
  diasSemana: number[];
  periodos: PeriodoEntrega[];
  /** Data ISO inicial, inclusiva. */
  validoDe: string;
  /** Data ISO final, inclusiva. null = vigência aberta. */
  validoAte: string | null;
  ativo: boolean;
  observacoes?: string | null;
}

/** Uma ocorrência da rota num slot concreto do calendário. */
export interface RotaCidadeNoSlot {
  /** Data ISO (YYYY-MM-DD). */
  data: string;
  periodo: PeriodoEntrega;
  /** A grafia cadastrada — para mostrar. */
  cidade: string;
  /** A configuração que gerou esta ocorrência (para o `title` e a edição). */
  configId: string;
}

const DIA_MS = 86_400_000;
const PERIODOS_VALIDOS: readonly PeriodoEntrega[] = ['manha', 'tarde'];

/**
 * Epoch UTC de uma data ISO, ou null se a data não existe.
 *
 * O round-trip não é zelo excessivo: `Date.UTC(2027, 1, 30)` não reclama, ele
 * ROLA para 02/03. Sem conferir, '2027-02-29' viraria uma rota aparecendo num
 * dia que ninguém configurou.
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

/**
 * Dia da semana de uma data ISO: 0 = domingo … 6 = sábado. null se inválida.
 *
 * SEMPRE `Date.UTC` + `getUTCDay`. `new Date(iso).getDay()` no fuso do Brasil
 * devolve o dia ANTERIOR, e a rota de terça apareceria na segunda — sem erro
 * nenhum, só com o chip no lugar errado.
 */
export function diaDaSemanaIso(iso: string): DiaSemana | null {
  const epoch = epochDeIso(iso);
  if (epoch === null) return null;
  return new Date(epoch).getUTCDay() as DiaSemana;
}

/**
 * Chave de comparação de cidade: aparada, espaços colapsados, sem acento, em
 * caixa alta.
 *
 * NUNCA EXIBIDA. Ela existe para responder "é a mesma cidade?" e nada mais.
 */
export function chaveCidade(cidade: string): string {
  return cidade
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** A configuração é utilizável? Lixo é ignorado sem derrubar as outras. */
function configValida(c: RotaCidadeConfig): boolean {
  return (
    c.ativo &&
    chaveCidade(c.cidade) !== '' &&
    epochDeIso(c.validoDe) !== null &&
    (c.validoAte === null || epochDeIso(c.validoAte) !== null)
  );
}

function diasValidos(c: RotaCidadeConfig): Set<number> {
  return new Set(
    (c.diasSemana ?? []).filter(
      (d) => Number.isInteger(d) && d >= 0 && d <= 6,
    ),
  );
}

function periodosValidos(c: RotaCidadeConfig): PeriodoEntrega[] {
  return PERIODOS_VALIDOS.filter((p) => (c.periodos ?? []).includes(p));
}

/**
 * Expande as configurações nas ocorrências que caem entre `de` e `ate`
 * (inclusive nas duas pontas).
 *
 * A varredura anda somando um dia sobre o EPOCH e nenhuma data do laço é
 * reparseada: a única conversão ISO→número acontece nas bordas.
 *
 * DEDUPLICA por (data, período, chave da cidade). Duas configurações que
 * gerassem a mesma terça de manhã em Cabo Verde produziriam dois chips iguais
 * no mesmo dia, o que se lê como defeito. Vence a primeira — e a 409 da rota é
 * que evita a situação chegar até aqui.
 *
 * Configuração inativa, com data impossível ou com cidade em branco é ignorada,
 * e as válidas ao lado continuam valendo: uma linha estragada no banco não pode
 * apagar o calendário inteiro.
 */
export function expandirRotasCidade(
  configs: readonly RotaCidadeConfig[],
  de: string,
  ate: string,
): RotaCidadeNoSlot[] {
  const inicio = epochDeIso(de);
  const fim = epochDeIso(ate);
  if (inicio === null || fim === null || inicio > fim) return [];

  const vistos = new Set<string>();
  const resultado: RotaCidadeNoSlot[] = [];

  for (const config of configs) {
    if (!configValida(config)) continue;

    const dias = diasValidos(config);
    const periodos = periodosValidos(config);
    if (dias.size === 0 || periodos.length === 0) continue;

    // O recorte da vigência acontece aqui, e não em SQL, para a borda inclusiva
    // existir escrita num lugar só.
    const vigDe = epochDeIso(config.validoDe) as number;
    const vigAte =
      config.validoAte === null ? null : (epochDeIso(config.validoAte) as number);

    const primeiro = Math.max(inicio, vigDe);
    const ultimo = vigAte === null ? fim : Math.min(fim, vigAte);
    if (primeiro > ultimo) continue;

    const chave = chaveCidade(config.cidade);

    for (let e = primeiro; e <= ultimo; e += DIA_MS) {
      if (!dias.has(new Date(e).getUTCDay())) continue;
      const data = new Date(e).toISOString().slice(0, 10);
      for (const periodo of periodos) {
        const dedupe = `${data}|${periodo}|${chave}`;
        if (vistos.has(dedupe)) continue;
        vistos.add(dedupe);
        resultado.push({
          data,
          periodo,
          cidade: config.cidade,
          configId: config.id,
        });
      }
    }
  }

  return resultado.sort((a, b) => {
    if (a.data !== b.data) return a.data.localeCompare(b.data);
    if (a.periodo !== b.periodo) return a.periodo === 'manha' ? -1 : 1;
    return chaveCidade(a.cidade).localeCompare(chaveCidade(b.cidade), 'pt-BR');
  });
}

/**
 * Duas configurações brigam pelo mesmo espaço?
 *
 * Mesma cidade + algum dia da semana em comum + algum período em comum +
 * vigências cruzadas. É a condição do 409 no cadastro.
 *
 * Cidades DIFERENTES nunca conflitam, nem no mesmo dia e período: ir a Cabo
 * Verde de manhã e a Boa Esperança à tarde — ou às duas de manhã, com dois
 * caminhões — é o uso normal, não o problema.
 *
 * A vigência usa `janelasSeSobrepoem`, a MESMA função do teto de entregas
 * (0020). Uma regra de sobreposição, testada uma vez, usada por duas features.
 */
export function rotasConflitam(
  a: RotaCidadeConfig,
  b: RotaCidadeConfig,
): boolean {
  if (a.id !== '' && a.id === b.id) return false;
  if (chaveCidade(a.cidade) !== chaveCidade(b.cidade)) return false;

  const diasA = diasValidos(a);
  const temDia = [...diasValidos(b)].some((d) => diasA.has(d));
  if (!temDia) return false;

  const periodosA = periodosValidos(a);
  const temPeriodo = periodosValidos(b).some((p) => periodosA.includes(p));
  if (!temPeriodo) return false;

  return janelasSeSobrepoem(a, b);
}
