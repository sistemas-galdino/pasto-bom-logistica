-- 0023_rotas_cidade.sql
-- ROTA DE CIDADE — o letreiro de "toda terça eu vou para Cabo Verde".
--
-- POR QUÊ
-- ---------------------------------------------------------------------------
-- Pedido da Natália no documento de 08/2026 e explicado na reunião de 27/08,
-- com as palavras dela:
--
--   "toda terça-feira eu vou para Cabo Verde na parte da manhã"
--   "a partir de hoje, todas as terças, todas as quintas, de manhã"
--   "na hora que ele vier aqui na agenda do caminhão, vai mostrar para ele"
--   "pode pôr até de outra cor"
--
-- É um AVISO NO CALENDÁRIO, e essa é a decisão que manda em tudo o que segue:
-- a rota de cidade NÃO reserva caminhão, NÃO ocupa o dia, NÃO consome o teto de
-- entregas e NÃO impede agendar outra cidade no mesmo período. Ela existe para
-- quem olha a agenda saber que aquele dia já tem um destino combinado — o
-- vendedor inclusive, que é o motivo de a leitura ser ampla.
--
-- Se um dia ela virar ocupação de verdade, isto aqui NÃO é o lugar: seria uma
-- reserva (tabela `reservas`, que já ocupa caminhão e já passa por carga.ts).
--
-- UMA LINHA POR CONFIGURAÇÃO, COM ARRAYS
-- ---------------------------------------------------------------------------
-- E não uma linha por (cidade × dia × período). Ela descreveu um objeto só:
-- "todas as terças, todas as quintas, de manhã". Explodir em quatro linhas
-- faria a tela listar quatro "Cabo Verde", e remover a rota viraria remover
-- quatro coisas; reagrupá-las depois pediria um `grupo_id`, que é esta linha de
-- volta com um nome pior.
--
-- A NUMERAÇÃO DOS DIAS é 0 = domingo … 6 = sábado. Não é escolha nova: é a de
-- `Date#getDay()`, a do `DIAS_CURTOS` do frontend e a de `extract(dow)` do
-- Postgres. Três convenções que já existem no sistema concordam — inventar uma
-- quarta seria criar o bug de "a terça aparece na segunda" de graça.
--
-- POR QUE `periodos` É ARRAY DO ENUM, E NÃO UM TERCEIRO VALOR 'ambos'
-- ---------------------------------------------------------------------------
-- Dia inteiro = `{manha,tarde}`. Acrescentar 'ambos' ao enum `periodo_entrega`
-- obrigaria agenda, separação, reservas e rota do motorista a tratarem um valor
-- que não é um turno — e o enum é compartilhado com `entregas` e `reservas`,
-- onde 'ambos' não significa nada.
--
-- SEM TABELA DE CIDADES E SEM `unaccent`. Comparar grafias ("CABO VERDE" e
-- "Cabo Verde") é regra pura, testada, em packages/shared. Extensão nova num
-- Postgres compartilhado com produção foi recusada aqui pelo mesmo critério que
-- recusou `btree_gist` na 0020.
--
-- ADITIVA: tabela nova, ninguém lê ainda. Pode ser aplicada antes do deploy sem
-- efeito nenhum. O deploy, porém, NÃO pode vir antes dela: GET /api/agenda
-- passa a consultar esta tabela.
--
-- ROLLBACK: 0023_rotas_cidade_rollback.sql

create table if not exists rotas_cidade (
  id           uuid primary key default gen_random_uuid(),

  -- Texto livre, como `reservas.cidade`. O espelho do Órix já tem as três
  -- grafias misturadas; alimentar este campo a partir dele propagaria para
  -- dentro da configuração exatamente a inconsistência que estamos evitando.
  -- A grafia digitada é a que o chip mostra — reescrever "são joão" para
  -- "São João" erra em nome composto e em "del-Rei".
  cidade       text not null check (length(btrim(cidade)) > 0),

  -- 0 = domingo … 6 = sábado (Date#getDay / extract(dow)).
  dias_semana  smallint[] not null
    check (
      array_length(dias_semana, 1) between 1 and 7
      and dias_semana <@ array[0,1,2,3,4,5,6]::smallint[]
    ),

  -- Dia inteiro = {manha,tarde}. Ver o comentário acima sobre 'ambos'.
  periodos     periodo_entrega[] not null
    check (array_length(periodos, 1) between 1 and 2),

  -- Vigência INCLUSIVA nas duas pontas, igual à 0020 — foi o que ela pediu
  -- apontando para a tela de limites: "pode ser dessa forma aqui mesmo, a mesma
  -- regra". `valido_ate` nulo = "a partir de hoje", o caso que ela descreveu.
  valido_de    date not null,
  valido_ate   date,

  -- Pausar sem perder a configuração: a rota de safra volta no ano que vem, e
  -- apagar obrigaria a redigitar dias, períodos e vigência.
  ativo        boolean not null default true,

  observacoes  text,
  criado_por   uuid references auth.users(id),
  criado_em    timestamptz not null default now(),

  constraint rotas_cidade_janela_coerente
    check (valido_ate is null or valido_ate >= valido_de)
);

-- A consulta é sempre "todas as ativas" (a janela é recortada pela regra pura,
-- em TS, para a borda inclusiva existir escrita num lugar só).
create index if not exists idx_rotas_cidade_ativas
  on rotas_cidade (ativo, valido_de desc);

comment on table rotas_cidade is
  'Aviso de calendário: "toda terça, Cabo Verde, de manhã". NÃO reserva '
  'caminhão, não ocupa o dia, não consome o teto de entregas e não impede '
  'agendar outra cidade no mesmo período. Uma linha por configuração.';
comment on column rotas_cidade.dias_semana is
  '0 = domingo … 6 = sábado (Date#getDay / extract(dow)).';
comment on column rotas_cidade.periodos is
  'Dia inteiro = {manha,tarde}. Não existe valor "ambos" no enum.';
comment on column rotas_cidade.valido_ate is
  'NULL = vigência aberta (deste dia em diante).';

-- Duplicata (mesma cidade + dia + período + vigência cruzada) é barrada na
-- rota, e não aqui, pelo mesmo motivo da 0020: o constraint exigiria btree_gist
-- para cruzar daterange com arrays. E o dano aqui é menor que o da 0020 — lá a
-- sobreposição criava AMBIGUIDADE (qual teto vale?), aqui cria só repetição
-- visual, que a regra pura ainda deduplica na leitura.

-- ---------------------------------------------------------------------------
-- RLS (o backend usa service-role e bypassa; isto cobre acesso direto)
-- ---------------------------------------------------------------------------

alter table rotas_cidade enable row level security;

drop policy if exists rotas_cidade_logistica_all on rotas_cidade;
create policy rotas_cidade_logistica_all on rotas_cidade
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

-- Leitura para os quatro papéis: o VENDEDOR é o motivo de a feature existir
-- ("que aí mostra também pros vendedores"), e o motorista entra por simetria
-- com `reservas`.
drop policy if exists rotas_cidade_select on rotas_cidade;
create policy rotas_cidade_select on rotas_cidade
  for select
  using (public.papel_atual() in ('logistica','vendedor','motorista','almoxarifado'));
