// [AGENTE WORKER] ESPELHO DE ESTOQUE DOS PRODUTOS DO ÓRIX.
//
// POR QUE ISTO EXISTE (Natália, reunião de 27/08/2026)
// ---------------------------------------------------
//   "a gente precisa ler a quantidade de produto... é a quantidade de produto
//    que vai me falar se eu tenho aquele produto para entregar para aquele
//    cliente ou não"
//
// O alerta aparece no modal de agendar e NUNCA bloqueia — ela foi explícita. O
// dado alimenta uma frase; travar o agendamento por estoque pararia a operação
// num ERP que erra cadastro.
//
// A CONFERÊNCIA QUE AUTORIZOU ESTA ONDA (14/09/2026, contra a API de verdade)
// ---------------------------------------------------------------------------
// O plano previa não subir a feature se `quantidade` viesse zerada em todo mundo
// — um alerta que grita em todo produto ensina a equipe a ignorá-lo, e aí o
// alerta verdadeiro também passa batido. Foi medido:
//
//   15.418 produtos, 9.759 ativos, 31 páginas.
//   `quantidade` == soma de deposito_1..5 nos 9.759 ativos, SEM exceção.
//   `estoque_fisico` > `quantidade` em 61% dos ativos (00028: 14 contra 710).
//   Dos 632 produtos que a operação entrega de verdade: 100% estão no
//   /Produtos e 86% têm quantidade > 0.
//
// Ou seja, o dado presta — diferente do `peso` da API, que a 0008 registra como
// 91% vazio. E a escolha dela (`quantidade`, descartando `estoque_fisico`)
// estava certa: `estoque_fisico` não é estoque atual.
//
// MESMA POSTURA DO ESPELHO DE FORNECEDORES, e pelos mesmos motivos:
//
//   NUNCA DELETAR QUEM NÃO VEIO. São 31 páginas contra um servidor instável;
//   página 9 falhar é rotina. Um espelho que apaga o ausente esvaziaria o
//   estoque no meio do expediente por causa de um timeout — e estoque ausente
//   vira "não sei", que é justamente o que faz o alerta calar. Só UPSERT.
//
//   CICLO PARCIAL NÃO CARIMBA SUCESSO. `ultimoSucesso` só avança em ciclo
//   completo; é o que faz o scheduler tentar de novo em vez de dormir achando
//   que espelhou tudo.
//
// A DIFERENÇA em relação a fornecedores: estoque é MOVIMENTO, não cadastro.
// Fornecedor muda devagar (24 h basta); estoque muda o dia todo, daí
// ESTOQUE_INTERVALO_HORAS = 3.

import { OrixClient, type OrixProduto } from '../orix/client.js';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { log } from '../log.js';

/**
 * Registros por página. 500 foi o tamanho usado na conferência de 14/09 contra
 * a API de produção: 31 páginas para os 15.418 produtos, sem estourar o timeout
 * de 30 s do client.
 */
export const LIMITE_PAGINA = 500;

/**
 * Teto de páginas por ciclo. Trava contra API que devolva `paginas` absurdo (ou
 * sempre a mesma página): sem isto, um bug do lado deles vira loop infinito
 * aqui. 200 páginas = 100 mil produtos, seis vezes o cadastro atual.
 */
const MAX_PAGINAS = 200;

/** Linhas por upsert. */
const LOTE_UPSERT = 500;

/** Chave do heartbeat em `sync_state`. */
export const CHAVE_SYNC = 'produtos_estoque';

export interface ResultadoProdutos {
  /** false = alguma página falhou; o ciclo NÃO conta como sucesso. */
  ok: boolean;
  paginasTotal: number;
  paginasLidas: number;
  registros: number;
  gravados: number;
  /** Descartados por não ter `codigo` (PK da tabela). */
  semCodigo: number;
  /** Cobertura do ciclo — é o número que decide se o alerta presta. */
  comQuantidade: number;
  zerados: number;
  negativos: number;
  motivoAbort?: string;
}

/** Linha de `produtos_estoque` (migração 0024). */
interface LinhaEstoque {
  produto_codigo: string;
  nome_produto: string | null;
  quantidade: number | null;
  unidade: string | null;
  ativo: boolean;
  atualizado_em: string;
}

/** Texto do Órix -> texto do banco. Vazio vira NULL; nada é inventado. */
function texto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  return s === '' ? null : s;
}

/**
 * Quantidade do Órix -> numeric do banco.
 *
 * `null` quando ilegível — e `null` significa "NÃO SEI", nunca zero. É a
 * distinção que impede o primeiro dia de uso de virar um alerta em todo item.
 *
 * ARREDONDAMENTO NA 3ª CASA, como `somar` em saldo.ts: a API devolve coisas
 * como -4.44e-16 (produto 08402, medido em 14/09), que sem isto viraria
 * "estoque negativo: -0,00000000000000044" na tela da equipe.
 */
export function normalizarQuantidade(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
}

/**
 * 'S'/'N' do Órix -> boolean.
 *
 * Ausente ou irreconhecível => TRUE, mesma convenção de `normalizarAtivo` em
 * fornecedores.ts. Aqui o dano de esconder é menor (o estoque de um produto
 * inativo simplesmente não é consultado), mas manter as duas iguais evita que
 * alguém "corrija" uma delas achando que são regras diferentes.
 */
export function normalizarAtivo(valor: unknown): boolean {
  const s = texto(valor);
  if (s === null) return true;
  const primeira = s[0]?.toUpperCase();
  if (primeira === 'N' || primeira === 'F' || s === '0') return false;
  return true;
}

/** Registro cru -> linha do espelho. null se não houver `codigo`. */
function mapearLinha(p: OrixProduto, agora: string): LinhaEstoque | null {
  // O código vem com zeros à esquerda ('00028') e é assim que ele aparece em
  // itens_pedido. NÃO normalizar: tirar os zeros quebraria o join com o pedido.
  const codigo = texto(p.codigo);
  if (codigo === null) return null;

  return {
    produto_codigo: codigo,
    nome_produto: texto(p.nome),
    quantidade: normalizarQuantidade(p.quantidade),
    unidade: texto(p.unidade),
    ativo: normalizarAtivo(p.ativo),
    atualizado_em: agora,
  };
}

/** Grava um lote. Falha marca ok=false mas não derruba o ciclo. */
async function gravarLote(linhas: LinhaEstoque[]): Promise<boolean> {
  if (linhas.length === 0) return true;
  const { error } = await supabase
    .from('produtos_estoque')
    .upsert(linhas, { onConflict: 'produto_codigo' });
  if (error) {
    log.warn(
      `[produtos] Falha ao gravar lote de ${linhas.length} registro(s): ${error.message}`,
    );
    return false;
  }
  return true;
}

/**
 * Executa UM ciclo: percorre as páginas de GET /Produtos e faz upsert de cada.
 *
 * Grava PÁGINA A PÁGINA em vez de acumular tudo: se a página 20 falhar, as 19
 * primeiras já estão no espelho, e a próxima tentativa recomeça do topo — o que
 * é idempotente.
 */
export async function sincronizarProdutosOnce(): Promise<ResultadoProdutos> {
  const inicio = Date.now();
  const agora = new Date().toISOString();
  const resultado: ResultadoProdutos = {
    ok: true,
    paginasTotal: 0,
    paginasLidas: 0,
    registros: 0,
    gravados: 0,
    semCodigo: 0,
    comQuantidade: 0,
    zerados: 0,
    negativos: 0,
  };

  const orix = new OrixClient({
    baseUrl: env.ORIX_BASE_URL,
    login: env.ORIX_LOGIN,
    senha: env.ORIX_SENHA,
  });

  let paginas = 1;
  const pendentes: LinhaEstoque[] = [];

  for (let pagina = 1; pagina <= paginas && pagina <= MAX_PAGINAS; pagina += 1) {
    let lote: OrixProduto[];
    try {
      const resposta = await orix.getProdutos({
        pagina,
        limite: LIMITE_PAGINA,
        empresa: env.ORIX_EMPRESA,
      });
      paginas = resposta.paginas;
      resultado.paginasTotal = paginas;
      lote = resposta.registros;
    } catch (err) {
      // CIRCUIT-BREAKER: a primeira página que falha encerra o ciclo. Insistir
      // nas outras 30 contra um servidor fora só gasta 30 s de timeout cada.
      const motivo = err instanceof Error ? err.message : String(err);
      log.error(
        `[produtos] Órix falhou na página ${pagina}; abortando o ciclo. ` +
          `Motivo: ${motivo}`,
      );
      resultado.ok = false;
      resultado.motivoAbort = motivo;
      break;
    }

    resultado.paginasLidas += 1;
    resultado.registros += lote.length;

    // AS CHAVES REAIS DO PRIMEIRO REGISTRO, uma vez por ciclo. Elas foram
    // conferidas daqui em 14/09/2026, mas o Órix é um ERP em manutenção: se um
    // dia `quantidade` sumir ou virar outro nome, esta linha no log do Easypanel
    // é o que separa "achado em cinco minutos" de "o alerta parou e ninguém
    // sabe por quê".
    if (pagina === 1 && lote[0]) {
      log.info(
        `[produtos] campos do 1º registro: ${Object.keys(lote[0]).join(', ')}`,
      );
    }

    for (const cru of lote) {
      const linha = mapearLinha(cru, agora);
      if (!linha) {
        resultado.semCodigo += 1;
        continue;
      }
      if (linha.quantidade !== null) {
        if (linha.quantidade > 0) resultado.comQuantidade += 1;
        else if (linha.quantidade < 0) resultado.negativos += 1;
        else resultado.zerados += 1;
      }
      pendentes.push(linha);
    }

    while (pendentes.length >= LOTE_UPSERT) {
      const fatia = pendentes.splice(0, LOTE_UPSERT);
      if (await gravarLote(fatia)) resultado.gravados += fatia.length;
      else resultado.ok = false;
    }

    // Página vazia antes do total anunciado: o cadastro encolheu, ou a API
    // mentiu. Continuar seria pedir páginas vazias até MAX_PAGINAS.
    if (lote.length === 0) break;
  }

  if (pendentes.length > 0) {
    if (await gravarLote(pendentes)) resultado.gravados += pendentes.length;
    else resultado.ok = false;
  }

  // O RESUMO DE COBERTURA no log é o que responde, sem abrir o banco, se o
  // alerta ainda presta. Na medição de 14/09: 6.478 com quantidade > 0 no
  // cadastro inteiro. Se um dia isto virar zero, a feature parou de servir e a
  // conversa volta para a Natália com o número na mão.
  log.info(
    `[produtos] Ciclo ${resultado.ok ? 'concluído' : 'PARCIAL'} em ` +
      `${Date.now() - inicio}ms: ${resultado.paginasLidas}/${resultado.paginasTotal} ` +
      `página(s), ${resultado.registros} lido(s), ${resultado.gravados} gravado(s). ` +
      `Cobertura: ${resultado.comQuantidade} com quantidade > 0, ` +
      `${resultado.zerados} em zero, ${resultado.negativos} negativo(s)` +
      (resultado.semCodigo > 0
        ? `, ${resultado.semCodigo} sem código (descartado(s))`
        : '') +
      '. Nenhum produto é apagado por não ter vindo.',
  );

  return resultado;
}

/**
 * Heartbeat em `sync_state`, chave 'produtos_estoque'.
 *
 * A chave NÃO é 'produtos': 'produtos_servico' já existe em sync_state (é a
 * lista de itens de prestação de serviço, lida por orix/status.ts) e um prefixo
 * parecido demais convida a confusão na hora de depurar.
 *
 * Contrato igual ao de fornecedores: `ultimoSucesso` SÓ avança em ciclo
 * completo — é isso que o scheduler consulta para decidir se tenta de novo.
 */
export async function registrarSincronizacaoProdutos(
  resultado: ResultadoProdutos,
): Promise<void> {
  const agora = new Date().toISOString();

  const { data, error: erroLeitura } = await supabase
    .from('sync_state')
    .select('valor')
    .eq('chave', CHAVE_SYNC)
    .maybeSingle();
  if (erroLeitura) {
    log.warn(
      `[produtos] Falha ao ler sync_state '${CHAVE_SYNC}': ${erroLeitura.message}`,
    );
  }
  const anterior =
    (data?.valor as { ultimoSucesso?: string | null } | undefined) ?? null;

  const valor = {
    ultimoSucesso: resultado.ok ? agora : (anterior?.ultimoSucesso ?? null),
    ultimoTick: agora,
    sucesso: resultado.ok,
    paginasLidas: resultado.paginasLidas,
    paginasTotal: resultado.paginasTotal,
    gravados: resultado.gravados,
    comQuantidade: resultado.comQuantidade,
  };

  const { error } = await supabase
    .from('sync_state')
    .upsert(
      { chave: CHAVE_SYNC, valor, atualizado_em: agora },
      { onConflict: 'chave' },
    );
  if (error) {
    log.warn(
      `[produtos] Falha ao gravar sync_state '${CHAVE_SYNC}': ${error.message}`,
    );
  }
}
