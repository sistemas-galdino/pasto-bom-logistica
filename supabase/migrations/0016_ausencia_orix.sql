-- 0016_ausencia_orix.sql
-- Carimbo de AUSÊNCIA do pedido na resposta do Órix.
--
-- POR QUE (áudio da Natália, 05/08/2026):
--   "aparecer o que foi concluído também não é para ficar aparecendo aí mais"
--
-- A reconciliação (worker/reconciliar.ts) consulta o Órix nos status de GATILHO
-- + CANCELADO. O pedido que é FATURADO sai do gatilho (vira 00030) e some da
-- resposta — e até aqui o código simplesmente o ignorava, deixando-o preso na
-- coluna Pendente para sempre. Eram 52 pedidos parados há mais de um mês.
--
-- A detecção NÃO consulta o 00030 (seria toda venda faturada do período, dezenas
-- de milhares de linhas contra um servidor que já cai sozinho): a própria
-- ausência é o sinal. Como é um sinal indireto, ele nunca age de imediato —
-- carimba a primeira ausência aqui e só descarta depois da carência (24 h no
-- worker). O servidor do Órix é instável; um único ciclo estranho não pode
-- esvaziar o quadro.
--
-- A coluna é limpa (volta a null) assim que o pedido reaparece no Órix.

alter table pedidos add column if not exists ausente_orix_desde timestamptz;

comment on column pedidos.ausente_orix_desde is
  'Quando o pedido foi visto pela primeira vez FORA da resposta do Órix '
  '(nem em gatilho, nem cancelado). Null = presente. Ver worker/reconciliar.ts.';

-- Índice parcial: a varredura só se interessa por quem está carimbado, e são
-- poucos. Índice cheio numa tabela de milhares de linhas seria desperdício.
create index if not exists idx_pedidos_ausente_orix
  on pedidos (ausente_orix_desde)
  where ausente_orix_desde is not null;
