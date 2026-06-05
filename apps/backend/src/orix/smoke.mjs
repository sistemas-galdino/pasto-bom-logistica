#!/usr/bin/env node
// [AGENTE ORIX] Smoke test STANDALONE da API Órix.
//
// SEM dependências, SEM imports do projeto — apenas fetch nativo do Node >= 20.
// Verifica, contra a API real:
//   1) POST /Login            -> obtém token (trata {valid:false} como erro)
//   2) POST /PedidosPorProdutos (janela curta, status ["00041"])
//   3) GET  /Propriedades/00001
//
// Imprime, para cada chamada: o HTTP status, a contagem de registros e os
// valores distintos de status / nome_status.
//
// Uso:
//   ORIX_BASE_URL='http://177.71.135.247:19201/ws/integradores/v1' \
//   ORIX_LOGIN='api ia' ORIX_SENHA='123' \
//   node smoke.mjs
//
// Credenciais de teste do contrato (homologação) usadas como fallback.

const BASE_URL = (
  process.env.ORIX_BASE_URL ||
  'http://177.71.135.247:19201/ws/integradores/v1'
).replace(/\/+$/, '');
const LOGIN = process.env.ORIX_LOGIN || 'api ia';
const SENHA = process.env.ORIX_SENHA || '123';
const EMPRESA = Number(process.env.ORIX_EMPRESA || '2');

const TIMEOUT_MS = 30_000;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Janela curta: últimos 7 dias.
const hoje = new Date();
const seteDiasAtras = new Date(hoje.getTime() - 7 * 24 * 60 * 60 * 1000);
const DATA_INICIAL = isoDate(seteDiasAtras);
const DATA_FINAL = isoDate(hoje);

async function req(caminho, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${BASE_URL}${caminho}`, {
      ...init,
      signal: controller.signal,
    });
    const texto = await resp.text();
    let json = null;
    if (texto) {
      try {
        json = JSON.parse(texto);
      } catch {
        json = null;
      }
    }
    return { status: resp.status, ok: resp.ok, texto, json };
  } finally {
    clearTimeout(timer);
  }
}

function distintos(registros, campo) {
  const set = new Set();
  for (const r of registros) {
    if (r && r[campo] !== undefined && r[campo] !== null) {
      set.add(String(r[campo]));
    }
  }
  return [...set];
}

async function main() {
  console.log('=== SMOKE TEST ÓRIX ===');
  console.log(`Base URL : ${BASE_URL}`);
  console.log(`Login    : "${LOGIN}"`);
  console.log(`Janela   : ${DATA_INICIAL} -> ${DATA_FINAL}`);
  console.log('');

  // ----------------------------------------------------------------------
  // 1) LOGIN
  // ----------------------------------------------------------------------
  console.log('--- 1) POST /Login ---');
  const loginResp = await req('/Login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, senha: SENHA }),
  });
  console.log(`HTTP status : ${loginResp.status}`);
  console.log(`valid       : ${loginResp.json ? loginResp.json.valid : '?'}`);

  if (!loginResp.json || loginResp.json.valid !== true || !loginResp.json.token) {
    console.error('ERRO: login falhou (valid != true ou sem token).');
    console.error(`Corpo: ${loginResp.texto.slice(0, 300)}`);
    process.exit(1);
  }
  const token = loginResp.json.token;
  console.log(`token       : ${token.slice(0, 24)}... (${token.length} chars)`);
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  console.log('');

  // ----------------------------------------------------------------------
  // 2) PEDIDOS POR PRODUTOS
  // ----------------------------------------------------------------------
  console.log('--- 2) POST /PedidosPorProdutos (status ["00041"]) ---');
  const pedidosBody = {
    data_inicial: DATA_INICIAL,
    data_final: DATA_FINAL,
    somente_vendas: false,
    empresas: [EMPRESA],
    status: ['00041'],
  };
  console.log(`body        : ${JSON.stringify(pedidosBody)}`);
  const pedidosResp = await req('/PedidosPorProdutos', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(pedidosBody),
  });
  console.log(`HTTP status : ${pedidosResp.status}`);

  if (pedidosResp.json && Array.isArray(pedidosResp.json.registros)) {
    const regs = pedidosResp.json.registros;
    console.log(`registros   : ${regs.length}`);
    console.log(`status      : ${JSON.stringify(distintos(regs, 'status'))}`);
    console.log(
      `nome_status : ${JSON.stringify(distintos(regs, 'nome_status'))}`,
    );
    const idsPedido = distintos(regs, 'id_pedido');
    console.log(`id_pedido distintos: ${idsPedido.length}`);
    if (regs.length > 0) {
      console.log(`exemplo[0]  : ${JSON.stringify(regs[0])}`);
    }
  } else {
    console.log('registros   : (resposta sem array "registros")');
    console.log(`corpo       : ${pedidosResp.texto.slice(0, 400)}`);
  }
  console.log('');

  // ----------------------------------------------------------------------
  // 3) PROPRIEDADES/00001
  // ----------------------------------------------------------------------
  console.log('--- 3) GET /Propriedades/00001 ---');
  const propResp = await req('/Propriedades/00001', {
    method: 'GET',
    headers: authHeaders,
  });
  console.log(`HTTP status : ${propResp.status}`);

  if (propResp.json && Array.isArray(propResp.json.registros)) {
    const regs = propResp.json.registros;
    console.log(`registros   : ${regs.length}`);
    if (regs.length > 0) {
      console.log(`exemplo[0]  : ${JSON.stringify(regs[0])}`);
    }
  } else {
    console.log('registros   : (resposta sem array "registros")');
    console.log(`corpo       : ${propResp.texto.slice(0, 400)}`);
  }
  console.log('');
  console.log('=== FIM DO SMOKE TEST ===');
}

main().catch((err) => {
  console.error('FALHA NO SMOKE TEST:', err && err.message ? err.message : err);
  process.exit(1);
});
