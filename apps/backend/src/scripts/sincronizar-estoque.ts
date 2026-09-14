// [AGENTE WORKER] Carga inicial / manual do espelho de ESTOQUE:
//
//   node --import tsx --env-file-if-exists=.env \
//     apps/backend/src/scripts/sincronizar-estoque.ts
//
// É a MESMA rotina que o scheduler roda (ESTOQUE_CRON, a cada
// ESTOQUE_INTERVALO_HORAS) — nenhuma regra duplicada aqui. Serve para a CARGA
// INICIAL: depois de subir a 0024, o alerta nasce mudo (tabela vazia = "não
// sei" em todo produto) e ninguém quer esperar o primeiro tick para testar.
//
// O upsert é idempotente e o espelho NUNCA apaga quem não veio: rodar duas
// vezes não duplica nem esvazia nada.
//
// O PLACAR DE COBERTURA É O PONTO DESTE SCRIPT. Ele responde a pergunta que
// autoriza (ou não) a feature: quantos produtos têm quantidade de verdade. Na
// conferência de 14/09/2026 contra a API de produção foram 6.478 com
// quantidade > 0 no cadastro inteiro, e 86% entre os 632 produtos que a
// operação realmente entrega. Se um dia isto vier tudo zero, o alerta deixou de
// servir — um aviso que grita em todo item ensina a equipe a ignorá-lo, e aí o
// aviso verdadeiro passa batido junto. Nesse caso, pare e converse com a
// Natália com o número na mão.

import {
  LIMITE_PAGINA,
  registrarSincronizacaoProdutos,
  sincronizarProdutosOnce,
} from '../worker/produtos.js';
import { log } from '../log.js';

async function main(): Promise<void> {
  const r = await sincronizarProdutosOnce();
  await registrarSincronizacaoProdutos(r);

  const comDado = r.comQuantidade + r.zerados + r.negativos;
  const pct = comDado > 0 ? Math.round((r.comQuantidade / comDado) * 100) : 0;

  console.log('');
  console.log('=== ESPELHO DE ESTOQUE (Órix -> banco) ===');
  console.log(`  resultado ........... ${r.ok ? 'OK' : 'PARCIAL (ver motivo)'}`);
  console.log(
    `  páginas ............. ${r.paginasLidas}/${r.paginasTotal} (limite ${LIMITE_PAGINA}/página)`,
  );
  console.log(`  registros lidos ..... ${r.registros}`);
  console.log(`  gravados no espelho . ${r.gravados}`);
  if (r.semCodigo > 0) {
    console.log(`  sem código (pulados)  ${r.semCodigo}`);
  }
  console.log('');
  console.log('  --- COBERTURA (é isto que decide se o alerta presta) ---');
  console.log(`  com quantidade > 0 .. ${r.comQuantidade} (${pct}%)`);
  console.log(`  em zero ............. ${r.zerados}`);
  console.log(`  negativos ........... ${r.negativos}`);
  if (comDado > 0 && r.comQuantidade === 0) {
    console.log('');
    console.log('  !! NENHUM produto com quantidade > 0.');
    console.log('     O alerta vai gritar em todo item e a equipe vai aprender');
    console.log('     a ignorá-lo. NÃO suba a feature: leve este número para a');
    console.log('     Natália antes.');
  }
  if (!r.ok) {
    console.log(`  motivo .............. ${r.motivoAbort ?? '(falha de gravação)'}`);
    console.log(
      '  -> Nada foi apagado. Rode de novo quando o Órix estiver no ar;',
    );
    console.log('     o que já entrou permanece e o restante completa.');
    process.exitCode = 1;
  }
  console.log('');
}

main().catch((err) => {
  log.error('[sincronizar-estoque] Falhou:', err);
  process.exit(1);
});
