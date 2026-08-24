-- 0020_limite_entregas.sql
-- LIMITE DE ENTREGAS POR CAMINHÃO POR DIA, com vigência por período.
--
-- POR QUÊ
-- ---------------------------------------------------------------------------
-- Pedido da Natália (documento "Logística inteligente", 08/2026), textual:
--
--   "Atualmente, o caminhão é limitado exclusivamente pela sua capacidade em
--    toneladas. Porém, mesmo sem atingir o limite de tonelagem, o caminhão pode
--    realizar mais de uma entrega no mesmo dia. Criar uma configuração que
--    permita definir a quantidade máxima de entregas/agendamentos por caminhão
--    por dia, sem eliminar ou alterar a regra de tonelagem. (...) Criar um setup
--    por período (...) Exemplo: Caminhão X -> período de 01/09 a 30/09 ->
--    máximo de 5 entregas por dia."
--
-- Tonelagem não é a única restrição real: cinco entregas leves em cidades
-- diferentes não cabem num dia, mesmo somando duas toneladas. As DUAS regras
-- passam a valer juntas.
--
-- POR QUE UMA TABELA, E NÃO UMA COLUNA EM `caminhoes`
-- ---------------------------------------------------------------------------
-- Porque ela pediu VIGÊNCIA: o limite muda com a safra. Uma coluna
-- `max_entregas_dia` em `caminhoes` responderia "quanto é hoje" e apagaria o
-- que valia em setembro. Esta é a primeira tabela com vigência do schema — não
-- havia nenhuma (nem feriado, nem parâmetro datado).
--
-- O QUE ELA NÃO FAZ
-- ---------------------------------------------------------------------------
-- Não revalida agendamento que já existe. Baixar o limite de 5 para 3 não
-- desmarca as 5 viagens de amanhã: o passado não se reescreve, e a logística
-- não pode descobrir por um erro de tela que o dia dela mudou. O limite vale
-- para o PRÓXIMO agendamento.
--
-- ADITIVA: tabela nova, ninguém lê. Pode ser aplicada antes do deploy sem
-- efeito nenhum. O deploy do código, porém, não pode vir antes dela — o
-- agendamento passaria a consultar tabela inexistente.
--
-- ROLLBACK: 0020_limite_entregas_rollback.sql

create table if not exists caminhao_limites (
  id           uuid primary key default gen_random_uuid(),
  caminhao_id  uuid not null references caminhoes(id) on delete cascade,

  -- Janela de vigência, INCLUSIVA nas duas pontas (01/09 a 30/09 = setembro
  -- inteiro, como ela escreveu). `valido_ate` nulo = vale indefinidamente,
  -- para o caso comum "deste mês em diante".
  valido_de    date not null,
  valido_ate   date,

  -- O teto pedido: entregas por DIA, não por período. O slot do sistema é
  -- dia x turno, então a contagem soma manhã + tarde do mesmo dia.
  max_entregas_dia integer not null check (max_entregas_dia > 0),

  observacoes  text,
  criado_por   uuid references auth.users(id),
  criado_em    timestamptz not null default now(),

  constraint caminhao_limites_janela_coerente
    check (valido_ate is null or valido_ate >= valido_de)
);

-- A consulta é sempre "qual limite vale para este caminhão nesta data".
create index if not exists idx_caminhao_limites_vigencia
  on caminhao_limites (caminhao_id, valido_de desc);

comment on table caminhao_limites is
  'Teto de entregas por dia de um caminhão, por janela de vigência. Soma-se à '
  'regra de tonelagem (capacidade_kg): as duas valem juntas. Não revalida '
  'agendamento já existente.';
comment on column caminhao_limites.valido_ate is
  'NULL = vigência aberta (deste dia em diante).';

-- Sobreposição de janelas do MESMO caminhão é barrada na rota, não aqui: um
-- constraint EXCLUDE com daterange exigiria a extensão btree_gist, e o ganho
-- não paga a dependência nova num banco compartilhado com produção.

-- ---------------------------------------------------------------------------
-- RLS (o backend usa service-role e bypassa; isto cobre acesso direto)
-- ---------------------------------------------------------------------------

alter table caminhao_limites enable row level security;

drop policy if exists caminhao_limites_logistica_all on caminhao_limites;
create policy caminhao_limites_logistica_all on caminhao_limites
  for all using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

-- Leitura ampla como em `caminhoes`: a tela de agendamento precisa avisar do
-- teto ANTES do clique, e quem agenda pode ser logística ou almoxarifado.
drop policy if exists caminhao_limites_select on caminhao_limites;
create policy caminhao_limites_select on caminhao_limites
  for select using (
    public.papel_atual() in ('logistica', 'vendedor', 'motorista', 'almoxarifado')
  );
