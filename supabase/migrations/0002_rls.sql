-- 0002_rls.sql
-- Row Level Security (RLS) para o Sistema de Logística (Pasto Bom).
--
-- Modelo de papéis (resolvido via tabela `profiles` pelo auth.uid()):
--   - logistica: leitura + escrita total nas tabelas de dados.
--   - vendedor : somente leitura de pedidos/itens/clientes/propriedades.
--   - motorista: leitura do próprio escopo (Fase 3 — política mínima por enquanto).
--
-- O backend usa a SERVICE ROLE KEY, que IGNORA RLS (bypass nativo do Postgres
-- para o papel `service_role`). Logo, o worker e a API server-side não são
-- afetados por estas políticas.

-- ---------------------------------------------------------------------------
-- Helper: papel do usuário atual a partir de profiles
-- ---------------------------------------------------------------------------
create or replace function public.papel_atual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.papel
  from public.profiles p
  where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Habilita RLS em todas as tabelas de dados
-- ---------------------------------------------------------------------------
alter table clientes           enable row level security;
alter table propriedades       enable row level security;
alter table pedidos            enable row level security;
alter table itens_pedido       enable row level security;
alter table motoristas         enable row level security;
alter table rotas              enable row level security;
alter table entregas           enable row level security;
alter table mensagens_whatsapp enable row level security;
alter table eventos_status     enable row level security;
alter table sync_state         enable row level security;
alter table profiles           enable row level security;

-- ===========================================================================
-- profiles: cada usuário lê o próprio perfil; logística lê todos.
-- ===========================================================================
drop policy if exists profiles_select_self on profiles;
create policy profiles_select_self on profiles
  for select
  using (id = auth.uid() or public.papel_atual() = 'logistica');

drop policy if exists profiles_logistica_all on profiles;
create policy profiles_logistica_all on profiles
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

-- ===========================================================================
-- pedidos / itens_pedido / clientes / propriedades
-- logística: leitura+escrita total; vendedor: somente leitura.
-- ===========================================================================

-- pedidos
drop policy if exists pedidos_logistica_all on pedidos;
create policy pedidos_logistica_all on pedidos
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

drop policy if exists pedidos_vendedor_select on pedidos;
create policy pedidos_vendedor_select on pedidos
  for select
  using (public.papel_atual() in ('logistica', 'vendedor', 'motorista'));

-- itens_pedido
drop policy if exists itens_logistica_all on itens_pedido;
create policy itens_logistica_all on itens_pedido
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

drop policy if exists itens_vendedor_select on itens_pedido;
create policy itens_vendedor_select on itens_pedido
  for select
  using (public.papel_atual() in ('logistica', 'vendedor', 'motorista'));

-- clientes
drop policy if exists clientes_logistica_all on clientes;
create policy clientes_logistica_all on clientes
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

drop policy if exists clientes_vendedor_select on clientes;
create policy clientes_vendedor_select on clientes
  for select
  using (public.papel_atual() in ('logistica', 'vendedor', 'motorista'));

-- propriedades
drop policy if exists propriedades_logistica_all on propriedades;
create policy propriedades_logistica_all on propriedades
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

drop policy if exists propriedades_vendedor_select on propriedades;
create policy propriedades_vendedor_select on propriedades
  for select
  using (public.papel_atual() in ('logistica', 'vendedor', 'motorista'));

-- ===========================================================================
-- eventos_status / mensagens_whatsapp: logística total; demais somente leitura.
-- ===========================================================================
drop policy if exists eventos_logistica_all on eventos_status;
create policy eventos_logistica_all on eventos_status
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

drop policy if exists eventos_select on eventos_status;
create policy eventos_select on eventos_status
  for select
  using (public.papel_atual() in ('logistica', 'vendedor', 'motorista'));

drop policy if exists mensagens_logistica_all on mensagens_whatsapp;
create policy mensagens_logistica_all on mensagens_whatsapp
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

drop policy if exists mensagens_select on mensagens_whatsapp;
create policy mensagens_select on mensagens_whatsapp
  for select
  using (public.papel_atual() = 'logistica');

-- ===========================================================================
-- motoristas / rotas / entregas (Fase 3 — políticas mínimas)
-- logística total; motorista lê o próprio escopo; vendedor sem acesso.
-- ===========================================================================
drop policy if exists motoristas_logistica_all on motoristas;
create policy motoristas_logistica_all on motoristas
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

drop policy if exists motoristas_self_select on motoristas;
create policy motoristas_self_select on motoristas
  for select
  using (public.papel_atual() = 'motorista' and id = auth.uid());

drop policy if exists rotas_logistica_all on rotas;
create policy rotas_logistica_all on rotas
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

drop policy if exists rotas_motorista_select on rotas;
create policy rotas_motorista_select on rotas
  for select
  using (public.papel_atual() = 'motorista' and motorista_id = auth.uid());

drop policy if exists entregas_logistica_all on entregas;
create policy entregas_logistica_all on entregas
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

drop policy if exists entregas_motorista_select on entregas;
create policy entregas_motorista_select on entregas
  for select
  using (public.papel_atual() = 'motorista' and motorista_id = auth.uid());

-- ===========================================================================
-- sync_state: somente logística (configuração sensível). Backend via service-role.
-- ===========================================================================
drop policy if exists sync_state_logistica_all on sync_state;
create policy sync_state_logistica_all on sync_state
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');
