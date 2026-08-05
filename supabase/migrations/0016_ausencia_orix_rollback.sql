-- 0016_ausencia_orix_rollback.sql
-- Desfaz a 0016_ausencia_orix.sql.
--
-- O QUE SE PERDE: só os carimbos de ausência em curso — pedidos que estavam no
-- meio da carência de 24 h e ainda não foram descartados. Nada de operação: a
-- coluna é um contador de espera, não histórico. Na próxima varredura depois de
-- um novo deploy, eles simplesmente são carimbados de novo.
--
-- O QUE NÃO SE PERDE: os pedidos JÁ descartados por ausência continuam em
-- 'cancelada', com o evento em eventos_status (ator='sistema'). Este rollback
-- não os traz de volta — para isso use o botão "Restaurar" no quadro, que é o
-- caminho pensado para essa reversão (e é decisão humana, de propósito).
--
-- ATENÇÃO: o worker da versão atual grava nesta coluna. Só rode este rollback
-- junto com o deploy de uma versão anterior do sistema, senão a reconciliação
-- passa a falhar a cada ciclo.

drop index if exists idx_pedidos_ausente_orix;

alter table pedidos drop column if exists ausente_orix_desde;
