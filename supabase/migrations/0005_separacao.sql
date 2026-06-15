-- 0005_separacao.sql
-- Fase 2 (RF-2.2): checklist de separação de mercadorias antes de liberar p/ rota.
-- Cada item do pedido ganha uma marca de "separado"; o pedido só pode ir para
-- 'em_rota' quando todos os itens estiverem separados (validado no backend).

-- Marca de separação por item.
alter table itens_pedido add column if not exists separado boolean not null default false;
alter table itens_pedido add column if not exists separado_em timestamptz;

-- Novo papel: líder de almoxarifado (responsável pela separação).
alter table profiles drop constraint if exists profiles_papel_check;
alter table profiles add constraint profiles_papel_check
  check (papel in ('logistica', 'vendedor', 'motorista', 'almoxarifado'));

-- Almoxarifado enxerga pedidos/itens/clientes/propriedades (leitura), junto aos
-- papéis já existentes. (O backend usa service-role; isto cobre acesso direto.)
drop policy if exists pedidos_vendedor_select on pedidos;
create policy pedidos_vendedor_select on pedidos
  for select using (public.papel_atual() in ('logistica','vendedor','motorista','almoxarifado'));

drop policy if exists itens_vendedor_select on itens_pedido;
create policy itens_vendedor_select on itens_pedido
  for select using (public.papel_atual() in ('logistica','vendedor','motorista','almoxarifado'));

drop policy if exists clientes_vendedor_select on clientes;
create policy clientes_vendedor_select on clientes
  for select using (public.papel_atual() in ('logistica','vendedor','motorista','almoxarifado'));

drop policy if exists propriedades_vendedor_select on propriedades;
create policy propriedades_vendedor_select on propriedades
  for select using (public.papel_atual() in ('logistica','vendedor','motorista','almoxarifado'));

-- Logística e almoxarifado podem atualizar a marca de separação dos itens.
drop policy if exists itens_almoxarifado_update on itens_pedido;
create policy itens_almoxarifado_update on itens_pedido
  for update using (public.papel_atual() in ('logistica','almoxarifado'))
  with check (public.papel_atual() in ('logistica','almoxarifado'));
