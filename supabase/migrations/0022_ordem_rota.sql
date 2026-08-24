-- 0022_ordem_rota.sql
-- ORDEM DAS PARADAS DA ROTA DO MOTORISTA — item 11 do documento da Natália.
--
-- POR QUÊ
-- ---------------------------------------------------------------------------
-- Pedido dela: "informar qual será o próximo cliente/entrega após a conclusão
-- da entrega atual". Hoje o motorista abre a Rota do Dia e vê uma lista sem
-- ordem nenhuma — quem decide o caminho é ele, de cabeça, e a logística não
-- tem como saber em que ponto da rota ele está.
--
-- POR QUE UMA COLUNA, E NÃO A TABELA `rotas`
-- ---------------------------------------------------------------------------
-- A `rotas` da 0001 é um stub que a 0006 declara explicitamente não usar. Ela
-- pressupõe um objeto "rota" com ciclo próprio, e não é isso que o pedido
-- exige: a ordem é um atributo da VIAGEM dentro do dia, e o dono do dado é o
-- motorista que acabou de descarregar. Uma coluna nulável em `entregas` é o
-- menor lugar onde essa informação cabe inteira.
--
-- NULÁVEL de propósito: entrega sem ordem é o estado normal (ninguém sequenciou
-- ainda), não dado faltando. A tela ordena as sem ordem depois das ordenadas.
--
-- Não há UNIQUE (data, caminhão, ordem): dois motoristas sequenciando o mesmo
-- dia em paralelo tomariam erro de banco no meio da rota, na estrada, sem ter o
-- que fazer com o erro. Empate de ordem é desempatado na leitura — ordem
-- duplicada é feia, rota travada é pior.
--
-- ADITIVA: coluna nova, nulável, que ninguém lê até o deploy.
-- ORDEM: migration antes do deploy (como a 0020 e a 0021).
--
-- ROLLBACK: 0022_ordem_rota_rollback.sql

alter table entregas
  add column if not exists ordem_rota integer
    check (ordem_rota is null or ordem_rota > 0);

comment on column entregas.ordem_rota is
  'Ordem da parada dentro do dia do motorista (1 = primeira). NULL = ainda não '
  'sequenciada. Informada pelo motorista ao concluir a entrega anterior; a '
  'logística lê na tela de Rota. Sem unicidade de propósito: empate é '
  'desempatado na leitura, para não travar a rota na estrada.';

-- A consulta é sempre "as viagens deste motorista neste dia, em ordem".
create index if not exists idx_entregas_ordem_rota
  on entregas (motorista_id, data_agendada, ordem_rota)
  where status in ('agendada', 'em_rota');
