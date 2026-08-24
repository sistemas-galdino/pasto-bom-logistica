// [AGENTE WORKER] ESPELHO DO CADASTRO DE FORNECEDORES DO ÓRIX.
//
// POR QUE ISTO EXISTE (áudio 5 da Natália, 08/2026)
// -------------------------------------------------
// Na reserva de caminhão (migração 0021), quando o motivo é buscar mercadoria
// num fornecedor, "puxar o fornecedor já vai trazer a cidade". Sem espelho, a
// alternativa seria consultar o Órix a cada tecla do autocomplete — contra um
// servidor que cai à noite e dá blip de dia. Espelhamos o cadastro (~3.600
// fornecedores) e o autocomplete lê do nosso banco, que está sempre no ar.
//
// Mesmo papel de `clientes`: a ingestão escreve, o sistema lê. A API do Órix é
// SOMENTE LEITURA — nada daqui volta para lá.
//
// A REGRA QUE MANDA NESTE ARQUIVO: NUNCA DELETAR QUEM NÃO VEIO
// ------------------------------------------------------------
// A tentação óbvia num espelho é "apaga tudo e regrava" (ou marcar ativo=false
// em quem não apareceu). Com 18 páginas contra um servidor instável, a página 9
// falhar é rotina — e um espelho que apaga o que não veio esvaziaria o
// autocomplete no meio do expediente por causa de um timeout. Fornecedor a mais
// na lista é irrelevante (a pessoa procura pelo nome); lista vazia impede a
// logística de trabalhar. Então só fazemos UPSERT, jamais DELETE.
//
// Fornecedor desativado no Órix vira ativo=false pelo próprio campo `ativo`
// ('S'/'N') do registro — quando ele vem na resposta. Ausência não é sinal de
// nada aqui (diferente de worker/reconciliar.ts, onde a ausência é tratada com
// carência, freio de volume e cuidado; lá o dado é o pedido, e o Órix devolve o
// universo consultado; aqui a resposta é paginada e uma página perdida já
// falsifica a conclusão).
//
// CICLO PARCIAL NÃO CARIMBA SUCESSO
// ---------------------------------
// Se qualquer página falhar, gravamos o tick mas NÃO o `ultimoSucesso` em
// sync_state — mesma convenção de registrarSincronizacao() em poll.ts. É isso
// que faz o scheduler tentar de novo na próxima hora em vez de esperar 24 h
// achando que espelhou tudo. O que já foi gravado permanece: página 1 a 8 no
// banco é melhor que nada.

import { OrixClient, type OrixFornecedor } from '../orix/client.js';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';
import { log } from '../log.js';

/**
 * Registros por página. 200 é o mesmo tamanho que a auditoria de contatos usa
 * em /Clientes e que a API aguenta sem estourar o timeout de 30 s do client:
 * ~18 páginas para os ~3.600 fornecedores.
 */
export const LIMITE_PAGINA = 200;

/**
 * Teto de páginas por ciclo. Trava de segurança contra API que devolve
 * `paginas` absurdo (ou sempre a mesma página): sem isto, um bug do lado deles
 * viraria loop infinito no nosso worker. 200 páginas = 40 mil fornecedores, dez
 * vezes o cadastro atual.
 */
const MAX_PAGINAS = 200;

/** Linhas por upsert. Lotes evitam um INSERT gigante em uma só chamada. */
const LOTE_UPSERT = 500;

/** Chave do heartbeat em `sync_state`. */
export const CHAVE_SYNC = 'fornecedores';

export interface ResultadoFornecedores {
  /** false = alguma página falhou; o ciclo NÃO conta como sucesso. */
  ok: boolean;
  /** Total de páginas que o Órix disse existir (0 se nem a primeira veio). */
  paginasTotal: number;
  /** Páginas efetivamente lidas com sucesso. */
  paginasLidas: number;
  /** Registros recebidos do Órix (soma das páginas lidas). */
  registros: number;
  /** Registros gravados no espelho (upsert por `codigo`). */
  gravados: number;
  /** Registros descartados por não ter `codigo` (PK da tabela). */
  semCodigo: number;
  motivoAbort?: string;
}

/** Linha de `fornecedores` (migração 0021), já em snake_case do banco. */
interface LinhaFornecedor {
  codigo: string;
  nome: string | null;
  fantasia: string | null;
  tipo: string | null;
  cpf_cnpj: string | null;
  endereco: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  cep: string | null;
  cod_municipio: string | null;
  uf: string | null;
  telefone: string | null;
  celular: string | null;
  email: string | null;
  ativo: boolean;
  atualizado_em: string;
}

/**
 * Texto do Órix -> texto do banco. String vazia e espaço em branco viram NULL:
 * o cadastro é preenchido à mão e '' no meio de um `ilike` só polui a busca.
 * Nada de inventar valor — campo que a API não manda fica null.
 */
function texto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  return s === '' ? null : s;
}

/**
 * 'S'/'N' do Órix -> boolean.
 *
 * Ausente ou irreconhecível => TRUE, alinhado ao `default true` da coluna na
 * 0021: na prática a lista devolve fornecedor sem o campo preenchido, e o dano
 * de esconder um fornecedor ativo (a logística não acha quem existe) é maior
 * que o de mostrar um inativo.
 */
export function normalizarAtivo(valor: unknown): boolean {
  const s = texto(valor);
  if (s === null) return true;
  const primeira = s[0]?.toUpperCase();
  if (primeira === 'N' || primeira === 'F' || s === '0') return false;
  return true;
}

/** Registro cru do Órix -> linha do espelho. null se não houver `codigo`. */
function mapearLinha(f: OrixFornecedor, agora: string): LinhaFornecedor | null {
  const codigo = texto(f.codigo);
  if (codigo === null) return null;

  return {
    codigo,
    nome: texto(f.nome),
    fantasia: texto(f.fantasia),
    tipo: texto(f.tipo),
    cpf_cnpj: texto(f.cpf_cnpj),
    endereco: texto(f.endereco),
    numero: texto(f.numero),
    bairro: texto(f.bairro),
    cidade: texto(f.cidade),
    cep: texto(f.cep),
    cod_municipio: texto(f.cod_municipio),
    uf: texto(f.uf),
    telefone: texto(f.telefone),
    celular: texto(f.celular),
    email: texto(f.email),
    ativo: normalizarAtivo(f.ativo),
    atualizado_em: agora,
  };
}

/**
 * Grava um lote no espelho. `onConflict: 'codigo'` porque `codigo` é a PK
 * (0021): o mesmo fornecedor reaparece em todo ciclo, e o que queremos é
 * refrescar os campos, não acumular duplicata.
 *
 * Falha de gravação NÃO derruba o ciclo, mas marca ok=false: as outras páginas
 * ainda valem, e o `ultimoSucesso` não avança, então a próxima hora tenta de
 * novo.
 */
async function gravarLote(linhas: LinhaFornecedor[]): Promise<boolean> {
  if (linhas.length === 0) return true;
  const { error } = await supabase
    .from('fornecedores')
    .upsert(linhas, { onConflict: 'codigo' });
  if (error) {
    log.warn(
      `[fornecedores] Falha ao gravar lote de ${linhas.length} registro(s): ${error.message}`,
    );
    return false;
  }
  return true;
}

/**
 * Executa UM ciclo de espelhamento: percorre as páginas de GET /Fornecedores e
 * faz upsert de cada uma.
 *
 * Não lança em falha do Órix: loga, para o loop e devolve { ok:false }. Quem
 * chama (scheduler ou script) decide o que registrar.
 *
 * Grava PÁGINA A PÁGINA em vez de acumular tudo e gravar no fim: se a página 9
 * falhar, as oito primeiras já estão no espelho — e a próxima tentativa começa
 * de novo do topo, que é idempotente.
 */
export async function sincronizarFornecedoresOnce(): Promise<ResultadoFornecedores> {
  const inicio = Date.now();
  const agora = new Date().toISOString();
  const resultado: ResultadoFornecedores = {
    ok: true,
    paginasTotal: 0,
    paginasLidas: 0,
    registros: 0,
    gravados: 0,
    semCodigo: 0,
  };

  const orix = new OrixClient({
    baseUrl: env.ORIX_BASE_URL,
    login: env.ORIX_LOGIN,
    senha: env.ORIX_SENHA,
  });

  // Começa em 1 e só descobre o total depois da primeira resposta — o Órix
  // devolve `paginas` no envelope.
  let paginas = 1;
  const pendentes: LinhaFornecedor[] = [];

  for (let pagina = 1; pagina <= paginas && pagina <= MAX_PAGINAS; pagina += 1) {
    let lote: OrixFornecedor[];
    try {
      const resposta = await orix.getFornecedores({
        pagina,
        limite: LIMITE_PAGINA,
      });
      paginas = resposta.paginas;
      resultado.paginasTotal = paginas;
      lote = resposta.registros;
    } catch (err) {
      // CIRCUIT-BREAKER (mesma postura de poll.ts/reconciliar.ts): a primeira
      // página que falha encerra o ciclo. Insistir nas outras 9 contra um
      // servidor que já está fora só gasta 30 s de timeout cada.
      const motivo = err instanceof Error ? err.message : String(err);
      log.error(
        `[fornecedores] Órix falhou na página ${pagina}; abortando o ciclo. ` +
          `Motivo: ${motivo}`,
      );
      resultado.ok = false;
      resultado.motivoAbort = motivo;
      break;
    }

    resultado.paginasLidas += 1;
    resultado.registros += lote.length;

    for (const cru of lote) {
      const linha = mapearLinha(cru, agora);
      if (!linha) {
        // Sem `codigo` não há PK: gravar isso quebraria o upsert do lote todo.
        resultado.semCodigo += 1;
        continue;
      }
      pendentes.push(linha);
    }

    while (pendentes.length >= LOTE_UPSERT) {
      const fatia = pendentes.splice(0, LOTE_UPSERT);
      if (await gravarLote(fatia)) resultado.gravados += fatia.length;
      else resultado.ok = false;
    }

    // Página vazia antes do total anunciado: o cadastro encolheu entre o
    // `paginas` que recebemos e agora, ou a API mentiu. Continuar seria pedir
    // páginas vazias até MAX_PAGINAS.
    if (lote.length === 0) break;
  }

  if (pendentes.length > 0) {
    if (await gravarLote(pendentes)) resultado.gravados += pendentes.length;
    else resultado.ok = false;
  }

  log.info(
    `[fornecedores] Ciclo ${resultado.ok ? 'concluído' : 'PARCIAL'} em ` +
      `${Date.now() - inicio}ms: ${resultado.paginasLidas}/${resultado.paginasTotal} ` +
      `página(s), ${resultado.registros} registro(s) lido(s), ` +
      `${resultado.gravados} gravado(s)` +
      (resultado.semCodigo > 0
        ? `, ${resultado.semCodigo} sem código (descartado(s))`
        : '') +
      '. Nenhum fornecedor é apagado por não ter vindo.',
  );

  return resultado;
}

/**
 * Heartbeat do espelho em `sync_state`, chave 'fornecedores'.
 *
 * Espelha registrarSincronizacao() de poll.ts em formato e em intenção, mas é
 * uma função separada porque a de lá recebe um ResultadoPoll (janelas/itens/
 * pedidos) e tem a chave restrita a 'sync_status' | 'varredura_profunda'. O
 * contrato que importa é o mesmo, e é ele que o scheduler consulta:
 * `ultimoSucesso` SÓ avança em ciclo completo.
 */
export async function registrarSincronizacaoFornecedores(
  resultado: ResultadoFornecedores,
): Promise<void> {
  const agora = new Date().toISOString();

  const { data, error: erroLeitura } = await supabase
    .from('sync_state')
    .select('valor')
    .eq('chave', CHAVE_SYNC)
    .maybeSingle();
  if (erroLeitura) {
    log.warn(
      `[fornecedores] Falha ao ler sync_state '${CHAVE_SYNC}': ${erroLeitura.message}`,
    );
  }
  const anterior =
    (data?.valor as { ultimoSucesso?: string | null } | undefined) ?? null;

  const valor = {
    // Em ciclo parcial preserva o sucesso ANTERIOR: é o que faz o scheduler
    // tentar de novo na próxima hora em vez de dormir 24 h.
    ultimoSucesso: resultado.ok ? agora : (anterior?.ultimoSucesso ?? null),
    ultimoTick: agora,
    sucesso: resultado.ok,
    paginasLidas: resultado.paginasLidas,
    paginasTotal: resultado.paginasTotal,
    gravados: resultado.gravados,
  };

  const { error } = await supabase
    .from('sync_state')
    .upsert(
      { chave: CHAVE_SYNC, valor, atualizado_em: agora },
      { onConflict: 'chave' },
    );
  if (error) {
    log.warn(
      `[fornecedores] Falha ao gravar sync_state '${CHAVE_SYNC}': ${error.message}`,
    );
  }
}
