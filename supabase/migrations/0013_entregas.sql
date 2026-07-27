-- 0013_entregas.sql
-- ONDA 2 — modelo de ENTREGAS: um pedido pode gerar VÁRIAS entregas.
--
-- POR QUE (reunião de 16/07/2026)
-- ------------------------------------------------------------------------
-- Hoje um card É um pedido, e por isso o pedido só consegue sair uma vez.
-- Duas necessidades reais quebram esse modelo:
--
--   1) Entrega parcial: "tenho 180, vou entregar 100, os 80 ficam para depois."
--   2) Carga grande: "se for um pedido de 100 toneladas que eu tenho que
--      entregar em 10 caminhão, você nunca vai conseguir agendar." (Natália)
--
-- O caso (2) é o que decide o desenho: os 10 caminhões saem AO MESMO TEMPO,
-- então precisam de 10 cards vivos simultaneamente. Guardar o saldo dentro do
-- próprio pedido (uma viagem por vez) não resolveria.
--
-- O MODELO
-- ------------------------------------------------------------------------
-- O PEDIDO passa a ser a ordem de venda (o que o cliente comprou) e a ENTREGA
-- passa a ser a viagem (o que sai no caminhão). O que sobra é SALDO:
--
--   saldo(produto) = Σ itens_pedido.qtd − Σ entrega_itens.qtd
--                    (só das entregas em agendada / em_rota / entregue)
--
-- Entrega 'nao_realizado' e 'cancelada' NÃO consomem saldo. É isso que faz
-- "não realizado devolve para a fila" e "desfazer agendamento libera a vaga do
-- caminhão" acontecerem sozinhos, sem regra especial em lugar nenhum.
--
-- ROLLBACK: 0013_entregas_rollback.sql

-- ---------------------------------------------------------------------------
-- Enum do status da ENTREGA
-- ---------------------------------------------------------------------------
-- Deliberadamente separado de status_logistico: são coisas diferentes. O pedido
-- tem 'pendente'/'entregue'/'cancelada' (tem saldo, zerou, foi cancelado); a
-- entrega tem o ciclo da viagem. Compartilhar o enum convidaria a confundir os
-- dois para sempre.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'status_entrega') then
    create type status_entrega as enum (
      'agendada', 'em_rota', 'entregue', 'nao_realizado', 'cancelada'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Remove a tabela `entregas` MORTA da 0001
-- ---------------------------------------------------------------------------
-- A 0001 criou uma tabela `entregas` (data_prevista, motorista_id, observacoes)
-- que NUNCA foi usada: zero referências no código e zero linhas no banco. Ela é
-- resquício do rascunho inicial e o formato não serve.
--
-- O bloco é idempotente E defensivo: só age se encontrar a tabela ANTIGA (pela
-- coluna data_prevista, que a nova não tem) e ABORTA se houver qualquer linha.
-- Rodar de novo depois de aplicada não faz nada.
do $$
declare
  linhas bigint;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'entregas'
       and column_name = 'data_prevista'
  ) then
    execute 'select count(*) from public.entregas' into linhas;
    if linhas > 0 then
      raise exception
        'A tabela entregas da 0001 tem % linha(s); a 0013 esperava encontrá-la vazia. Investigue antes de continuar.',
        linhas;
    end if;
    drop table public.entregas cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- entregas — uma VIAGEM de um pedido
-- ---------------------------------------------------------------------------
create table if not exists entregas (
  id            uuid primary key default gen_random_uuid(),
  pedido_id     uuid not null references pedidos(id) on delete cascade,
  status        status_entrega not null default 'agendada',

  -- Slot = data × período, o domínio definido na reunião de 25/06.
  -- data_agendada é NOT NULL: uma entrega existe porque foi marcada para um dia.
  -- periodo é nulo por tolerância ao legado (a tela já trata "sem período").
  data_agendada date not null,
  periodo       periodo_entrega,

  motorista_id  uuid,
  caminhao_id   uuid references caminhoes(id),
  -- Para qual propriedade do cliente vai (RF-1.8).
  propriedade_codigo text,

  data_entregue timestamptz,
  -- Preenchido na transição -> nao_realizado. Guarda a DESCRIÇÃO do motivo
  -- (não o id): renomear um motivo depois não deve reescrever o histórico.
  motivo_nao_entrega text,
  observacoes   text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_entregas_pedido on entregas (pedido_id);
-- A agenda e a trava de capacidade consultam por slot.
create index if not exists idx_entregas_slot
  on entregas (data_agendada, periodo)
  where status in ('agendada', 'em_rota');
create index if not exists idx_entregas_status on entregas (status);
create index if not exists idx_entregas_motorista on entregas (motorista_id);
create index if not exists idx_entregas_caminhao on entregas (caminhao_id);

-- ---------------------------------------------------------------------------
-- entrega_itens — QUANTO de cada produto vai nesta viagem
-- ---------------------------------------------------------------------------
-- ATENÇÃO ao que NÃO existe aqui: não há FK para itens_pedido.
--
-- A ingestão APAGA e RECRIA itens_pedido a cada 5 minutos (worker/ingest.ts),
-- então o id de um item é descartável — uma FK apontando para lá quebraria
-- sozinha no próximo tick. O vínculo é pelo CÓDIGO DO PRODUTO, que é estável.
--
-- Por isso também o UNIQUE (entrega_id, produto_codigo): as quantidades são
-- agregadas por produto. Isso resolve de brinde os pedidos que trazem o mesmo
-- produto em duas linhas.
create table if not exists entrega_itens (
  id             uuid primary key default gen_random_uuid(),
  entrega_id     uuid not null references entregas(id) on delete cascade,
  produto_codigo text not null,
  nome_produto   text,
  qtd            numeric not null check (qtd > 0),

  -- A separação vive AQUI, não mais no item do pedido: dois caminhões levando o
  -- mesmo pedido são duas conferências independentes.
  separado       boolean not null default false,
  separado_em    timestamptz,

  unique (entrega_id, produto_codigo)
);

create index if not exists idx_entrega_itens_entrega on entrega_itens (entrega_id);
create index if not exists idx_entrega_itens_produto on entrega_itens (produto_codigo);

-- ---------------------------------------------------------------------------
-- Auditoria: eventos_status passa a poder apontar para uma entrega
-- ---------------------------------------------------------------------------
-- pedido_id continua NOT NULL (sempre se sabe de qual pedido é a viagem), então
-- o histórico do pedido continua completo. entrega_id diz QUAL viagem mudou.
alter table eventos_status
  add column if not exists entrega_id uuid references entregas(id) on delete cascade;

create index if not exists idx_eventos_status_entrega
  on eventos_status (entrega_id);

-- ---------------------------------------------------------------------------
-- RLS — espelha exatamente o que já vale para pedidos/itens_pedido
-- (o backend usa service-role e bypassa; isto cobre acesso direto ao banco)
-- ---------------------------------------------------------------------------
alter table entregas      enable row level security;
alter table entrega_itens enable row level security;

drop policy if exists entregas_logistica_all on entregas;
create policy entregas_logistica_all on entregas
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

drop policy if exists entregas_select on entregas;
create policy entregas_select on entregas
  for select
  using (public.papel_atual() in ('logistica','vendedor','motorista','almoxarifado'));

drop policy if exists entrega_itens_logistica_all on entrega_itens;
create policy entrega_itens_logistica_all on entrega_itens
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

drop policy if exists entrega_itens_select on entrega_itens;
create policy entrega_itens_select on entrega_itens
  for select
  using (public.papel_atual() in ('logistica','vendedor','motorista','almoxarifado'));

-- Quem separa a mercadoria marca o item da entrega.
drop policy if exists entrega_itens_almoxarifado_update on entrega_itens;
create policy entrega_itens_almoxarifado_update on entrega_itens
  for update
  using (public.papel_atual() in ('logistica','almoxarifado'))
  with check (public.papel_atual() in ('logistica','almoxarifado'));
