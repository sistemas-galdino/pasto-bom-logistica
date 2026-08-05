-- 0017_reset_quadro_teste_rollback.sql
-- Desfaz a 0017_reset_quadro_teste.sql, restaurando a partir dos snapshots que
-- ela criou ANTES de apagar.
--
-- O QUE VOLTA: as 13 entregas de teste, seus itens, os eventos de auditoria
-- ligados a elas, o status/agendamento dos pedidos mexidos e as marcas de
-- separação da Onda 1.
--
-- O QUE **NÃO** VOLTA: nada que tenha sido criado DEPOIS da 0017. Se a equipe
-- já agendou viagens de verdade no quadro limpo, este rollback as apaga junto
-- (o delete abaixo é total, para a restauração não colidir com ids repetidos).
-- Confira antes:
--
--   select count(*) from entregas;   -- se for > 0, você vai perder isto
--
-- ORDEM DE REVERSÃO do repo é DECRESCENTE: 0017 antes da 0016.

begin;

-- Sem os snapshots não há o que restaurar — melhor abortar do que apagar as
-- entregas atuais e não conseguir repor as antigas.
do $$
begin
  if to_regclass('public.backup_entregas_pre_reset') is null then
    raise exception
      'ABORTADO: backup_entregas_pre_reset não existe. Ou a 0017 nunca foi '
      'aplicada, ou os snapshots já foram descartados. Nada foi alterado.';
  end if;
end $$;

-- 1) Limpa o estado atual para a restauração não colidir por chave primária.
delete from entregas;

-- 2) Repõe as viagens e seus itens (a ordem importa: itens têm FK para entrega).
insert into entregas select * from backup_entregas_pre_reset;
insert into entrega_itens select * from backup_entrega_itens_pre_reset;

-- 3) Repõe os eventos de auditoria que caíram por cascade.
insert into eventos_status select * from backup_eventos_entrega_pre_reset;

-- 4) Devolve os pedidos ao estado anterior, coluna a coluna.
update pedidos p
   set status_logistico   = b.status_logistico,
       data_agendada      = b.data_agendada,
       periodo            = b.periodo,
       data_entregue      = b.data_entregue,
       motorista_id       = b.motorista_id,
       caminhao_id        = b.caminhao_id,
       motivo_nao_entrega = b.motivo_nao_entrega,
       atualizado_em      = now()
  from backup_pedidos_pre_reset b
 where p.id = b.id;

-- 5) Devolve as marcas de separação da Onda 1.
update itens_pedido i
   set separado    = b.separado,
       separado_em = b.separado_em
  from backup_itens_separacao_pre_reset b
 where i.id = b.id;

-- 6) Os snapshots FICAM (regra 4 do README): são a única fonte do estado
--    pré-reset e podem ser precisos numa auditoria. Como este rollback limpa
--    antes de repor, rodá-lo duas vezes dá o mesmo resultado — não há risco em
--    mantê-los. Para descartá-los depois, à mão:
--
--      drop table backup_entregas_pre_reset,
--                 backup_entrega_itens_pre_reset,
--                 backup_eventos_entrega_pre_reset,
--                 backup_pedidos_pre_reset,
--                 backup_itens_separacao_pre_reset;

commit;
