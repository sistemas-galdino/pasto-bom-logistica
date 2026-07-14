// Preservação das marcas de separação através da re-ingestão.
//
// POR QUE ISSO EXISTE
// A ingestão do Órix RECRIA os itens do pedido a cada ciclo (DELETE + INSERT), o
// que é a forma mais simples de manter os itens fiéis ao ERP. O efeito colateral é
// que `separado`/`separado_em` — que são estado NOSSO, do almoxarifado, e não do
// Órix — voltavam ao default. Um pedido conferido de manhã aparecia "não separado"
// cinco minutos depois, sozinho.
//
// Este módulo transporta as marcas dos itens antigos para os recriados.

/** Marca de separação de um item do pedido. */
export interface MarcaSeparacao {
  separado: boolean;
  /** ISO timestamp de quando foi separado; null quando não separado. */
  separadoEm: string | null;
}

/** Item já existente no banco, com a marca a ser preservada. */
export interface ItemSeparacaoAntigo {
  produtoCodigo: string;
  separado: boolean;
  separadoEm: string | null;
}

/**
 * Casa as marcas dos itens ANTIGOS com os códigos dos itens NOVOS e devolve um
 * array PARALELO a `novosCodigos` (mesma ordem, mesmo tamanho).
 *
 * O casamento é por código de produto, consumido em FILA — e não por um índice
 * simples — porque existem pedidos com o MESMO produto em duas linhas (verificado
 * no banco: 4 pedidos). Com um Map de um valor só, a segunda linha herdaria a marca
 * da primeira e um item não conferido apareceria como separado.
 *
 * Item que sumiu do Órix não recebe marca (nem aparece na saída).
 * Item novo, que não existia antes, entra como não separado — correto: ninguém o
 * conferiu ainda.
 */
export function transportarSeparacao(
  antigos: readonly ItemSeparacaoAntigo[],
  novosCodigos: readonly string[],
): MarcaSeparacao[] {
  const filas = new Map<string, MarcaSeparacao[]>();

  for (const antigo of antigos) {
    // Só o que estava separado precisa sobreviver; o resto é o default.
    if (!antigo.separado) continue;
    const fila = filas.get(antigo.produtoCodigo);
    const marca: MarcaSeparacao = {
      separado: true,
      separadoEm: antigo.separadoEm,
    };
    if (fila) fila.push(marca);
    else filas.set(antigo.produtoCodigo, [marca]);
  }

  // Objeto NOVO a cada item (e não uma constante compartilhada): devolver a mesma
  // referência para todos os não-separados criaria aliasing — mutar a marca de um
  // item mutaria a de todos os outros.
  return novosCodigos.map(
    (codigo) =>
      filas.get(codigo)?.shift() ?? { separado: false, separadoEm: null },
  );
}
