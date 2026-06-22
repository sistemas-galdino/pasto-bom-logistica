// [AGENTE ORIX] Auditoria de cobertura de WhatsApp na base de clientes.
//
// Mede, contra a API REAL do Órix, qual fração dos clientes tem um número
// MÓVEL alcançável por WhatsApp — usando o MESMO normalizador de produção
// (@pastobom/shared), para que o número da auditoria bata com o do envio.
//
// Roda via tsx (resolve o import TS do shared):
//   node --import tsx --env-file-if-exists=.env src/orix/auditoria-contatos.mjs
//   npm run audit:contatos --workspace apps/backend
//
// Variáveis (todas opcionais; fallback = credenciais de homologação do contrato):
//   ORIX_BASE_URL, ORIX_LOGIN, ORIX_SENHA, ORIX_EMPRESA
//   AUDIT_ESCOPO = 'ativos' (default) | 'base'   -> ativos = com pedido na janela
//   AUDIT_DIAS   = 60 (default)                  -> tamanho da janela de "ativos"
//
// Privacidade: NÃO imprime números; só agregados e exemplos mascarados.

import { escolherNumeroWhatsApp } from '@pastobom/shared';

const BASE_URL = (
  process.env.ORIX_BASE_URL || 'http://177.71.135.247:19201/ws/integradores/v1'
).replace(/\/+$/, '');
const LOGIN = process.env.ORIX_LOGIN || 'api ia';
const SENHA = process.env.ORIX_SENHA || '123';
const EMPRESA = Number(process.env.ORIX_EMPRESA || '2');
const ESCOPO = process.env.AUDIT_ESCOPO === 'base' ? 'base' : 'ativos';
const DIAS = Number(process.env.AUDIT_DIAS || '60');
const TIMEOUT_MS = 30_000;

const isoDate = (d) => d.toISOString().slice(0, 10);
const soDigitos = (s) => String(s ?? '').replace(/\D+/g, '');
const mask = (s) => {
  const d = soDigitos(s);
  return d ? `${d.slice(0, 2)}…${d.slice(-2)} [${d.length}díg]` : '(vazio)';
};

async function req(caminho, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${BASE_URL}${caminho}`, { ...init, signal: controller.signal });
    const texto = await resp.text();
    let json = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    return { status: resp.status, json, texto };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log('=== AUDITORIA DE CONTATOS / WHATSAPP (Órix) ===');
  console.log(`Base : ${BASE_URL}`);
  console.log(`Escopo: ${ESCOPO}${ESCOPO === 'ativos' ? ` (pedidos nos últimos ${DIAS} dias)` : ''}\n`);

  // 1) Login
  const login = await req('/Login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, senha: SENHA }),
  });
  if (!login.json?.token) {
    console.error(`Login falhou (HTTP ${login.status}): ${login.texto.slice(0, 200)}`);
    process.exit(1);
  }
  const H = { Authorization: `Bearer ${login.json.token}`, 'Content-Type': 'application/json' };
  console.log('✔ Login OK\n');

  // 2) Conjunto de clientes a avaliar
  let alvo = null; // null = base inteira
  if (ESCOPO === 'ativos') {
    const fim = new Date();
    const ini = new Date(fim.getTime() - DIAS * 24 * 60 * 60 * 1000);
    alvo = new Set();
    let pagina = 1;
    let paginas = 1;
    do {
      const r = await req(`/PedidosPorProdutos?pagina=${pagina}&limite=1000`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({
          data_inicial: isoDate(ini),
          data_final: isoDate(fim),
          somente_vendas: false,
          empresas: [EMPRESA],
        }),
      });
      if (r.status !== 200) {
        console.error(`PedidosPorProdutos pág ${pagina} → HTTP ${r.status}`);
        break;
      }
      const regs = r.json?.registros ?? [];
      paginas = Number(r.json?.paginas ?? 1);
      for (const x of regs) if (x.cliente) alvo.add(String(x.cliente).trim());
      pagina++;
    } while (pagina <= paginas && pagina <= 80);
    console.log(`Clientes ativos (com pedido em ${DIAS}d): ${alvo.size}\n`);
  }

  // 3) Varre /Clientes, classifica com o normalizador de produção
  const cont = { movel: 0, fixo: 0, invalido: 0, vazio: 0 };
  const origem = { celular: 0, telefone: 0 };
  let total = 0;
  const exMovel = [];
  const exSem = [];
  let pagina = 1;
  let paginas = 1;
  do {
    const r = await req(`/Clientes?pagina=${pagina}&limite=200`, { headers: H });
    if (r.status !== 200) {
      console.error(`Clientes pág ${pagina} → HTTP ${r.status}`);
      break;
    }
    const regs = r.json?.registros ?? [];
    paginas = Number(r.json?.paginas ?? 1);
    for (const c of regs) {
      const cod = String(c.codigo).trim();
      if (alvo && !alvo.has(cod)) continue;
      total++;
      const e = escolherNumeroWhatsApp(c.celular, c.telefone);
      cont[e.tipo]++;
      if (e.tipo === 'movel' && e.origem) origem[e.origem]++;
      if (e.tipo === 'movel' && exMovel.length < 4)
        exMovel.push(`[${cod}] via ${e.origem}: cel=${mask(c.celular)} tel=${mask(c.telefone)}`);
      else if (e.tipo !== 'movel' && exSem.length < 4)
        exSem.push(`[${cod}] ${e.tipo}: cel=${mask(c.celular)} tel=${mask(c.telefone)}`);
    }
    pagina++;
  } while (pagina <= paginas && pagina <= 40);

  const pct = (x) => (total ? `${((100 * x) / total).toFixed(0)}%` : '—');
  console.log(`════════ COBERTURA (base analisada: ${total}) ════════`);
  console.log(`  ➤ MÓVEL (recebe WhatsApp) ... ${cont.movel}  (${pct(cont.movel)})`);
  console.log(`    fixo (não recebe) ......... ${cont.fixo}  (${pct(cont.fixo)})`);
  console.log(`    inválido .................. ${cont.invalido}  (${pct(cont.invalido)})`);
  console.log(`    vazio ..................... ${cont.vazio}  (${pct(cont.vazio)})`);
  console.log(`  origem do móvel: campo celular=${origem.celular} | campo telefone=${origem.telefone}`);
  console.log('\n── Exemplos COM móvel (mascarado) ──');
  exMovel.forEach((e) => console.log('  ' + e));
  console.log('── Exemplos SEM móvel (mascarado) ──');
  exSem.forEach((e) => console.log('  ' + e));
}

main().catch((err) => {
  console.error('Erro na auditoria:', err);
  process.exit(1);
});
