-- 0021_reservas_fornecedores_rollback.sql
-- Desfaz a 0021.
--
-- O QUE SE PERDE: todas as reservas de caminhão criadas (oficina, coleta de
-- adubo, bloqueios avulsos) e o espelho de fornecedores. Não há onde guardar
-- reserva no modelo anterior — ela não é entrega, e foi exatamente por isso que
-- ganhou tabela própria. Exporte antes:
--
--   select servico, cidade, produtos, data_agendada, periodo,
--          caminhao_id, motorista_id, peso_previsto_kg, bloqueia_caminhao,
--          observacoes, criado_em
--     from reservas
--    where status = 'ativa'
--    order by data_agendada, periodo;
--
-- O QUE NÃO SE PERDE: nada de pedido, entrega, item, peso, separação ou limite
-- de entregas. A 0021 é puramente aditiva e não toca em nenhuma tabela
-- existente. As travas de tonelagem e de quantidade continuam valendo — elas
-- nunca dependeram destas tabelas.
--
-- O espelho de fornecedores se reconstrói sozinho na próxima sincronização, se
-- a 0021 for reaplicada: nenhum dado original vive só aqui, a fonte é o Órix.
--
-- ATENÇÃO: a versão atual do sistema LÊ `reservas` em ocupacaoDoSlot
-- (services/carga.ts) e em GET /api/agenda. Só rode este rollback junto com o
-- deploy de uma versão anterior, senão o agendamento passa a falhar.

drop table if exists reservas cascade;
drop table if exists fornecedores cascade;

-- O enum só pode cair depois da tabela que o usava.
drop type if exists status_reserva;
