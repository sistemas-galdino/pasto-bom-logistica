// DTOs crus da API Órix — campos exatamente como vêm do servidor
// (snake_case / lowercase). Não normalizar aqui; a normalização acontece
// na ingestão do worker.

export interface OrixLoginResp {
  valid: boolean;
  token?: string;
}

export interface OrixPedidoItem {
  empresa: string;
  data: string;
  id_pedido: string;
  numero_pedido: string;
  produto: string;
  nome_produto: string;
  qtd: number;
  valor_unit: number;
  total_item: number;
  vendedor: string;
  nome_vendedor: string;
  cliente: string;
  nome_cliente: string;
  cidade_cliente: string;
  status: string;
  nome_status: string;
  /**
   * Natureza da OPERAÇÃO (fiscal), zero-padded: '00001' VENDA, '00012' VENDA
   * ORIGINADA DE FAT P/ ENTREGA FUTURA (a remessa), '00011' SIMPLES FATURAMENTO
   * (só a nota — nada sai do galpão), '00049' REMESSA EM GARANTIA (oficina)...
   * Só '00001' e '00012' viram entrega. A 11 é o par fiscal da 12: ingerir as
   * duas faria a mesma entrega aparecer DUAS vezes no painel.
   */
  natureza: string;
  nome_natureza: string;
  [k: string]: unknown;
}

export interface OrixPropriedade {
  codigo: string;
  cliente: string;
  nome: string;
  endereco: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  latitude: string;
  longitude: string;
  [k: string]: unknown;
}

export interface OrixCliente {
  codigo: string;
  nome: string;
  celular: string;
  telefone: string;
  email: string;
  endereco: string;
  cidade: string;
  uf: string;
  [k: string]: unknown;
}
