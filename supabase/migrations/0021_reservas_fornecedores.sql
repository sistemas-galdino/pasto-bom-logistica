-- 0021_reservas_fornecedores.sql
-- CARD AVULSO / RESERVA DE CAMINHÃO — pedido do Johnny (áudios de 08/2026).
--
-- POR QUÊ
-- ---------------------------------------------------------------------------
-- "A possibilidade de eu criar um card para poder agendar. Seria para eu colocar
--  oficina, seria para eu reservar coleta de adubo, para reservar o caminhão
--  para fazer alguma outra coisa. Porque eu tô vendo aqui que A ÚNICA COISA QUE
--  BLOQUEIA A GENTE DE AGENDAR É O CAMINHÃO. Então se eu esquecer pode ser que
--  eu deixe essas agendas vagas e aí uma hora ou outra eu esqueço de agendar
--  algum cliente porque não tem cliente para agendar e a gente perde, tem que
--  refazer o agendamento."
--
-- O propósito da reserva é OCUPAR o caminhão, não entregar algo. Sem ela, o
-- caminhão que vai para a oficina aparece livre na agenda, e o dia se perde.
--
-- Conteúdo em texto livre (áudios 2 e 3): no lugar do nome do cliente, o
-- SERVIÇO; a cidade digitada; os produtos digitados. E o atalho do áudio 5 da
-- Natália: quando for fornecedor, puxar do Órix, que já traz a cidade.
--
-- POR QUE UMA TABELA NOVA, E NÃO `entregas` COM pedido_id NULO
-- ---------------------------------------------------------------------------
-- `entregas.pedido_id` é NOT NULL e sustenta o caminho que a logística usa todo
-- dia. O dano de tornar isso nulável não é "guarda de null esquecida": em
-- services/entregas.ts a listagem monta `idsPedido` e alimenta um
-- `.in('id', idsPedido)` — um null no array vira `id=in.(null)`, uuid inválido,
-- e A LISTAGEM DE TODAS AS ENTREGAS CAI por causa de um card avulso. Mesma
-- classe de falha em worker/reconciliar.ts, onde o null entra no Set que protege
-- pedidos com viagem ativa de serem descartados do quadro. E `eventos_status`
-- também tem `pedido_id` NOT NULL.
--
-- A reserva tem UMA coisa em comum com a entrega: ocupa o slot. Então o encontro
-- entre as duas acontece num lugar único, services/carga.ts ocupacaoDoSlot().
-- Bug de reserva = reserva quebrada, não quadro quebrado.
--
-- DECISÕES (com o David, 24/08/2026)
-- ---------------------------------------------------------------------------
-- 1. A reserva NÃO consome a cota do teto de entregas/dia da 0020. O teto é de
--    entregas a CLIENTE; a reserva bloqueia por outro caminho (indisponibilidade
--    e tonelagem). Um caminhão com limite de 5 e uma oficina marcada ainda leva
--    5 entregas.
-- 2. `bloqueia_caminhao` nasce TRUE, com caixa para soltar: oficina protege o
--    turno inteiro; coleta de adubo divide o caminhão com uma entrega.
--
-- ADITIVA: duas tabelas novas que ninguém lê ainda.
-- ORDEM: migration ANTES do deploy (como a 0020) — o código passa a consultar
-- `reservas` no caminho do agendamento.
--
-- ROLLBACK: 0021_reservas_fornecedores_rollback.sql

-- ---------------------------------------------------------------------------
-- fornecedores — espelho SOMENTE LEITURA do cadastro do Órix
-- ---------------------------------------------------------------------------
-- Mesmo papel e mesmo formato de `clientes` (0001): a ingestão escreve, o
-- sistema lê. A API do Órix é somente leitura — nada aqui volta para lá.
-- Serve a um caso só: "puxar o fornecedor já vai trazer a cidade" (áudio 5).
-- Colunas espelham GET /Fornecedores do manual da API (v1.13).
create table if not exists fornecedores (
  codigo        text primary key,
  nome          text,
  fantasia      text,
  tipo          text,
  cpf_cnpj      text,
  endereco      text,
  numero        text,
  bairro        text,
  cidade        text,
  cep           text,
  cod_municipio text,
  uf            text,
  telefone      text,
  celular       text,
  email         text,
  -- 'S'/'N' do Órix, normalizado no worker. Default true: fornecedor sem o
  -- campo preenchido é tratado como ativo (é o que a lista devolve na prática).
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now()
);

-- O autocomplete busca por nome; a lista útil é só a dos ativos.
create index if not exists idx_fornecedores_nome on fornecedores (nome);
create index if not exists idx_fornecedores_ativos on fornecedores (nome) where ativo;

comment on table fornecedores is
  'Espelho somente-leitura do cadastro de fornecedores do Órix (GET '
  '/Fornecedores). Escrita só pelo worker. Serve ao autocomplete da reserva de '
  'caminhão, que precisa da cidade.';

-- ---------------------------------------------------------------------------
-- Enum do status da reserva
-- ---------------------------------------------------------------------------
-- Deliberadamente NÃO reusa `status_entrega`: a reserva não vai em rota, não é
-- entregue, não é separada e não manda WhatsApp. Compartilhar o enum convidaria
-- a confundir os dois objetos para sempre — mesmo raciocínio da 0013.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'status_reserva') then
    create type status_reserva as enum ('ativa', 'cancelada');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- reservas — o card avulso
-- ---------------------------------------------------------------------------
create table if not exists reservas (
  id            uuid primary key default gen_random_uuid(),
  status        status_reserva not null default 'ativa',

  -- No lugar do nome do cliente: o SERVIÇO, em texto livre ("oficina",
  -- "coleta de adubo"). É o título do card.
  servico       text not null check (length(btrim(servico)) > 0),

  -- Quando é fornecedor, a cidade vem da lista do Órix; quando não é, é
  -- digitada. Guardamos SEMPRE a cidade em texto, mesmo com fornecedor
  -- vinculado: se o cadastro do Órix mudar (ou o fornecedor sair da lista), a
  -- reserva de ontem não pode se reescrever. Mesmo princípio do peso congelado
  -- na viagem (0019) e do motivo_nao_entrega em texto (0013).
  fornecedor_codigo text references fornecedores(codigo),
  cidade        text,

  -- Produtos em texto livre: não há pedido, não há item, não há saldo.
  produtos      text,

  -- Slot = data × período, o mesmo domínio das entregas.
  -- Diferente de `entregas`, aqui `periodo` é NOT NULL: uma reserva que não diz
  -- o turno não bloqueia nada, e o legado tolerado na 0013 não existe aqui.
  data_agendada date not null,
  periodo       periodo_entrega not null,

  -- O caminhão é o PROPÓSITO da reserva, então é obrigatório.
  caminhao_id   uuid not null references caminhoes(id),
  -- O motorista é opcional: dá para mandar o caminhão para a oficina sem
  -- decidir quem leva. Quando informado, ele fica ocupado no slot igual a uma
  -- viagem (não leva dois caminhões no mesmo turno).
  motorista_id  uuid,

  -- Peso OPCIONAL. Preenchido, conta contra a tonelagem do caminhão no slot;
  -- vazio, a reserva ocupa o par caminhão+motorista mas não consome tonelagem.
  peso_previsto_kg numeric
    check (peso_previsto_kg is null or peso_previsto_kg >= 0),

  -- Caminhão INDISPONÍVEL no slot (o caso da oficina): nenhuma entrega de
  -- cliente pode ser agendada nele, mesmo que a carga caibesse. Default true
  -- porque é o pedido literal do Johnny — "reservar o caminhão". Desmarcado, a
  -- reserva divide o caminhão com entregas normais e só consome o peso (o caso
  -- da coleta de adubo, em que o caminhão volta carregado e ainda passa num
  -- cliente).
  bloqueia_caminhao boolean not null default true,

  observacoes   text,
  criado_por    uuid references auth.users(id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Índices espelham os de `entregas` (0013): a agenda e a trava de capacidade
-- consultam por slot; o parcial só carrega o que de fato ocupa.
create index if not exists idx_reservas_slot
  on reservas (data_agendada, periodo)
  where status = 'ativa';
create index if not exists idx_reservas_caminhao   on reservas (caminhao_id);
create index if not exists idx_reservas_motorista  on reservas (motorista_id);
create index if not exists idx_reservas_fornecedor on reservas (fornecedor_codigo);

comment on table reservas is
  'Card avulso da logística: reserva um caminhão num slot (data+período) sem que '
  'exista pedido. Encontra as entregas em um ponto só: services/carga.ts '
  'ocupacaoDoSlot(). NÃO consome a cota de caminhao_limites (0020).';
comment on column reservas.peso_previsto_kg is
  'Opcional. NULL = a reserva ocupa o par caminhão+motorista do slot mas não '
  'consome tonelagem.';
comment on column reservas.bloqueia_caminhao is
  'true = nenhuma entrega de cliente entra neste caminhão/slot (oficina). '
  'false = divide o caminhão e só desconta o peso previsto (coleta).';
comment on column reservas.cidade is
  'Congelada em texto de propósito, mesmo com fornecedor_codigo preenchido: '
  'mudança no cadastro do Órix não pode reescrever a reserva de ontem.';

-- ---------------------------------------------------------------------------
-- RLS — espelha o padrão de entregas (0013) e clientes (0002)
-- (o backend usa service-role e bypassa; isto cobre acesso direto ao banco)
-- ---------------------------------------------------------------------------
alter table reservas     enable row level security;
alter table fornecedores enable row level security;

drop policy if exists reservas_logistica_all on reservas;
create policy reservas_logistica_all on reservas
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

-- Motorista incluído por simetria com `entregas`: ele vê (só leitura) a reserva
-- em que é o motorista, na Rota do Dia.
drop policy if exists reservas_select on reservas;
create policy reservas_select on reservas
  for select
  using (public.papel_atual() in ('logistica','vendedor','motorista','almoxarifado'));

-- O fornecedor é cadastro do Órix: escrita é da ingestão (service-role).
drop policy if exists fornecedores_logistica_all on fornecedores;
create policy fornecedores_logistica_all on fornecedores
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

-- Motorista fica de fora: a reserva já carrega a cidade em texto, então nenhuma
-- tela dele precisa consultar o cadastro de fornecedores.
drop policy if exists fornecedores_select on fornecedores;
create policy fornecedores_select on fornecedores
  for select
  using (public.papel_atual() in ('logistica','vendedor','almoxarifado'));
