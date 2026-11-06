-- 0026_reserva_concluida.sql
-- RESERVA CONCLUÍDA — pedido da Natália, 06/11/2026.
--
-- POR QUÊ
-- ---------------------------------------------------------------------------
-- A reserva (0021) só tinha 'ativa' e 'cancelada': não havia como dizer que o
-- serviço foi FEITO (a coleta de adubo aconteceu, o caminhão voltou da
-- oficina). Ela também não contava como viagem do motorista em lugar nenhum, e
-- a Rota e o Dashboard pareciam dizer que ele ficou parado o dia todo.
--
-- POR QUE COLUNA, E NÃO UM VALOR NOVO NO ENUM
-- ---------------------------------------------------------------------------
-- 'concluida' no `status_reserva` mudaria o significado de 'ativa' em todo o
-- código que lê ocupação de caminhão (agenda, carga, criar/atualizar): reserva
-- concluída sairia da conta e liberaria o caminhão no slot em que ele ESTEVE
-- ocupado. Com a coluna, a reserva continua 'ativa' — ocupa o slot como antes —
-- e "concluída" é só um fato a mais sobre ela. O backend em produção, que não
-- conhece as colunas, segue funcionando igual: é por isso que esta migração pode
-- rodar antes do deploy.
--
-- concluida_em   NULO = não concluída. Preenchida = quando foi marcada.
-- concluida_por  Quem marcou (logística ou o próprio motorista). ON DELETE SET
--                NULL: apagar o usuário não pode apagar o fato.
--
-- ROLLBACK: 0026_reserva_concluida_rollback.sql

alter table reservas
  add column if not exists concluida_em timestamptz;

alter table reservas
  add column if not exists concluida_por uuid
    references profiles(id) on delete set null;

comment on column reservas.concluida_em is
  'Quando o serviço da reserva foi dado como feito; NULL = não concluída. '
  'A reserva concluída continua ativa: segue ocupando o caminhão no slot.';
comment on column reservas.concluida_por is
  'Quem marcou a conclusão (logística ou o motorista da reserva).';
