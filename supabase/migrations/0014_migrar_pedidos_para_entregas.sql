-- 0014_migrar_pedidos_para_entregas.sql
-- ONDA 2 — converte o estado atual dos pedidos em ENTREGAS.
--
-- Cada pedido que já estava em andamento (agendada / em_rota / entregue /
-- nao_realizado) vira UMA entrega com os itens integrais. É a leitura correta
-- do passado: até aqui, um pedido só podia sair uma vez.
--
-- PRINCÍPIO DE PROJETO DESTA MIGRAÇÃO: NADA É DESTRUÍDO.
-- ---------------------------------------------------------------------------
-- As colunas de agendamento do pedido (data_agendada, periodo, motorista_id,
-- caminhao_id) e as marcas de separação em itens_pedido CONTINUAM COMO ESTÃO.
-- O código novo simplesmente para de lê-las. Some isso ao snapshot criado
-- abaixo e o rollback vira uma operação real, não uma promessa.
--
-- O que muda em pedidos: apenas status_logistico, que passa a ter um
-- significado mais estreito (ver bloco 3).
--
-- ROLLBACK: 0014_migrar_pedidos_para_entregas_rollback.sql

-- ---------------------------------------------------------------------------
-- 1) SNAPSHOT — a rede de segurança
-- ---------------------------------------------------------------------------
-- Fotografia do estado logístico ANTES da conversão. Poucas centenas de linhas;
-- o custo é irrelevante perto de conseguir voltar atrás com precisão.
create table if not exists backup_pedidos_pre_entregas as
select
  id,
  status_logistico,
  data_agendada,
  periodo,
  motorista_id,
  caminhao_id,
  data_entregue,
  motivo_nao_entrega,
  now() as snapshot_em
from pedidos;

create unique index if not exists idx_backup_pedidos_pre_entregas_id
  on backup_pedidos_pre_entregas (id);

-- As marcas de separação também: elas saem de itens_pedido e passam a viver na
-- entrega, e a ingestão reescreve itens_pedido a cada 5 minutos.
create table if not exists backup_itens_separacao_pre_entregas as
select
  pedido_id,
  produto_codigo,
  separado,
  separado_em,
  now() as snapshot_em
from itens_pedido
where separado;

-- ---------------------------------------------------------------------------
-- 2) CONVERSÃO — um pedido em andamento vira uma entrega
-- ---------------------------------------------------------------------------
-- Idempotente: o `not exists` impede que rodar de novo duplique entregas.
--
-- data_agendada é NOT NULL na tabela nova, mas há pedidos antigos SEM data
-- (entregues antes de o agendamento existir). O coalesce desce a escada até
-- achar uma data defensável, preferindo sempre a mais próxima da realidade:
-- a agendada, senão o dia da entrega, senão a data do pedido.
insert into entregas (
  pedido_id, status, data_agendada, periodo, motorista_id, caminhao_id,
  propriedade_codigo, data_entregue, motivo_nao_entrega, observacoes,
  criado_em, atualizado_em
)
select
  p.id,
  p.status_logistico::text::status_entrega,
  coalesce(p.data_agendada, p.data_entregue::date, p.data_pedido, current_date),
  p.periodo,
  p.motorista_id,
  p.caminhao_id,
  p.propriedade_codigo,
  p.data_entregue,
  p.motivo_nao_entrega,
  p.observacoes,
  p.criado_em,
  now()
from pedidos p
where p.status_logistico in ('agendada', 'em_rota', 'entregue', 'nao_realizado')
  and not exists (select 1 from entregas e where e.pedido_id = p.id);

-- Itens da entrega: TODA a quantidade do pedido (no modelo antigo não havia
-- entrega parcial — o pedido saía inteiro ou não saía).
--
-- Agregado por produto por causa do UNIQUE (entrega_id, produto_codigo): há
-- pedidos que trazem o mesmo produto em duas linhas. bool_or na separação: se
-- qualquer linha daquele produto estava conferida, o produto está conferido.
insert into entrega_itens (
  entrega_id, produto_codigo, nome_produto, qtd, separado, separado_em
)
select
  e.id,
  i.produto_codigo,
  min(i.nome_produto),
  sum(i.qtd),
  bool_or(coalesce(i.separado, false)),
  max(i.separado_em)
from entregas e
join itens_pedido i on i.pedido_id = e.pedido_id
where i.produto_codigo is not null
  and i.produto_codigo <> ''
  and coalesce(i.qtd, 0) > 0
  and not exists (select 1 from entrega_itens ei where ei.entrega_id = e.id)
group by e.id, i.produto_codigo;

-- ---------------------------------------------------------------------------
-- 3) O PEDIDO GANHA UM SIGNIFICADO MAIS ESTREITO
-- ---------------------------------------------------------------------------
-- A partir daqui, pedidos.status_logistico responde por uma pergunta só: em que
-- situação está a ORDEM DE VENDA?
--
--   pendente  = ordem em aberto (o quadro decide se mostra pelo SALDO, não por
--               este campo)
--   entregue  = saldo zerado, tudo entregue
--   cancelada = cancelada no Órix ou descartada
--
-- 'agendada', 'em_rota' e 'nao_realizado' deixam de valer para o PEDIDO — são
-- estados da VIAGEM e agora moram em entregas.status. Os valores continuam no
-- enum (o Postgres não remove valor de enum sem recriar o tipo), apenas não são
-- mais usados aqui.
update pedidos
   set status_logistico = 'pendente',
       atualizado_em = now()
 where status_logistico in ('agendada', 'em_rota', 'nao_realizado');

-- Nota: NÃO limpamos data_agendada/periodo/motorista_id/caminhao_id. Ficam como
-- legado congelado, e são exatamente o que permite o rollback reconstruir o
-- estado anterior.
