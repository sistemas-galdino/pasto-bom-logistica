# Supabase — Sistema de Logística (Pasto Bom)

Migrations da Fase 1. Aplicar **em ordem numérica**.

## Arquivos

| Ordem | Arquivo                  | Conteúdo |
|-------|--------------------------|----------|
| 1     | `0001_schema.sql`        | Extensões (`pgcrypto`), enums, tabelas e índices. |
| 2     | `0002_rls.sql`           | RLS em todas as tabelas de dados + helper `papel_atual()`. |
| 3     | `0003_seed_config.sql`   | Seeds em `sync_state` (status gatilho/cancelado/concluído, cursor, templates PT-BR). |

## Como aplicar

### Via Supabase CLI (recomendado)

```bash
supabase db push
```

Ou, aplicando os arquivos manualmente em ordem:

```bash
supabase db execute --file supabase/migrations/0001_schema.sql
supabase db execute --file supabase/migrations/0002_rls.sql
supabase db execute --file supabase/migrations/0003_seed_config.sql
```

### Via psql

```bash
psql "$DATABASE_URL" -f supabase/migrations/0001_schema.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_rls.sql
psql "$DATABASE_URL" -f supabase/migrations/0003_seed_config.sql
```

## Enums

- `status_logistico`: `pendente`, `agendada`, `em_rota`, `entregue`, `cancelada`
- `ator_evento`: `sistema`, `usuario`
- `status_envio_whatsapp`: `pendente`, `enviada`, `falha`

## Papéis e RLS

O papel do usuário é resolvido pela função `public.papel_atual()`, que lê
`profiles.papel` pelo `auth.uid()`. Papéis possíveis: `logistica`, `vendedor`,
`motorista`.

- **logistica**: leitura + escrita total.
- **vendedor**: somente leitura de pedidos, itens, clientes e propriedades.
- **motorista**: leitura do próprio escopo (políticas mínimas — Fase 3).

> O **backend** usa a `SUPABASE_SERVICE_ROLE_KEY`. O papel `service_role` do
> Postgres **ignora RLS** (bypass nativo), então o worker e a API server-side
> operam com acesso total independentemente destas políticas.

## sync_state — chaves configuráveis

| Chave              | Valor inicial |
|--------------------|---------------|
| `status_gatilho`   | `["00041","00045","00027","00028"]` |
| `status_cancelado` | `["00031"]` |
| `status_concluido` | `["00030"]` |
| `poll_cursor`      | `{"last_to": null}` |
| `templates`        | objeto com `agendamento`, `em_rota`, `entregue` (PT-BR) |

Estes valores podem ser editados em runtime sem nova migration.

## Profiles e auth

`profiles.id` referencia `auth.users(id)`. Após criar um usuário no Supabase
Auth, insira o `profile` correspondente com o `papel` desejado, por exemplo:

```sql
insert into profiles (id, papel, nome)
values ('<uuid-do-auth-user>', 'logistica', 'Operador Logística');
```
