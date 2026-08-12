-- 0019_peso_na_viagem.sql
-- Congela na VIAGEM o peso unitário que valeu no dia do agendamento.
--
-- POR QUÊ (áudio da Natália, 12/08/2026)
-- ---------------------------------------------------------------------------
-- Até aqui o peso de uma entrega não era guardado em lugar nenhum: era
-- recalculado a cada leitura, multiplicando a quantidade pelo peso que
-- estivesse em `produtos_peso` NAQUELE momento.
--
-- Isso funciona enquanto o peso do produto é uma constante — e deixa de
-- funcionar no caso que ela levantou: a soja nunca vem com o mesmo peso, muda a
-- cada compra. No dia em que a equipe corrigisse a soja de 60 para 58 kg, TODAS
-- as viagens de soja já entregues passariam a exibir 58, inclusive as que de
-- fato saíram com 60. O histórico se reescrevia sozinho.
--
-- Com esta coluna, cada viagem carrega o peso da sua própria decisão.
-- `produtos_peso` continua existindo, mas com outro papel: guardar o ÚLTIMO
-- valor informado, para o sistema sugerir no próximo pedido.
--
-- NULL = viagem agendada antes desta migração. Continua caindo no
-- `produtos_peso`, exatamente como antes — não há backfill de propósito:
-- carimbar hoje o peso de ontem seria inventar um dado que ninguém conferiu.
--
-- Aditiva e nulável: o código anterior ignora a coluna, então a ordem entre
-- aplicar isto e subir o deploy não importa.

alter table entrega_itens
  add column if not exists peso_unit_kg numeric
  check (peso_unit_kg is null or peso_unit_kg >= 0);

comment on column entrega_itens.peso_unit_kg is
  'Peso unitário (kg) CONGELADO no agendamento desta viagem. NULL = viagem anterior à 0019: o peso cai no cadastro produtos_peso, como antes.';
