-- 0012_motivos_nao_entrega_rollback.sql
-- Desfaz a 0012_motivos_nao_entrega.sql.
--
-- O QUE SE PERDE: os motivos cadastrados pela equipe além dos cinco do seed.
-- Exporte antes, se importar:
--
--   select descricao, ativo, ordem from motivos_nao_entrega order by ordem;
--
-- O QUE NÃO SE PERDE: o histórico. pedidos.motivo_nao_entrega guarda a
-- DESCRIÇÃO em texto, não uma FK — apagar a tabela não apaga o motivo de
-- nenhuma entrega já registrada.
--
-- ATENÇÃO: o frontend da Onda 1 espera esta tabela. Sem ela, a tela de Motivos
-- e o registro de "entrega não realizada" param de funcionar. Só rode este
-- rollback junto com o deploy de uma versão anterior do sistema.

drop table if exists motivos_nao_entrega cascade;
