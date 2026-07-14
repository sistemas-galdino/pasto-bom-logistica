-- 0010_status_nao_realizado.sql
-- Novo status logístico: 'nao_realizado' (o caminhão foi e a entrega não aconteceu).
--
-- ESTA MIGRATION FICA SOZINHA DE PROPÓSITO.
-- O Postgres não permite USAR um valor de enum na mesma transação em que ele é
-- criado ("unsafe use of new value of enum type"). Qualquer coisa que referencie
-- 'nao_realizado' (policy, default, update, check) tem de vir numa migration
-- SEGUINTE — ver 0011_nao_realizado_campos.sql.

alter type status_logistico add value if not exists 'nao_realizado';
