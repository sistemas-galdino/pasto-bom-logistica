-- 0024_produtos_estoque.sql
-- ESPELHO DE ESTOQUE DOS PRODUTOS DO ÓRIX — o alerta "você está mandando mais
-- do que tem".
--
-- POR QUÊ
-- ---------------------------------------------------------------------------
-- Pedido da Natália, reunião de 27/08/2026:
--
--   "a gente precisa ler a quantidade de produto... é a quantidade de produto
--    que vai me falar se eu tenho aquele produto para entregar para aquele
--    cliente ou não"
--
-- E ela foi explícita ao DESCARTAR os outros dois campos que a API entrega:
-- "não precisa ler se tá reservado ou não" (est_reservado) "nem a quantidade
-- disponível" (estoque_fisico).
--
-- A CONFERÊNCIA FOI FEITA CONTRA A API DE VERDADE (14/09/2026), e confirmou a
-- escolha dela — inclusive contra a minha dúvida:
--
--   * 15.418 produtos no cadastro, 9.759 ativos.
--   * `quantidade` é EXATAMENTE a soma de deposito_1..deposito_5 nos 9.759
--     ativos, sem uma exceção. É o estoque de verdade, somando os depósitos.
--   * `estoque_fisico` é MAIOR que `quantidade` em 61% dos ativos, e às vezes
--     por muito (produto 00028: quantidade 14, estoque_fisico 710). Não é
--     estoque atual — usá-lo faria o alerta calar justamente quando devia falar.
--   * Dos 632 produtos que a operação REALMENTE entrega (distintos em
--     itens_pedido), 100% estão no /Produtos e 86% têm quantidade > 0.
--
-- Ou seja: o alerta tem dado para funcionar. Não é o caso da 0008, em que 91%
-- dos produtos vinham sem peso pela API.
--
-- POR QUE UMA TABELA NOVA, E NÃO COLUNAS EM `produtos_peso`
-- ---------------------------------------------------------------------------
-- `produtos_peso` (0008) é EDITADA POR HUMANO: tem `origem 'auto'|'manual'` e
-- `atualizado_por`, e a tela de agendar pede confirmação do peso manual. Estoque
-- só vem do ERP e é reescrito a cada ciclo. Misturar as duas faria o upsert do
-- worker disputar linha com a edição da equipe — e um dia o peso conferido à mão
-- viraria null porque o produto sumiu de uma página do Órix.
--
-- SEM FK para `produtos_peso`: são dois espelhos independentes do mesmo ERP, e
-- um não pode derrubar o outro.
--
-- `quantidade` É NUMERIC E PODE SER NEGATIVA. Não há check de >= 0, e isso é
-- metade do pedido dela — estoque negativo é justamente o caso que a operação
-- precisa ver. Há 1 produto negativo entre os 632 entregues hoje.
--
-- ADITIVA: tabela nova, ninguém lê. Pode ser aplicada antes do deploy sem efeito
-- nenhum. O deploy não pode vir antes dela: o worker e GET /api/estoque passam a
-- consultá-la.
--
-- ROLLBACK: 0024_produtos_estoque_rollback.sql

create table if not exists produtos_estoque (
  -- O código do Órix vem com zeros à esquerda ('00028') e é assim que ele
  -- aparece em itens_pedido. Guardamos exatamente como veio — normalizar aqui
  -- quebraria o join com o pedido.
  produto_codigo text primary key,
  nome_produto   text,

  -- A soma dos cinco depósitos, conferida contra a API. PODE SER NEGATIVA.
  quantidade     numeric,

  unidade        text,
  -- 'S'/'N' do Órix já normalizado pelo worker.
  ativo          boolean not null default true,

  -- Quando ESTE espelho leu. É o que a tela usa para dizer "atualizado há 2 h"
  -- — sem a idade do dado, o alerta vira palpite.
  atualizado_em  timestamptz not null default now()
);

-- A consulta é sempre "o estoque destes N códigos", por PK. Não há índice
-- adicional de propósito: nome não é buscado (quem busca produto usa o pedido).

comment on table produtos_estoque is
  'Espelho do estoque do Órix (GET /Produtos). `quantidade` = soma dos cinco '
  'depósitos, conferido contra a API em 14/09/2026. Alimenta um ALERTA no '
  'agendamento, nunca um bloqueio. Ausência da linha = "não sei", nunca zero.';
comment on column produtos_estoque.quantidade is
  'Pode ser NEGATIVA — estoque negativo é o caso que a operação precisa ver.';
comment on column produtos_estoque.atualizado_em is
  'Quando este espelho leu. A tela mostra a idade do dado junto do número.';

-- ---------------------------------------------------------------------------
-- RLS (o backend usa service-role e bypassa; isto cobre acesso direto)
-- ---------------------------------------------------------------------------

alter table produtos_estoque enable row level security;

drop policy if exists produtos_estoque_logistica_all on produtos_estoque;
create policy produtos_estoque_logistica_all on produtos_estoque
  for all
  using (public.papel_atual() = 'logistica')
  with check (public.papel_atual() = 'logistica');

-- Leitura para os quatro papéis de equipe: quem agenda pode ser logística ou
-- almoxarifado, e o vendedor consulta antes de prometer ao cliente.
drop policy if exists produtos_estoque_select on produtos_estoque;
create policy produtos_estoque_select on produtos_estoque
  for select
  using (public.papel_atual() in ('logistica','vendedor','motorista','almoxarifado'));
