-- ROLLBACK de 0027_observacao_agendamento.sql
--
-- O QUE SE PERDE: a observação de agendamento de todas as viagens.
-- Para guardar antes:
--   select id, data_agendada, observacao_agendamento
--     from entregas where observacao_agendamento is not null;
--
-- O backend novo quebra (lê a coluna). Reverta o deploy ANTES.

alter table entregas drop column if exists observacao_agendamento;
