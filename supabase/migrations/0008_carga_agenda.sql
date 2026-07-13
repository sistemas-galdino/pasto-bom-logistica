-- 0008_carga_agenda.sql
-- Ajustes da reunião com a Pasto Bom em 25/06/2026.
--
--   Onda 1: o status 00028 ("Venda aguardando faturamento 2") sai do gatilho.
--   Onda 2: caminhões (capacidade de carga), peso por produto e período de entrega.
--
-- Sobre o peso: a API do Órix NÃO entrega peso utilizável — 91% dos produtos vêm
-- sem peso, e dos que têm, 71% trazem o placeholder `peso = 1`. Os produtos que de
-- fato pesam (ração, milho, semente) vêm com peso ZERO. A única fonte confiável é o
-- NOME do produto ("RACAO ... 40KG"). Daí a tabela `produtos_peso`: um parser
-- preenche o que dá (origem='auto') e a equipe digita o resto UMA vez (origem='manual').

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Entregas são planejadas por PERÍODO (manhã/tarde), não por horário —
-- decisão da Natália na reunião, para não pulverizar o calendário.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'periodo_entrega') then
    create type periodo_entrega as enum ('manha', 'tarde');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table if not exists caminhoes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  placa         text,
  capacidade_kg numeric not null check (capacidade_kg > 0),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Peso UNITÁRIO por produto, reaproveitado entre todos os pedidos.
create table if not exists produtos_peso (
  produto_codigo text primary key,
  nome_produto   text,
  peso_kg        numeric not null check (peso_kg >= 0),
  origem         text not null check (origem in ('auto', 'manual')),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references auth.users(id)
);

-- ---------------------------------------------------------------------------
-- Pedido: período + caminhão (ambos escolhidos no AGENDAMENTO)
-- ---------------------------------------------------------------------------

alter table pedidos add column if not exists periodo periodo_entrega;
alter table pedidos add column if not exists caminhao_id uuid references caminhoes(id);

-- A agenda consulta por (data, período); a trava de capacidade, por caminhão.
create index if not exists idx_pedidos_agenda
  on pedidos (data_agendada, periodo)
  where data_agendada is not null;

create index if not exists idx_pedidos_caminhao on pedidos (caminhao_id);

-- ---------------------------------------------------------------------------
-- RLS (o backend usa service-role e bypassa; isto cobre acesso direto)
-- ---------------------------------------------------------------------------

alter table caminhoes enable row level security;
alter table produtos_peso enable row level security;

drop policy if exists caminhoes_logistica_all on caminhoes;
create policy caminhoes_logistica_all on caminhoes
  for all using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

drop policy if exists caminhoes_select on caminhoes;
create policy caminhoes_select on caminhoes
  for select using (
    public.papel_atual() in ('logistica', 'vendedor', 'motorista', 'almoxarifado')
  );

-- Quem separa a mercadoria também pode corrigir o peso de um produto.
drop policy if exists produtos_peso_escrita on produtos_peso;
create policy produtos_peso_escrita on produtos_peso
  for all using (public.papel_atual() in ('logistica', 'almoxarifado'))
  with check (public.papel_atual() in ('logistica', 'almoxarifado'));

drop policy if exists produtos_peso_select on produtos_peso;
create policy produtos_peso_select on produtos_peso
  for select using (
    public.papel_atual() in ('logistica', 'vendedor', 'motorista', 'almoxarifado')
  );

-- ---------------------------------------------------------------------------
-- Onda 1 — gatilho de sincronização sem o 00028
-- ---------------------------------------------------------------------------

-- Na reunião a Natália mandou tirar o "dois" ("é outro processo interno da gente").
-- Sondagem da API confirmou: "2" não é status (é o código da empresa); o que ela
-- descreveu é o 00028 "Venda aguardando faturamento 2", que estava no gatilho.
-- Os status de oficina (00040/00042/00043/00044) já estavam fora.
update sync_state
   set valor = '["00041","00045","00027"]'::jsonb,
       atualizado_em = now()
 where chave = 'status_gatilho';

-- Descarta os pedidos que entraram só por causa do 00028 e que ninguém ainda tocou.
-- Ir para 'cancelada' NÃO dispara WhatsApp (templateDaTransicao: * -> cancelada = null).
with descartados as (
  update pedidos
     set status_logistico = 'cancelada',
         atualizado_em = now()
   where status_orix = '00028'
     and status_logistico = 'pendente'
  returning id
)
insert into eventos_status (pedido_id, de_status, para_status, ator)
select id, 'pendente'::status_logistico, 'cancelada'::status_logistico, 'sistema'::ator_evento
  from descartados;
