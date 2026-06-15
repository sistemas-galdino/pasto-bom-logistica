-- 0006_motorista.sql
-- Fase 3 — Motorista (enxuto): UM motorista atribuído por pedido.
-- A "rota do dia" do motorista = pedidos em_rota atribuídos a ele
-- (motorista_id = auth.uid()). Sem objeto `rotas`, sem sequência: as tabelas
-- stub motoristas/rotas/entregas ficam intactas para uma fase futura.

-- Coluna de atribuição. Referencia auth.users(id) — consistente com as policies
-- de 0002 (rotas/entregas) que assumem motorista_id = auth.uid().
alter table pedidos
  add column if not exists motorista_id uuid references auth.users(id);

create index if not exists idx_pedidos_motorista_id on pedidos (motorista_id);

-- ---------------------------------------------------------------------------
-- RLS (defesa-em-profundidade). O backend usa service-role e IGNORA RLS; o
-- frontend do motorista lê só pela API. Estas policies cobrem acesso direto.
--
-- É preciso REMOVER 'motorista' das policies amplas de leitura (0002/0005):
-- como as policies permissivas se somam por OR, manter o motorista na policy
-- ampla anularia a restrição estreita abaixo.
-- ---------------------------------------------------------------------------

drop policy if exists pedidos_vendedor_select on pedidos;
create policy pedidos_vendedor_select on pedidos
  for select using (public.papel_atual() in ('logistica','vendedor','almoxarifado'));

drop policy if exists pedidos_motorista_select on pedidos;
create policy pedidos_motorista_select on pedidos
  for select using (
    public.papel_atual() = 'motorista'
    and motorista_id = auth.uid()
    and status_logistico = 'em_rota'
  );

drop policy if exists itens_vendedor_select on itens_pedido;
create policy itens_vendedor_select on itens_pedido
  for select using (public.papel_atual() in ('logistica','vendedor','almoxarifado'));

drop policy if exists itens_motorista_select on itens_pedido;
create policy itens_motorista_select on itens_pedido
  for select using (
    public.papel_atual() = 'motorista'
    and exists (
      select 1 from pedidos p
      where p.id = itens_pedido.pedido_id
        and p.motorista_id = auth.uid()
        and p.status_logistico = 'em_rota'
    )
  );
