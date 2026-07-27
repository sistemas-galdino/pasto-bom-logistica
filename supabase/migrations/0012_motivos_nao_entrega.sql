-- 0012_motivos_nao_entrega.sql
-- Motivos de não entrega cadastráveis (reunião de 16/07/2026).
--
-- Antes, os motivos eram cinco strings fixas no NaoRealizadoModal e o usuário
-- ainda podia digitar texto livre. O Guto levantou o problema: "cada um cria um
-- motivo e depois não consegue filtrar os motivos". A decisão foi restringir o
-- CADASTRO ao admin e a ESCOLHA a essa lista.
--
-- pedidos.motivo_nao_entrega continua sendo TEXTO (a descrição no momento do
-- registro), de propósito: renomear um motivo aqui não deve reescrever o
-- histórico do que já foi registrado lá atrás.

create table if not exists motivos_nao_entrega (
  id        uuid primary key default gen_random_uuid(),
  descricao text        not null,
  ativo     boolean     not null default true,
  -- Ordem de exibição na lista; empate desempata por descrição.
  ordem     int         not null default 0,
  criado_em timestamptz not null default now()
);

-- Sem motivo duplicado — é o que garante que o filtro por motivo signifique
-- alguma coisa. Case-insensitive: "Cliente ausente" e "cliente ausente" são o
-- mesmo motivo para quem lê o relatório.
create unique index if not exists idx_motivos_descricao_unica
  on motivos_nao_entrega (lower(descricao));

-- A lista da tela é sempre "ativos, na ordem".
create index if not exists idx_motivos_ativos
  on motivos_nao_entrega (ordem, descricao)
  where ativo;

-- ---------------------------------------------------------------------------
-- RLS: todo mundo autenticado LÊ (o motorista precisa da lista para registrar
-- a não entrega); só a logística ESCREVE.
-- ---------------------------------------------------------------------------
alter table motivos_nao_entrega enable row level security;

drop policy if exists motivos_select_todos on motivos_nao_entrega;
create policy motivos_select_todos on motivos_nao_entrega
  for select
  using (auth.uid() is not null);

drop policy if exists motivos_logistica_all on motivos_nao_entrega;
create policy motivos_logistica_all on motivos_nao_entrega
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

-- ---------------------------------------------------------------------------
-- Seed: exatamente os cinco que estavam fixos no código, para a tela não nascer
-- vazia. A equipe edita/desativa/acrescenta pela tela de Motivos.
-- ---------------------------------------------------------------------------
insert into motivos_nao_entrega (descricao, ordem)
values
  ('Cliente ausente',          1),
  ('Porteira fechada',         2),
  ('Estrada intransitável',    3),
  ('Endereço não encontrado',  4),
  ('Cliente recusou',          5)
on conflict do nothing;
