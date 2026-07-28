-- 0015_rls_tabelas_backup.sql
-- Fecha as tabelas de snapshot criadas pela 0014.
--
-- FALHA DA 0014: ela cria backup_pedidos_pre_entregas e
-- backup_itens_separacao_pre_entregas com `create table as` e nunca liga RLS.
-- No Supabase, tabela em `public` sem RLS é legível E GRAVÁVEL por qualquer um
-- com a chave `anon` — que vai no bundle do frontend e é pública por definição.
-- São 347 pedidos com motorista, caminhão, data de entrega e motivo de não
-- entrega expostos.
--
-- SEM POLICY, DE PROPÓSITO. Ligar RLS e não criar nenhuma policy bloqueia
-- `anon` e `authenticated` por completo, que é exatamente o desejado: nenhuma
-- tela lê estas tabelas. O backend continua enxergando porque usa a
-- SERVICE_ROLE_KEY, que passa por cima de RLS — e é ele (ou o rollback da 0014)
-- quem precisa delas.
--
-- ROLLBACK: 0015_rls_tabelas_backup_rollback.sql
--
-- Os `if exists` existem porque as tabelas só nascem quando a 0014 roda: em um
-- banco onde ela ainda não passou, esta migração deve ser inócua, não quebrar.

do $$
begin
  if to_regclass('public.backup_pedidos_pre_entregas') is not null then
    execute 'alter table public.backup_pedidos_pre_entregas enable row level security';
  end if;

  if to_regclass('public.backup_itens_separacao_pre_entregas') is not null then
    execute 'alter table public.backup_itens_separacao_pre_entregas enable row level security';
  end if;
end
$$;
