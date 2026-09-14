-- 0024_produtos_estoque_rollback.sql
-- Desfaz a 0024.
--
-- O QUE SE PERDE: nada que não seja reconstruível. A tabela inteira é um
-- ESPELHO do Órix, refeito do zero por
-- `apps/backend/src/scripts/sincronizar-estoque.ts` em um ciclo. Não há nenhum
-- dado digitado por pessoa aqui — ao contrário de `produtos_peso` (0008), que
-- tem peso conferido à mão e NÃO pode ser derrubada assim.
--
-- O QUE NÃO SE PERDE: nada de operação. O estoque alimenta um ALERTA no
-- agendamento e nada mais — não bloqueia, não é referenciado por entrega,
-- pedido, reserva ou item, e nenhuma viagem muda de estado por causa disto.
--
-- ATENÇÃO: a versão atual do sistema LÊ `produtos_estoque` em GET /api/estoque
-- e ESCREVE nela pelo worker de produtos. A leitura degrada para "não sei" (o
-- alerta simplesmente não aparece), mas o worker vai encher o log de erro a cada
-- ciclo. Rode este rollback junto com o deploy de uma versão anterior, ou pelo
-- menos desligue o worker com ESTOQUE_CRON inválido.

drop table if exists produtos_estoque cascade;
