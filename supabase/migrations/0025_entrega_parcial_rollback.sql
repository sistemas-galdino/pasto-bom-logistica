-- ROLLBACK de 0025_entrega_parcial.sql
--
-- ATENÇÃO: não é neutro depois que a equipe usou a entrega parcial.
--   - Some a quantidade declarada: toda entrega parcial volta a consumir a
--     quantidade CARREGADA inteira, e o restante que tinha voltado para a fila
--     some de novo do saldo.
--   - Os cards de restante recusado viram nao_realizado comuns e passam a
--     DEVOLVER a mercadoria: os pedidos encerrados por recusa reaparecem como
--     pendentes. Revise-os à mão (cancele esses cards) antes de rodar.
--   - O backend novo quebra (lê as colunas). Reverta o deploy ANTES.
--
-- O motivo só é removido se nenhuma entrega o usa: motivo_nao_entrega guarda o
-- texto, então apagá-lo não quebraria nada, mas deixaria o relatório com um
-- motivo que não existe mais na lista.

delete from motivos_nao_entrega m
 where m.descricao = 'Cliente recusou o restante'
   and not exists (
     select 1 from entregas e
      where e.motivo_nao_entrega = m.descricao
   );

alter table entregas drop column if exists origem_entrega_id;
alter table entregas drop column if exists encerra_saldo;
alter table entrega_itens drop column if exists qtd_entregue;
