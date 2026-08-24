// [AGENTE WORKER] Carga inicial / manual do espelho de fornecedores:
//
//   node --import tsx --env-file-if-exists=.env \
//     apps/backend/src/scripts/sincronizar-fornecedores.ts
//
// É a MESMA rotina que o scheduler roda de hora em hora (FORNECEDORES_CRON, com
// intervalo de FORNECEDORES_INTERVALO_HORAS) — nenhuma regra duplicada aqui.
// Serve para a CARGA INICIAL: depois de subir a 0021, o autocomplete da reserva
// nasce vazio e ninguém quer esperar o primeiro tick para testar a tela.
//
// O upsert é idempotente (`onConflict: 'codigo'`) e o espelho NUNCA apaga quem
// não veio: rodar duas vezes não duplica nem esvazia nada.
//
// ATENÇÃO: o servidor do Órix é instável e cai à noite. Ciclo abortado no meio
// não é bug — o que já entrou fica, e a próxima execução completa. O placar
// abaixo diz exatamente o que faltou.

import {
  LIMITE_PAGINA,
  registrarSincronizacaoFornecedores,
  sincronizarFornecedoresOnce,
} from '../worker/fornecedores.js';
import { log } from '../log.js';

async function main(): Promise<void> {
  const r = await sincronizarFornecedoresOnce();
  await registrarSincronizacaoFornecedores(r);

  // Placar contra o que o Órix ANUNCIOU: `paginas × limite` é o teto do
  // cadastro (a última página vem incompleta), então é uma referência de ordem
  // de grandeza, não um número exato. O que importa é a linha das páginas: 18
  // de 18 significa cadastro inteiro varrido.
  const esperadoMax = r.paginasTotal * LIMITE_PAGINA;

  console.log('');
  console.log('=== ESPELHO DE FORNECEDORES (Órix -> banco) ===');
  console.log(`  resultado ........... ${r.ok ? 'OK' : 'PARCIAL (ver motivo)'}`);
  console.log(
    `  páginas ............. ${r.paginasLidas}/${r.paginasTotal} (limite ${LIMITE_PAGINA}/página)`,
  );
  console.log(
    `  registros lidos ..... ${r.registros}` +
      (esperadoMax > 0 ? ` (teto anunciado pelo Órix: ${esperadoMax})` : ''),
  );
  console.log(`  gravados no espelho . ${r.gravados}`);
  if (r.semCodigo > 0) {
    console.log(`  sem código (pulados)  ${r.semCodigo}`);
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
  log.error('[sincronizar-fornecedores] Falhou:', err);
  process.exit(1);
});
