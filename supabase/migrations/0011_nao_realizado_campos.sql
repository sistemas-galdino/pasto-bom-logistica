-- 0011_nao_realizado_campos.sql
-- Complementa a 0010 (que só criou o valor de enum 'nao_realizado').
--
-- 1) motivo da não-entrega;
-- 2) índice em data_pedido — GET /pedidos ORDENA por essa coluna (agora
--    ascendente, "mais antigas primeiro") e ela nunca teve índice;
-- 3) índice para a tela de Separação, que busca as agendadas de um dia.

-- 1) Por que a entrega não foi feita. Preenchido na transição -> nao_realizado
--    e limpo quando a logística remarca (reversão -> pendente).
alter table pedidos add column if not exists motivo_nao_entrega text;

-- 2) Ordenação da lista de entregas (data de entrada da ordem de venda).
create index if not exists idx_pedidos_data_pedido on pedidos (data_pedido);

-- 3) Fila de separação do dia.
create index if not exists idx_pedidos_separacao
  on pedidos (data_agendada, periodo)
  where status_logistico = 'agendada';
