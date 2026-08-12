-- 0018_link_acesso.sql
-- Link curto de acesso (criar/redefinir senha), no nosso domínio.
--
-- POR QUE (queixa da Natália, 12/08/2026): "o link está expirando muito rápido"
-- e "é muito longo e feio".
--
-- Até aqui a tela Usuários entregava o `action_link` cru do Supabase, que aponta
-- para .../auth/v1/verify?token=...&redirect_to=... . Três problemas nascem daí:
--
--   1. o token é de USO ÚNICO e é gasto por QUEM ABRIR A URL — inclusive um
--      robô. O WhatsApp busca o link para montar a pré-visualização, e essa
--      visita já queima o token: a pessoa clica depois e vê "link inválido";
--   2. a validade é a do painel do Supabase (o código nunca passou expiry),
--      tipicamente 1 hora — curta demais para um fluxo de WhatsApp;
--   3. o domínio é o do Supabase, não o nosso.
--
-- A solução: a logística passa a mandar um link NOSSO, curto, que só abre uma
-- página com um botão. O link do Supabase é gerado no INSTANTE do clique — o
-- relógio dele começa a correr com a pessoa na tela, e expirar em trânsito
-- deixa de ser possível. Ver apps/backend/src/api/routes/acesso.ts.
--
-- São colunas em `profiles`, e não tabela nova, porque a semântica real é "um
-- link ativo por pessoa": gerar de novo sobrescreve o anterior, que é
-- exatamente o comportamento que a equipe espera do botão "Regerar link".

-- Guardamos o SHA-256 do token, NUNCA o token. `profiles` é legível via RLS
-- pela própria pessoa e pela logística (0002_rls.sql:47-49); com hash, quem ler
-- a coluna não consegue usar o link.
alter table profiles add column if not exists acesso_token_hash text;
alter table profiles add column if not exists acesso_expira_em  timestamptz;
alter table profiles add column if not exists acesso_usado_em   timestamptz;

comment on column profiles.acesso_token_hash is
  'SHA-256 (hex) do token do link curto de acesso. Null = sem link ativo. '
  'O token em claro só existe no link que a logística copia.';
comment on column profiles.acesso_expira_em is
  'Quando o link curto deixa de valer (7 dias a partir da geração).';
comment on column profiles.acesso_usado_em is
  'Primeiro clique no botão da página /acesso. Registro de auditoria: o link '
  'NÃO morre aqui (se o redirecionamento falhar, a pessoa tenta de novo). Ele '
  'morre quando a senha é definida, ou ao expirar.';

-- Índice parcial: a busca é por hash e só interessa quem tem link ativo.
create index if not exists idx_profiles_acesso_token_hash
  on profiles (acesso_token_hash)
  where acesso_token_hash is not null;
