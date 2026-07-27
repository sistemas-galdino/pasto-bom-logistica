-- 0014_migrar_pedidos_para_entregas_rollback.sql
-- Desfaz a 0014, devolvendo os pedidos ao estado logístico do snapshot.
--
-- ORDEM: rode ESTE arquivo primeiro; só depois o 0013_entregas_rollback.sql
-- (que derruba as tabelas de entrega usadas aqui).
--
-- O QUE VOLTA EXATAMENTE COMO ERA
-- ---------------------------------------------------------------------------
--   - status_logistico de todos os pedidos (do snapshot);
--   - data_agendada, periodo, motorista_id, caminhao_id: nunca foram alterados;
--   - marcas de separação em itens_pedido: nunca foram alteradas.
--
-- O QUE NÃO VOLTA
-- ---------------------------------------------------------------------------
-- O trabalho feito DEPOIS da migração, no modelo novo:
--   - entregas criadas depois (o modelo antigo não tem onde guardar N viagens);
--   - entregas parciais: se um pedido de 180 saiu com 100, o modelo antigo não
--     sabe representar "faltam 80" — ele volta ao status que tinha no snapshot;
--   - separações feitas na entrega depois da migração.
--
-- Por isso: quanto mais tempo o modelo novo rodar, mais caro fica voltar. O
-- rollback é uma saída de emergência para as primeiras horas/dias, não um
-- botão de desfazer permanente.
--
-- ANTES DE RODAR, exporte o que foi feito no modelo novo:
--
--   select p.orix_numero, e.status, e.data_agendada, e.periodo,
--          i.produto_codigo, i.qtd
--     from entregas e
--     join pedidos p on p.id = e.pedido_id
--     left join entrega_itens i on i.entrega_id = e.id
--    where e.criado_em > (select max(snapshot_em) from backup_pedidos_pre_entregas)
--    order by p.orix_numero;

-- ---------------------------------------------------------------------------
-- 1) Confere que o snapshot existe — sem ele não há rollback possível.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public'
       and table_name = 'backup_pedidos_pre_entregas'
  ) then
    raise exception
      'backup_pedidos_pre_entregas não existe: a 0014 não chegou a rodar, ou o snapshot foi removido. Rollback abortado.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Restaura o estado logístico dos pedidos
-- ---------------------------------------------------------------------------
-- Só o status precisa voltar: os demais campos nunca foram tocados pela 0014.
-- Ainda assim restauramos os quatro do agendamento, para o caso de o código
-- novo ter escrito neles antes do rollback.
update pedidos p
   set status_logistico = b.status_logistico,
       data_agendada    = b.data_agendada,
       periodo          = b.periodo,
       motorista_id     = b.motorista_id,
       caminhao_id      = b.caminhao_id,
       data_entregue    = b.data_entregue,
       motivo_nao_entrega = b.motivo_nao_entrega,
       atualizado_em    = now()
  from backup_pedidos_pre_entregas b
 where b.id = p.id;

-- ---------------------------------------------------------------------------
-- 3) Restaura as marcas de separação em itens_pedido
-- ---------------------------------------------------------------------------
-- A ingestão pode ter recriado os itens desde então; o casamento é por produto,
-- que é a chave estável (o id do item é descartável — ver 0013).
update itens_pedido i
   set separado = true,
       separado_em = b.separado_em
  from backup_itens_separacao_pre_entregas b
 where b.pedido_id = i.pedido_id
   and b.produto_codigo = i.produto_codigo;

-- ---------------------------------------------------------------------------
-- 4) Limpa a auditoria das transições de ENTREGA
-- ---------------------------------------------------------------------------
-- Eventos de viagens que deixarão de existir. Os eventos do PEDIDO (entrega_id
-- nulo) ficam intactos — são o histórico legítimo.
delete from eventos_status where entrega_id is not null;

-- ---------------------------------------------------------------------------
-- 5) Os snapshots ficam
-- ---------------------------------------------------------------------------
-- Não removemos as tabelas de backup: se o rollback precisar ser repetido ou
-- auditado, elas são a única fonte. Para descartar depois de tudo estabilizado:
--
--   drop table backup_pedidos_pre_entregas;
--   drop table backup_itens_separacao_pre_entregas;
