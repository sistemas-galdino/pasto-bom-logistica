-- 0001_schema.sql
-- Sistema de Logística Inteligente (Pasto Bom) — Fase 1
-- Esquema base: extensões, enums, tabelas e índices.
-- Idempotente onde possível (IF NOT EXISTS / DO blocks).

-- ---------------------------------------------------------------------------
-- Extensões
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'status_logistico') then
    create type status_logistico as enum (
      'pendente', 'agendada', 'em_rota', 'entregue', 'cancelada'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ator_evento') then
    create type ator_evento as enum ('sistema', 'usuario');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'status_envio_whatsapp') then
    create type status_envio_whatsapp as enum ('pendente', 'enviada', 'falha');
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

-- clientes (PK = código Órix)
create table if not exists clientes (
  codigo        text primary key,
  nome          text,
  fantasia      text,
  celular       text,
  telefone      text,
  email         text,
  endereco      text,
  bairro        text,
  cidade        text,
  uf            text,
  cpf_cnpj      text,
  latitude      text,
  longitude     text,
  atualizado_em timestamptz not null default now()
);

-- propriedades (PK = código Órix)
create table if not exists propriedades (
  codigo         text primary key,
  cliente_codigo text not null,
  nome           text,
  endereco       text,
  bairro         text,
  cidade         text,
  uf             text,
  cep            text,
  latitude       text,
  longitude      text,
  atualizado_em  timestamptz not null default now()
);
create index if not exists idx_propriedades_cliente_codigo
  on propriedades (cliente_codigo);

-- pedidos
create table if not exists pedidos (
  id                uuid primary key default gen_random_uuid(),
  orix_id_pedido    text unique not null,
  orix_numero       text,
  empresa           int,
  cliente_codigo    text,
  cliente_nome      text,
  cidade_cliente    text,
  vendedor_codigo   text,
  vendedor_nome     text,
  propriedade_codigo text,
  valor_total       numeric,
  data_pedido       date,
  status_orix       text,
  status_orix_nome  text,
  status_logistico  status_logistico not null default 'pendente',
  data_agendada     date,
  data_entregue     timestamptz,
  rota_id           uuid,
  observacoes       text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index if not exists idx_pedidos_status_logistico
  on pedidos (status_logistico);
create index if not exists idx_pedidos_cliente_codigo
  on pedidos (cliente_codigo);

-- itens_pedido
create table if not exists itens_pedido (
  id            uuid primary key default gen_random_uuid(),
  pedido_id     uuid not null references pedidos(id) on delete cascade,
  produto_codigo text,
  nome_produto  text,
  qtd           numeric,
  valor_unit    numeric,
  total         numeric
);
create index if not exists idx_itens_pedido_pedido_id
  on itens_pedido (pedido_id);

-- motoristas (Fase 3)
create table if not exists motoristas (
  id       uuid primary key default gen_random_uuid(),
  nome     text,
  telefone text,
  ativo    boolean default true
);

-- rotas (Fase 3)
create table if not exists rotas (
  id           uuid primary key default gen_random_uuid(),
  data         date,
  motorista_id uuid references motoristas(id),
  status       text
);

-- entregas
create table if not exists entregas (
  id                 uuid primary key default gen_random_uuid(),
  pedido_id          uuid references pedidos(id),
  motorista_id       uuid,
  propriedade_codigo text,
  data_prevista      date,
  data_entregue      timestamptz,
  observacoes        text
);

-- mensagens_whatsapp
create table if not exists mensagens_whatsapp (
  id                uuid primary key default gen_random_uuid(),
  pedido_id         uuid references pedidos(id),
  cliente_codigo    text,
  numero            text,
  template          text,
  corpo             text,
  status_envio      status_envio_whatsapp default 'pendente',
  provider_response jsonb,
  enviado_em        timestamptz,
  erro              text,
  criado_em         timestamptz not null default now()
);
create index if not exists idx_mensagens_whatsapp_pedido_id
  on mensagens_whatsapp (pedido_id);

-- eventos_status (auditoria das transições)
create table if not exists eventos_status (
  id           uuid primary key default gen_random_uuid(),
  pedido_id    uuid not null references pedidos(id),
  de_status    status_logistico,
  para_status  status_logistico not null,
  ator         ator_evento not null,
  ator_user_id uuid,
  criado_em    timestamptz not null default now()
);
create index if not exists idx_eventos_status_pedido_id
  on eventos_status (pedido_id);

-- sync_state (configuração e cursores do worker)
create table if not exists sync_state (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_em timestamptz not null default now()
);

-- profiles (papel do usuário, ligado a auth.users)
create table if not exists profiles (
  id    uuid primary key references auth.users(id),
  papel text not null check (papel in ('logistica', 'vendedor', 'motorista')),
  nome  text
);
