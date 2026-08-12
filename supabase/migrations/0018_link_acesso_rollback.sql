-- 0018_link_acesso_rollback.sql
-- Desfaz a 0018_link_acesso.sql.
--
-- O QUE SE PERDE: os links curtos de acesso que estiverem pendentes param de
-- funcionar. Quem recebeu um link e ainda não criou a senha vai encontrar
-- "link inválido" e precisa que a logística gere outro — dois cliques na tela
-- Usuários. Não há dado de negócio nestas colunas: são token, prazo e carimbo
-- de uso.
--
-- O QUE NÃO SE PERDE: nenhum usuário, papel ou senha. Quem já entrou continua
-- entrando normalmente; `profiles` mantém id, papel e nome intactos.
--
-- Para exportar os links pendentes antes de derrubar (só para saber a quem
-- avisar — o token não é recuperável, é hash):
--   select id, nome, papel, acesso_expira_em, acesso_usado_em
--     from profiles
--    where acesso_token_hash is not null
--      and acesso_expira_em > now()
--      and acesso_usado_em is null;
--
-- ATENÇÃO: a versão atual do sistema grava e lê estas colunas. Só rode este
-- rollback junto com o deploy de uma versão anterior, senão a geração de link
-- na tela Usuários passa a falhar.

drop index if exists idx_profiles_acesso_token_hash;

alter table profiles drop column if exists acesso_usado_em;
alter table profiles drop column if exists acesso_expira_em;
alter table profiles drop column if exists acesso_token_hash;
