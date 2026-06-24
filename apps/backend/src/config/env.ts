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

  // Worker / API
  POLL_CRON: z.string().min(1).default('*/5 * * * *'),
  API_PORT: z.coerce.number().int().positive().default(3333),
  // URL do frontend — usada no link de convite por e-mail (definir senha).
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
