// [FUNDAÇÃO] Carrega e valida variáveis de ambiente com zod.
// Falha cedo (process.exit) caso a configuração esteja inconsistente.

import { z } from 'zod';

const envSchema = z.object({
  // Órix
  ORIX_BASE_URL: z.string().url(),
  ORIX_LOGIN: z.string().min(1),
  ORIX_SENHA: z.string().min(1),
  ORIX_EMPRESA: z.coerce.number().int().default(2),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().optional().default(''),

  // Evolution (WhatsApp) — opcionais: ausência => modo dry-run
  EVOLUTION_URL: z.string().optional().default(''),
  EVOLUTION_INSTANCE: z.string().optional().default(''),
  EVOLUTION_API_KEY: z.string().optional().default(''),
  // Modo teste: se preenchido, TODOS os envios de WhatsApp vão para este número
  // (em vez do cliente). Vazio => comportamento normal.
  WHATSAPP_NUMERO_TESTE: z.string().optional().default(''),

  // Worker / API
  POLL_CRON: z.string().min(1).default('*/5 * * * *'),
  // Reconciliação com o Órix (pedido cancelado sai do painel). Roda mais espaçada
  // que o poll de propósito: a varredura cobre TODOS os pedidos em aberto, não
  // só a janela do dia.
  RECONCILIAR_CRON: z.string().min(1).default('*/30 * * * *'),
  // Varredura profunda: um ano de pedidos nos status de gatilho, para pegar o
  // pedido ANTIGO que só agora entrou no gatilho (o 00027 "Parcial" chega dias
  // ou meses depois da data do pedido, e a API só filtra por data do pedido).
  //
  // NÃO é horário de execução, é a frequência da VERIFICAÇÃO: de hora em hora o
  // worker pergunta "faz mais de VARREDURA_INTERVALO_HORAS que não varro?" e só
  // então varre. Horário fixo não serve — nem o Órix nem o servidor ficam de pé
  // de madrugada, e um cron noturno abortaria todo dia sem nunca completar.
  VARREDURA_CHECK_CRON: z.string().min(1).default('15 * * * *'),
  // 20 e não 24 de propósito: 24 fixaria a varredura no mesmo horário todo dia.
  // Com 20 ela anda ~4 h por dia e cedo ou tarde cai na janela em que o Órix
  // está no ar, sem ninguém precisar descobrir qual é essa janela.
  VARREDURA_INTERVALO_HORAS: z.coerce.number().positive().default(20),
  API_PORT: z.coerce.number().int().positive().default(3333),
  // URL do frontend — usada no link de convite (definir senha). NÃO envia
  // e-mail: o link é copiado na tela Usuários e mandado pela logística.
  APP_URL: z.string().url().default('http://localhost:5173'),
  ALLOW_NO_AUTH: z
    .union([z.literal('true'), z.literal('false')])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

function carregar(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detalhes = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(
      `[config/env] Variáveis de ambiente inválidas:\n${detalhes}`,
    );
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = carregar();
