// [AGENTE WORKER] Ingestão IDEMPOTENTE de pedidos vindos da Órix.
//
// Regras (do CONTRATO):
//  - Agrupar OrixPedidoItem[] por id_pedido (a API retorna 1 linha por produto).
//  - ANTES do upsert do pedido, enriquecer clientes e propriedades
//    (upsert clientes via getCliente / upsert propriedades via getPropriedades).
//  - Upsert do pedido por orix_id_pedido (ON CONFLICT):
//      * ao INSERIR (pedido novo): status_logistico = 'pendente';
//      * ao ATUALIZAR (pedido já existente): NUNCA sobrescrever status_logistico
//        (o estado logístico é manual). Só atualiza status_orix, valores e itens.
//  - Recriar (substituir) os itens_pedido do pedido a cada ingestão.
//  - Converter datas dd/mm/yyyy -> ISO (yyyy-mm-dd) ao persistir.
//  - valor_total = soma dos totais dos itens.
//  - A INGESTÃO NUNCA envia WhatsApp.
//
// Reprocessar a mesma janela não duplica nem reenvia nada: o controle de
// duplicidade é a UNIQUE em pedidos.orix_id_pedido + a recriação determinística
// dos itens; nenhum efeito colateral (WhatsApp/eventos) é disparado aqui.

import type { OrixClient } from '../orix/client.js';
import type { OrixPedidoItem } from '@pastobom/shared';
import { escolherNumeroWhatsApp, transportarSeparacao } from '@pastobom/shared';
import { supabase } from '../db/supabase.js';
import { log } from '../log.js';
import { getNaturezaPermitida, normalizarNatureza } from '../orix/status.js';
import { semearPesosAuto } from '../services/carga.js';

/** Converte uma data dd/mm/yyyy (formato da Órix) para ISO yyyy-mm-dd.
 *  Retorna null se a entrada estiver vazia ou em formato inesperado. */
export function dataOrixParaISO(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const txt = String(valor).trim();
  if (!txt) return null;

  // dd/mm/yyyy (com hora opcional, que descartamos para coluna date)
  const m = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }

  // Já está em ISO yyyy-mm-dd?
  const iso = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

/** Coerção numérica tolerante: aceita number, string com vírgula decimal, etc. */
function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const limpo = valor.trim().replace(/\./g, '').replace(',', '.');
    const n = Number(limpo);
    if (Number.isFinite(n)) return n;
    const direto = Number(valor);
    return Number.isFinite(direto) ? direto : 0;
  }
  return 0;
}

/** Texto seguro (string ou ''). */
function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor);
}

interface ResultadoIngestao {
  pedidosProcessados: number;
  inseridos: number;
  atualizados: number;
  itensGravados: number;
  erros: number;
  /** Pedidos ignorados por natureza de operação (não viram entrega). */
  descartadosNatureza: number;
}

/**
 * Ingestão idempotente de um lote de itens da Órix.
 * @param itens  linhas cruas da Órix (1 por produto)
 * @param orix   cliente Órix (para enriquecer cliente/propriedades)
 */
export async function ingest(
  itens: OrixPedidoItem[],
  orix: OrixClient,
): Promise<ResultadoIngestao> {
  const resultado: ResultadoIngestao = {
    pedidosProcessados: 0,
    inseridos: 0,
    atualizados: 0,
    itensGravados: 0,
    erros: 0,
    descartadosNatureza: 0,
  };

  if (!itens || itens.length === 0) {
    return resultado;
  }

  // 1) Agrupar por id_pedido.
  const grupos = new Map<string, OrixPedidoItem[]>();
  for (const item of itens) {
    const idPedido = texto(item.id_pedido);
    if (!idPedido) continue;
    const lista = grupos.get(idPedido);
    if (lista) lista.push(item);
    else grupos.set(idPedido, [item]);
  }

  // 1b) Filtrar por NATUREZA DA OPERAÇÃO (só '00001' VENDA e '00012' VENDA
  // ORIGINADA DE FAT P/ ENTREGA FUTURA viram entrega). Descartar aqui é o que
  // impede a '00011' (SIMPLES FATURAMENTO — só a nota, nada sai do galpão) de
  // duplicar no painel a mesma entrega que a '00012' já representa.
  // A natureza é do PEDIDO (repetida em todas as suas linhas), por isso o corte
  // é no grupo inteiro.
  const permitidas = await getNaturezaPermitida();
  const descartadas = new Map<string, number>();
  for (const [idPedido, linhas] of grupos) {
    const cab = linhas[0];
    if (!cab) continue;
    const natureza = normalizarNatureza(cab.natureza);
    if (natureza !== '' && !permitidas.includes(natureza)) {
      grupos.delete(idPedido);
      resultado.descartadosNatureza += 1;
      const rotulo = `${natureza} ${texto(cab.nome_natureza)}`.trim();
      descartadas.set(rotulo, (descartadas.get(rotulo) ?? 0) + 1);
    }
  }
  if (descartadas.size > 0) {
    const resumo = [...descartadas]
      .map(([rotulo, n]) => `${n}× ${rotulo}`)
      .join('; ');
    log.info(
      `[ingest] ${resultado.descartadosNatureza} pedido(s) fora das naturezas ${permitidas.join(
        '/',
      )}: ${resumo}`,
    );
  }

  // Cache de enriquecimento para evitar chamadas/upserts repetidos dentro do tick.
  const clientesEnriquecidos = new Set<string>();
  const propriedadesEnriquecidas = new Set<string>();
  // Produtos cujos itens foram efetivamente gravados (codigo -> nome).
  const produtosDoLote = new Map<string, string>();

  for (const [orixIdPedido, linhas] of grupos) {
    resultado.pedidosProcessados += 1;
    try {
      await processarGrupo(
        orixIdPedido,
        linhas,
        orix,
        clientesEnriquecidos,
        propriedadesEnriquecidas,
        produtosDoLote,
        resultado,
      );
    } catch (err) {
      resultado.erros += 1;
      log.error(
        `[ingest] Falha ao processar pedido orix_id_pedido=${orixIdPedido}:`,
        err,
      );
      // Não interrompe o lote — segue para o próximo pedido.
    }
  }

  // O cadastro de peso se auto-completa conforme os pedidos chegam: o parser lê o
  // kg do NOME do produto (o campo `peso` do Órix é inutilizável). O que não tiver
  // peso no nome fica para a equipe digitar. Peso NUNCA derruba a ingestão.
  try {
    await semearPesosAuto(
      [...produtosDoLote].map(([codigo, nome]) => ({ codigo, nome })),
    );
  } catch (err) {
    log.warn('[ingest] Falha ao semear pesos automáticos do lote:', err);
  }

  return resultado;
}

async function processarGrupo(
  orixIdPedido: string,
  linhas: OrixPedidoItem[],
  orix: OrixClient,
  clientesEnriquecidos: Set<string>,
  propriedadesEnriquecidas: Set<string>,
  produtosDoLote: Map<string, string>,
  resultado: ResultadoIngestao,
): Promise<void> {
  // Cabeçalho do pedido vem da primeira linha (campos repetidos entre itens).
  const cab = linhas[0];
  if (!cab) return; // grupo vazio não deveria ocorrer; satisfaz o type-checker.
  const clienteCodigo = texto(cab.cliente);

  // 2) Enriquecer cliente + propriedades ANTES do upsert do pedido.
  if (clienteCodigo) {
    await enriquecerCliente(
      orix,
      clienteCodigo,
      cab,
      clientesEnriquecidos,
      propriedadesEnriquecidas,
    );
  }

  // 3) Calcular valor_total = soma dos totais dos itens.
  const itensCalculados = linhas.map((l) => ({
    produto_codigo: texto(l.produto),
    nome_produto: texto(l.nome_produto),
    qtd: numero(l.qtd),
    valor_unit: numero(l.valor_unit),
    total: numero(l.total_item),
  }));
  const valorTotal = itensCalculados.reduce((acc, it) => acc + it.total, 0);

  const empresa = Number.parseInt(texto(cab.empresa), 10);
  const dataPedido = dataOrixParaISO(texto(cab.data));

  // 4) Upsert idempotente do pedido por orix_id_pedido.
  //    Buscamos o registro existente para decidir INSERT vs UPDATE e, no UPDATE,
  //    NUNCA tocar em status_logistico (estado manual).
  const { data: existente, error: erroBusca } = await supabase
    .from('pedidos')
    .select('id, status_logistico')
    .eq('orix_id_pedido', orixIdPedido)
    .maybeSingle();

  if (erroBusca) {
    throw new Error(`busca pedido existente: ${erroBusca.message}`);
  }

  let pedidoId: string;

  if (existente) {
    // ATUALIZAR — preserva status_logistico, data_agendada, data_entregue,
    // propriedade_codigo (campos de estado manual NÃO entram no update).
    const { data: atualizado, error: erroUpd } = await supabase
      .from('pedidos')
      .update({
        orix_numero: texto(cab.numero_pedido),
        empresa: Number.isFinite(empresa) ? empresa : null,
        cliente_codigo: clienteCodigo || null,
        cliente_nome: texto(cab.nome_cliente),
        cidade_cliente: texto(cab.cidade_cliente),
        vendedor_codigo: texto(cab.vendedor) || null,
        vendedor_nome: texto(cab.nome_vendedor),
        valor_total: valorTotal,
        data_pedido: dataPedido,
        status_orix: texto(cab.status),
        status_orix_nome: texto(cab.nome_status),
        natureza: normalizarNatureza(cab.natureza) || null,
        natureza_nome: texto(cab.nome_natureza) || null,
        // status_logistico: NÃO incluído de propósito (estado manual).
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', existente.id)
      .select('id')
      .single();

    if (erroUpd || !atualizado) {
      throw new Error(`update pedido: ${erroUpd?.message ?? 'sem retorno'}`);
    }
    pedidoId = atualizado.id;
    resultado.atualizados += 1;
  } else {
    // INSERIR — pedido novo nasce com status_logistico = 'pendente'.
    const { data: inserido, error: erroIns } = await supabase
      .from('pedidos')
      .insert({
        orix_id_pedido: orixIdPedido,
        orix_numero: texto(cab.numero_pedido),
        empresa: Number.isFinite(empresa) ? empresa : null,
        cliente_codigo: clienteCodigo || null,
        cliente_nome: texto(cab.nome_cliente),
        cidade_cliente: texto(cab.cidade_cliente),
        vendedor_codigo: texto(cab.vendedor) || null,
        vendedor_nome: texto(cab.nome_vendedor),
        valor_total: valorTotal,
        data_pedido: dataPedido,
        status_orix: texto(cab.status),
        status_orix_nome: texto(cab.nome_status),
        natureza: normalizarNatureza(cab.natureza) || null,
        natureza_nome: texto(cab.nome_natureza) || null,
        status_logistico: 'pendente',
      })
      .select('id')
      .single();

    if (erroIns || !inserido) {
      throw new Error(`insert pedido: ${erroIns?.message ?? 'sem retorno'}`);
    }
    pedidoId = inserido.id;
    resultado.inseridos += 1;
  }

  // 5) Recriar (substituir) os itens_pedido do pedido.
  //    Determinístico => reprocessar não duplica itens.
  //
  //    ATENÇÃO: recriar os itens APAGA a separação do almoxarifado (`separado` e
  //    `separado_em` voltam ao default). Como o poll reprocessa a janela a cada 5
  //    min, um pedido conferido de manhã aparecia "não separado" minutos depois.
  //    Por isso lemos as marcas ANTES do delete e as transportamos para os itens
  //    recriados (regra pura e testada em @pastobom/shared: transportarSeparacao).
  const { data: itensAntigos, error: erroLeitura } = await supabase
    .from('itens_pedido')
    .select('produto_codigo, separado, separado_em')
    .eq('pedido_id', pedidoId);
  if (erroLeitura) {
    throw new Error(`ler itens (separação): ${erroLeitura.message}`);
  }

  const marcas = transportarSeparacao(
    (itensAntigos ?? []).map((i) => ({
      produtoCodigo: i.produto_codigo ?? '',
      separado: i.separado ?? false,
      separadoEm: i.separado_em ?? null,
    })),
    itensCalculados.map((it) => it.produto_codigo),
  );

  const { error: erroDel } = await supabase
    .from('itens_pedido')
    .delete()
    .eq('pedido_id', pedidoId);
  if (erroDel) {
    throw new Error(`delete itens: ${erroDel.message}`);
  }

  if (itensCalculados.length > 0) {
    const linhasItens = itensCalculados.map((it, i) => {
      const marca = marcas[i];
      return {
        pedido_id: pedidoId,
        ...it,
        separado: marca?.separado ?? false,
        separado_em: marca?.separadoEm ?? null,
      };
    });
    const { error: erroInsItens } = await supabase
      .from('itens_pedido')
      .insert(linhasItens);
    if (erroInsItens) {
      throw new Error(`insert itens: ${erroInsItens.message}`);
    }
    resultado.itensGravados += linhasItens.length;

    for (const it of itensCalculados) {
      if (it.produto_codigo) {
        produtosDoLote.set(it.produto_codigo, it.nome_produto);
      }
    }
  }
}

/** Enriquece cliente e suas propriedades (upsert), uma vez por código no tick. */
async function enriquecerCliente(
  orix: OrixClient,
  clienteCodigo: string,
  cab: OrixPedidoItem,
  clientesEnriquecidos: Set<string>,
  propriedadesEnriquecidas: Set<string>,
): Promise<void> {
  if (clientesEnriquecidos.has(clienteCodigo)) return;
  clientesEnriquecidos.add(clienteCodigo);

  // --- Cliente ---
  let clienteRow: Record<string, unknown> = {
    codigo: clienteCodigo,
    // Fallbacks vindos da própria linha de pedido (caso /Cliente venha vazio).
    nome: texto(cab.nome_cliente),
    cidade: texto(cab.cidade_cliente),
    atualizado_em: new Date().toISOString(),
  };

  try {
    const cli = await orix.getCliente(clienteCodigo);
    if (cli) {
      clienteRow = {
        codigo: texto(cli.codigo) || clienteCodigo,
        nome: texto(cli.nome) || texto(cab.nome_cliente),
        celular: texto(cli.celular),
        telefone: texto(cli.telefone),
        email: texto(cli.email),
        endereco: texto(cli.endereco),
        bairro: texto(cli.bairro),
        cidade: texto(cli.cidade) || texto(cab.cidade_cliente),
        uf: texto(cli.uf),
        cpf_cnpj: texto(cli.cpf_cnpj),
        latitude: texto(cli.latitude),
        longitude: texto(cli.longitude),
        atualizado_em: new Date().toISOString(),
      };
    }
  } catch (err) {
    log.warn(
      `[ingest] getCliente(${clienteCodigo}) falhou; usando dados da linha de pedido:`,
      err,
    );
  }

  // Número canônico de WhatsApp (fonte única: @pastobom/shared) calculado já na
  // ingestão. Grava o E.164 pronto p/ envio (ou null se não houver móvel) + a
  // classificação, evitando reprocessar o número a cada disparo.
  const whats = escolherNumeroWhatsApp(
    typeof clienteRow.celular === 'string' ? clienteRow.celular : '',
    typeof clienteRow.telefone === 'string' ? clienteRow.telefone : '',
  );
  clienteRow.numero_whatsapp = whats.e164;
  clienteRow.whatsapp_tipo = whats.tipo;

  const { error: erroCli } = await supabase
    .from('clientes')
    .upsert(clienteRow, { onConflict: 'codigo' });
  if (erroCli) {
    log.warn(`[ingest] upsert cliente ${clienteCodigo} falhou: ${erroCli.message}`);
  }

  // --- Propriedades do cliente ---
  if (propriedadesEnriquecidas.has(clienteCodigo)) return;
  propriedadesEnriquecidas.add(clienteCodigo);

  try {
    const props = await orix.getPropriedades(clienteCodigo);
    if (props && props.length > 0) {
      const linhasProp = props
        .filter((p) => texto(p.codigo))
        .map((p) => ({
          codigo: texto(p.codigo),
          cliente_codigo: texto(p.cliente) || clienteCodigo,
          nome: texto(p.nome),
          endereco: texto(p.endereco),
          bairro: texto(p.bairro),
          cidade: texto(p.cidade),
          uf: texto(p.uf),
          cep: texto(p.cep),
          latitude: texto(p.latitude),
          longitude: texto(p.longitude),
          atualizado_em: new Date().toISOString(),
        }));
      if (linhasProp.length > 0) {
        const { error: erroProp } = await supabase
          .from('propriedades')
          .upsert(linhasProp, { onConflict: 'codigo' });
        if (erroProp) {
          log.warn(
            `[ingest] upsert propriedades de ${clienteCodigo} falhou: ${erroProp.message}`,
          );
        }
      }
    }
  } catch (err) {
    log.warn(
      `[ingest] getPropriedades(${clienteCodigo}) falhou; seguindo sem propriedades:`,
      err,
    );
  }
}
