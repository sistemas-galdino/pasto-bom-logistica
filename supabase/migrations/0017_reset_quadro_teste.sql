-- 0017_reset_quadro_teste.sql
-- RESET do quadro: apaga o que a equipe criou testando.
--
-- POR QUE (áudio da Natália, 05/08/2026)
-- --------------------------------------
--   "a gente fez teste, moveu nos Kanbans, moveu todas as coisas (...) a gente
--    queria que desse um reset e começasse realmente a mostrar no início do
--    Kanban o que realmente a gente tem a partir de hoje."
--
-- Levantamento de 05/08: as 13 entregas do banco foram criadas entre 15/06 e
-- 28/07 e TODAS são teste — entrega só nasce por ação manual no painel, e a
-- operação de verdade ainda não começou. Junto com elas saem os 6 pedidos que
-- ficaram 'entregue' por causa desses testes e o resíduo de agendamento da
-- Onda 1 que sobrou em 13 pedidos (data agendada, motorista, caminhão), colunas
-- que a GET /pedidos ainda devolve e que apareceriam em cards Pendente.
--
-- O QUE **NÃO** É APAGADO
-- -----------------------
--  - Os 183 pedidos pendentes. São o backlog verdadeiro vindo do Órix, e é
--    justamente o que ela quer ver. Quem não estiver mais em aberto no Órix sai
--    pela outra frente (worker/reconciliar.ts + npm run limpar:fora-orix), que
--    confirma contra o ERP antes de descartar.
--  - mensagens_whatsapp. São o registro do que de fato foi enviado a números
--    reais durante o teste; apagar auditoria de envio é pior do que conviver
--    com ela.
--  - eventos_status dos PEDIDOS. Só os eventos ligados às entregas apagadas
--    saem (e vão para o snapshot).
--
-- REVERSÍVEL: 0017_reset_quadro_teste_rollback.sql restaura tudo a partir dos
-- snapshots criados aqui.

begin;

-- ---------------------------------------------------------------------------
-- 0) GUARDA. Se esta migração for aplicada tarde demais — depois de a equipe já
--    estar operando de verdade — ela ABORTA em vez de apagar trabalho real.
--    Mesmo padrão da 0013, que se recusa a dropar tabela com linhas.
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  select count(*) into n from entregas where criado_em::date > date '2026-07-28';
  if n > 0 then
    raise exception
      'ABORTADO: % entrega(s) criada(s) depois de 28/07/2026. Esta migração '
      'apaga TODAS as entregas por assumir que são o teste da equipe (o '
      'levantamento de 05/08 mostrou 13, a última de 28/07). Se a operação já '
      'começou, isto apagaria trabalho real. Refaça o recorte antes de rodar.',
      n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) SNAPSHOTS. Tirados ANTES de qualquer delete — é o que torna o rollback
--    possível. Sem RLS eles seriam legíveis por qualquer usuário autenticado
--    (lição da 0015, que existiu só para corrigir esse esquecimento na 0014).
-- ---------------------------------------------------------------------------
create table if not exists backup_entregas_pre_reset as
  select * from entregas;

create table if not exists backup_entrega_itens_pre_reset as
  select * from entrega_itens;

-- Os eventos ligados a entrega caem por CASCADE no delete abaixo. Sem este
-- snapshot o rollback voltaria "quase" tudo — e auditoria pela metade não é
-- auditoria.
create table if not exists backup_eventos_entrega_pre_reset as
  select * from eventos_status where entrega_id is not null;

-- Estado dos pedidos que vão ser mexidos, coluna a coluna.
create table if not exists backup_pedidos_pre_reset as
  select id, status_logistico, data_agendada, periodo, data_entregue,
         motorista_id, caminhao_id, motivo_nao_entrega
    from pedidos
   where status_logistico = 'entregue'
      or data_agendada is not null
      or periodo is not null
      or data_entregue is not null
      or motorista_id is not null
      or caminhao_id is not null
      or motivo_nao_entrega is not null;

-- Itens que estavam marcados como separados na Onda 1.
create table if not exists backup_itens_separacao_pre_reset as
  select id, separado, separado_em from itens_pedido where separado;

alter table backup_entregas_pre_reset          enable row level security;
alter table backup_entrega_itens_pre_reset     enable row level security;
alter table backup_eventos_entrega_pre_reset   enable row level security;
alter table backup_pedidos_pre_reset           enable row level security;
alter table backup_itens_separacao_pre_reset   enable row level security;

-- ---------------------------------------------------------------------------
-- 2) Apaga as viagens de teste.
--    Cascateia entrega_itens e os eventos_status com entrega_id.
-- ---------------------------------------------------------------------------
delete from entregas;

-- ---------------------------------------------------------------------------
-- 3) Os pedidos que ficaram 'entregue' por causa das viagens de teste voltam
--    para a fila. Os que já estão 'cancelada' NÃO são ressuscitados: cancelado
--    é decisão (comercial ou do descarte), não resíduo de teste.
-- ---------------------------------------------------------------------------
update pedidos
   set status_logistico = 'pendente',
       data_entregue    = null,
       atualizado_em    = now()
 where status_logistico = 'entregue';

-- ---------------------------------------------------------------------------
-- 4) Resíduo de agendamento da Onda 1. Depois da 0014 a verdade da viagem mora
--    em `entregas`; estas colunas de `pedidos` só sobrevivem porque a
--    GET /pedidos ainda as devolve. Preenchidas, fazem um card Pendente exibir
--    motorista e data de uma viagem que não existe mais.
-- ---------------------------------------------------------------------------
update pedidos
   set data_agendada      = null,
       periodo            = null,
       motorista_id       = null,
       caminhao_id        = null,
       motivo_nao_entrega = null,
       atualizado_em      = now()
 where data_agendada is not null
    or periodo is not null
    or motorista_id is not null
    or caminhao_id is not null
    or motivo_nao_entrega is not null;

-- ---------------------------------------------------------------------------
-- 5) Marcas de separação da Onda 1. Nada mais lê esta coluna (a separação vive
--    em entrega_itens desde a 0014), mas deixá-las ligadas confunde quem for
--    depurar depois.
-- ---------------------------------------------------------------------------
update itens_pedido
   set separado = false,
       separado_em = null
 where separado;

commit;

-- Conferência sugerida depois de aplicar:
--   select count(*) from entregas;                                 -- 0
--   select status_logistico, count(*) from pedidos group by 1;     -- só pendente/cancelada
--   select count(*) from itens_pedido where separado;              -- 0
