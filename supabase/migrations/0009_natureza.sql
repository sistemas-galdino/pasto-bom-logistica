-- 0009_natureza.sql
-- Filtro por NATUREZA DA OPERAÇÃO (pedido da Natália, 13/07/2026):
--   "esse pedido é de natureza 11, ele não deve aparecer no sistema de logística,
--    deve aparecer somente as com natureza 12 e natureza 01"
--
-- `natureza` é um campo FISCAL do Órix, ortogonal ao status: o status diz em que
-- ETAPA o pedido está; a natureza diz O QUE a operação é.
--
--   00001  VENDA                                       -> entrega  ✅
--   00012  VENDA ORIGINADA DE FAT P/ ENTREGA FUTURA    -> a REMESSA (a carga sai) ✅
--   00011  SIMPLES FATURAMENTO DE VENDA P/ ENTREGA FUTURA -> só a NOTA; nada sai ❌
--   00049  REMESSA EM GARANTIA - LOJA                  -> a oficina ❌
--   00043/00002/00015/00022/00025  locação, bonificação, serviço, consumo, perda ❌
--
-- A 11 é o PAR FISCAL da 12 (mesmo negócio, dois documentos). Ingerir as duas faz
-- a MESMA entrega aparecer duas vezes no painel — era o que a cliente estava vendo.
-- Sondagem de 13/07: 647 pedidos natureza 11 × 657 natureza 12 em 210 dias, com 542
-- pares casando por cliente+data.

alter table pedidos add column if not exists natureza text;
alter table pedidos add column if not exists natureza_nome text;

create index if not exists idx_pedidos_natureza on pedidos (natureza);

-- Lista configurável, no mesmo padrão de status_gatilho (muda sem deploy).
insert into sync_state (chave, valor)
values ('natureza_permitida', '["00001","00012"]'::jsonb)
on conflict (chave) do update
  set valor = excluded.valor,
      atualizado_em = now();
