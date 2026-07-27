-- 0013_entregas_rollback.sql
-- Desfaz a 0013_entregas.sql.
--
-- ORDEM DE EXECUÇÃO: rode PRIMEIRO o 0014_migrar_pedidos_para_entregas_rollback.sql
-- e só depois este. A 0014 depende das tabelas que este arquivo remove.
--
-- O QUE ISTO RECUPERA
-- ---------------------------------------------------------------------------
-- Tudo. A 0013 só ACRESCENTA (as tabelas novas) e remove uma tabela que estava
-- vazia e sem uso. Nenhum dado de pedido, item, agendamento ou separação é
-- tocado por ela — de propósito, para que a volta seja possível.
--
-- O QUE SE PERDE
-- ---------------------------------------------------------------------------
-- As entregas criadas DEPOIS da migração (agendamentos feitos já no modelo
-- novo). Isso é inevitável: no modelo antigo não existe onde guardá-las. Antes
-- de rodar, exporte o que quiser preservar:
--
--   select e.*, i.produto_codigo, i.qtd
--     from entregas e join entrega_itens i on i.entrega_id = e.id;

-- 1) Auditoria: solta a referência antes de derrubar a tabela.
drop index if exists idx_eventos_status_entrega;
alter table eventos_status drop column if exists entrega_id;

-- 2) As tabelas novas (entrega_itens cai junto por CASCADE, mas explícito é melhor).
drop table if exists entrega_itens cascade;
drop table if exists entregas cascade;

-- 3) O enum só pode cair depois das tabelas que o usavam.
drop type if exists status_entrega;

-- 4) Recria a tabela `entregas` original da 0001 — a que nunca foi usada.
--    Restaurada por fidelidade ao estado anterior: se o código antigo voltar,
--    ele encontra o schema exatamente como esperava.
create table if not exists entregas (
  id                 uuid primary key default gen_random_uuid(),
  pedido_id          uuid references pedidos(id),
  motorista_id       uuid,
  propriedade_codigo text,
  data_prevista      date,
  data_entregue      timestamptz,
  observacoes        text
);

alter table entregas enable row level security;

drop policy if exists entregas_logistica_all on entregas;
create policy entregas_logistica_all on entregas
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');
