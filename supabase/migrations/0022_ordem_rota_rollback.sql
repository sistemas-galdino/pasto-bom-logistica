-- ROLLBACK de 0022_ordem_rota.sql
--
-- Perde a ordem das paradas já informadas pelos motoristas. Não perde entrega
-- nenhuma: a coluna é acessória, e sem ela a Rota do Dia volta a ser a lista
-- sem ordem que era antes.

drop index if exists idx_entregas_ordem_rota;

alter table entregas drop column if exists ordem_rota;
