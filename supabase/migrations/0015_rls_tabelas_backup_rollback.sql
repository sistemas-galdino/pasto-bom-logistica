-- 0015_rls_tabelas_backup_rollback.sql
-- Desfaz a 0015: devolve as tabelas de snapshot ao estado SEM RLS.
--
-- LEIA ANTES DE RODAR: voltar daqui reabre as duas tabelas para a chave `anon`
-- (leitura e escrita de 347 pedidos com motorista, caminhão e motivo de não
-- entrega). Este rollback existe só para a ordem decrescente de reversão ficar
-- completa — se o problema for "o backend não enxerga o backup", a causa não é
-- esta migração: com SERVICE_ROLE_KEY o RLS não se aplica.

do $$
begin
  if to_regclass('public.backup_pedidos_pre_entregas') is not null then
    execute 'alter table public.backup_pedidos_pre_entregas disable row level security';
  end if;

  if to_regclass('public.backup_itens_separacao_pre_entregas') is not null then
    execute 'alter table public.backup_itens_separacao_pre_entregas disable row level security';
  end if;
end
$$;
