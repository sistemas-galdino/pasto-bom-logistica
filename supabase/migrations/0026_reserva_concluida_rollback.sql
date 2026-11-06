-- ROLLBACK de 0026_reserva_concluida.sql
--
-- O QUE SE PERDE: a marca de conclusão de todas as reservas (quando e quem).
-- As reservas em si ficam intactas, todas como 'ativa' ou 'cancelada'.
-- Para guardar antes:
--   select id, servico, data_agendada, concluida_em, concluida_por
--     from reservas where concluida_em is not null;
--
-- O backend novo quebra (lê as colunas). Reverta o deploy ANTES.

alter table reservas drop column if exists concluida_por;
alter table reservas drop column if exists concluida_em;
