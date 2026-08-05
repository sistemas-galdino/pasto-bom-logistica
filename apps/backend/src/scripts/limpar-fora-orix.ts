// [AGENTE WORKER] Limpeza dos pedidos que JÁ NÃO ESTÃO EM ABERTO no Órix —
// rodar UMA vez, sempre com --dry antes:
//
//   npm run limpar:fora-orix -w @pastobom/backend -- --dry   (só relata)
//   npm run limpar:fora-orix -w @pastobom/backend            (grava)
//
// CONTEXTO (áudio da Natália, 05/08/2026)
// ---------------------------------------
// "aparecer o que foi concluído também não é para ficar aparecendo aí mais"
//
// O pedido FATURADO no Órix (00030) sai dos status de gatilho. O poll não o
// relê e a reconciliação, até 05/08, ignorava quem sumia da resposta. Resultado:
// ele ficava preso na coluna Pendente para sempre — eram 52 pedidos parados há
// mais de um mês quando ela reclamou.
//
// A reconciliação agora trata isso sozinha, mas com carência de 24 h. Este
// script existe para não esperar um dia inteiro: roda a MESMA varredura com
// carência 0, aproveitando reconciliarOnce() inteiro — mesma janela, mesmas
// guardas, mesmo freio de volume. Não há regra duplicada aqui.
//
// GARANTIAS (todas herdadas de reconciliarOnce)
// ---------------------------------------------
//  - NUNCA toca em 'entregue' nem em 'cancelada';
//  - NUNCA descarta pedido com viagem agendada ou em rota;
//  - NUNCA descarta pedido cuja data caia fora da janela consultada;
//  - aborta se o Órix falhar, e não faz nada se mais da metade dos abertos
//    sumir de uma vez (resposta incompleta não vira limpeza em massa);
//  - descartar NÃO dispara WhatsApp e é REVERSÍVEL pelo botão "Restaurar".

import { reconciliarOnce } from '../worker/reconciliar.js';
import { log } from '../log.js';

const SECO = process.argv.includes('--dry');

// O freio de volume (50% dos abertos ausentes) existe para o REGIME: em um dia
// normal somem poucos pedidos, e metade sumindo de uma vez é resposta
// incompleta do Órix. O passivo acumulado é a exceção — na primeira limpeza
// eram 92 de 183 (50,3%), e a sondagem confirmou 00030 em todos os checados.
//
// --forcar desliga o freio. Só use depois de rodar com --dry e conferir a
// amostra na tela do Órix: é exatamente a checagem que o freio pede.
const FORCAR = process.argv.includes('--forcar');

interface Amostra {
  /** Número da OV — é este que se digita na tela do Órix, não o id interno. */
  orix_numero: string | null;
  data_pedido: string | null;
  status_orix: string | null;
}

async function main(): Promise<void> {
  log.info(
    '[limpar-fora-orix] Varrendo os pedidos em aberto contra o Órix' +
      `${SECO ? ' — MODO SECO (nada será gravado)' : ''}` +
      `${FORCAR ? ' — FREIO DE VOLUME DESLIGADO (--forcar)' : ''}...`,
  );

  const amostras: Amostra[] = [];

  const r = await reconciliarOnce({
    horasCarencia: 0,
    dryRun: SECO,
    fracaoAusentesMax: FORCAR ? 1 : undefined,
    aoDescartar: (p) => {
      amostras.push({
        orix_numero: p.orix_numero,
        data_pedido: p.data_pedido,
        status_orix: p.status_orix,
      });
    },
  });

  if (!r.ok) {
    throw new Error(`Órix falhou, ciclo abortado: ${r.motivoAbort}`);
  }

  if (r.ausenciaSuspeita) {
    log.warn(
      '[limpar-fora-orix] O freio de volume disparou: mais da metade dos ' +
        'pedidos em aberto não voltou na resposta do Órix. Isso quase sempre ' +
        'é resposta incompleta do servidor, não backlog resolvido. NADA foi ' +
        'processado. Rode de novo mais tarde; se o número se repetir e a ' +
        'amostra conferir no Órix, use --forcar.',
    );
    return;
  }

  log.info(
    `[limpar-fora-orix] ${r.examinados} em aberto, ${r.encontrados} ainda ` +
      `no Órix, ${r.descartados} fora do Órix.`,
  );

  if (r.descartados === 0) {
    log.info('[limpar-fora-orix] Nada a descartar — o quadro já reflete o Órix.');
    return;
  }

  // Por data, para dar a dimensão: backlog velho preso é o esperado; muita
  // coisa recente seria sinal de janela errada, e aí é para NÃO gravar.
  const porMes = new Map<string, number>();
  for (const a of amostras) {
    const k = (a.data_pedido ?? 'sem data').slice(0, 7);
    porMes.set(k, (porMes.get(k) ?? 0) + 1);
  }
  log.info('[limpar-fora-orix] Distribuição por mês do pedido:');
  for (const [k, n] of [...porMes].sort()) {
    log.info(`   ${String(n).padStart(4)}  ${k}`);
  }

  log.info('[limpar-fora-orix] Amostra (confira algumas na tela do Órix):');
  // Os mais RECENTES primeiro: backlog velho preso é o esperado, pedido de
  // ontem na lista é o que merece um olhar antes de gravar.
  const recentes = [...amostras].sort((a, b) =>
    (b.data_pedido ?? '').localeCompare(a.data_pedido ?? ''),
  );
  for (const a of recentes.slice(0, 15)) {
    log.info(`   OV ${a.orix_numero}  ${a.data_pedido}  (banco: ${a.status_orix})`);
  }

  if (SECO) {
    log.info(
      '[limpar-fora-orix] MODO SECO: nada foi gravado. Confira a amostra ' +
        'acima no Órix antes de rodar sem --dry.',
    );
    return;
  }

  log.info(
    `[limpar-fora-orix] ${r.descartados} pedido(s) descartado(s) ` +
      '(reversíveis pelo botão "Restaurar" do quadro).',
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log.error('[limpar-fora-orix] Falhou:', err);
    process.exit(1);
  });
