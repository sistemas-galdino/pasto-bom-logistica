-- 0027_observacao_agendamento.sql
-- OBSERVAÇÃO DO AGENDAMENTO — pedido da Natália, 06/11/2026.
--
-- POR QUÊ
-- ---------------------------------------------------------------------------
-- Quem agenda precisa deixar um recado para a viagem ("ligar antes de sair",
-- "entregar na porteira de baixo"), visível em todo o fluxo até a entrega ser
-- concluída: quadro, agenda, detalhe e a tela do motorista.
--
-- POR QUE COLUNA PRÓPRIA, E NÃO `observacoes`
-- ---------------------------------------------------------------------------
-- `entregas.observacoes` já guarda o HISTÓRICO (reagendamentos, nota de
-- conclusão), sempre anexando linhas. O recado de quem agendou é outra coisa:
-- um texto só, que pode ser corrigido no reagendamento. Misturar os dois faria
-- o motorista ler o histórico inteiro para achar o recado.
--
-- NULO = sem observação. Coluna nova e opcional: o backend em produção, que
-- não a conhece, segue funcionando igual — a migração pode rodar antes do deploy.
--
-- ROLLBACK: 0027_observacao_agendamento_rollback.sql

alter table entregas
  add column if not exists observacao_agendamento text;

comment on column entregas.observacao_agendamento is
  'Recado de quem agendou a viagem; aparece em todo o fluxo até a conclusão. '
  'NULL = sem observação.';
