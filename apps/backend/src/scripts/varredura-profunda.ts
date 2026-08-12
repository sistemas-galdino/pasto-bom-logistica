// [AGENTE WORKER] Dispara a varredura profunda à mão:
//
//   npm run varredura:profunda -w @pastobom/backend
//
// É a MESMA rotina que o scheduler roda de madrugada (VARREDURA_CRON) — sem
// regra duplicada aqui. Serve para não esperar até a madrugada: depois de subir
// a correção, é este comando que traz de uma vez o passivo de pedidos antigos
// que já estavam no gatilho e nunca tinham sido perguntados.
//
// A ingestão é idempotente: rodar duas vezes não duplica nada.
//
// Confira o antes e o depois com `npm run conferir:orix`.

import { varreduraProfundaOnce, registrarSincronizacao } from '../worker/poll.js';
import { log } from '../log.js';

async function main(): Promise<void> {
  const r = await varreduraProfundaOnce();
  await registrarSincronizacao(r, 'varredura_profunda');

  console.log('');
  console.log('=== VARREDURA PROFUNDA ===');
  console.log(`  resultado ....... ${r.ok ? 'OK' : 'ABORTADA'}`);
  console.log(`  sub-janelas ..... ${r.janelas}`);
  console.log(`  linhas lidas .... ${r.itens}`);
  console.log(`  pedidos tratados. ${r.pedidos}`);
  if (!r.ok) {
    console.log(`  motivo .......... ${r.motivoAbort ?? '(não informado)'}`);
    process.exitCode = 1;
  }
  console.log('');
}

main().catch((err) => {
  log.error('[varredura-profunda] Falhou:', err);
  process.exit(1);
});
