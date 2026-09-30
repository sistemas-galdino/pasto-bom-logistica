-- 0025_entrega_parcial.sql
-- ENTREGA PARCIAL DECLARADA NA CONCLUSÃO — documento "parte 3" da Natália e
-- reunião de 24/09/2026.
--
-- POR QUÊ
-- ---------------------------------------------------------------------------
-- O caso que motivou: um cliente ia receber 40 itens, houve problema com a carga
-- e ele aceitou só 20. O sistema não tinha onde gravar isso. `entrega_itens.qtd`
-- é o que foi CARREGADO, e marcar a viagem como entregue consome essa quantidade
-- inteira do saldo do pedido — os 20 que voltaram simplesmente sumiam: não
-- voltavam para a fila e não ficavam registrados em lugar nenhum. A única saída
-- era "não realizado", que marcava os 40 como rejeitados.
--
-- O pedido dela, ao concluir: declarar quanto foi entregue de cada produto e,
-- havendo diferença, perguntar se o cliente quer o restante.
--   SIM  -> o restante volta para o pedido e é agendado de novo.
--   NÃO  -> "duplico o card": a viagem fica com o que foi entregue, e o restante
--           vira um card de NÃO REALIZADO, e o pedido é encerrado.
--
-- AS TRÊS COLUNAS
-- ---------------------------------------------------------------------------
-- entrega_itens.qtd_entregue
--   NULO = "não declarado", e vale `qtd`. É o que faz toda entrega concluída
--   antes desta migração continuar valendo exatamente como era, sem backfill.
--   ZERO é declaração legítima ("levou e não entregou nada daquele produto").
--   Não há check contra `qtd` aqui: entregar mais do que se levou é recusado na
--   aplicação (regra pura parcial-entrega.ts), onde dá para dizer por quê.
--
-- entregas.encerra_saldo
--   Só tem efeito em nao_realizado. Um nao_realizado DEVOLVE a mercadoria ao
--   saldo — é o que ele sempre significou (o caminhão foi e não entregou, vai
--   de novo). O card do restante recusado é o contrário: o cliente disse que não
--   quer mais, e devolver ao saldo faria o pedido ressuscitar na fila de
--   pendentes. A marca diz "este não realizado encerra o saldo".
--
-- entregas.origem_entrega_id
--   Liga o card do restante recusado à viagem que o gerou. Sem ela, o card
--   vermelho aparece no quadro sem explicação de onde veio, e desfazer a
--   conclusão não teria como achar o card para apagar junto.
--   ON DELETE SET NULL: apagar a viagem de origem (só acontece à mão, no banco)
--   não pode levar junto o registro de uma recusa do cliente.
--
-- O MOTIVO NOVO
-- ---------------------------------------------------------------------------
-- nao_realizado exige motivo da lista fechada (0012). Sem esta linha, o fluxo
-- novo morreria em 422 motivo_invalido na primeira tentativa. É distinto do
-- "Cliente recusou" que já existe (recusa da viagem inteira) — o relatório
-- precisa separar as duas coisas.
--
-- ADITIVA: três colunas nuláveis/com default e uma linha de motivo. Nada que
-- existe hoje muda de valor.
-- ORDEM: migration antes do deploy — o backend novo passa a LER as colunas.
--
-- ROLLBACK: 0025_entrega_parcial_rollback.sql

alter table entrega_itens
  add column if not exists qtd_entregue numeric
    check (qtd_entregue is null or qtd_entregue >= 0);

comment on column entrega_itens.qtd_entregue is
  'Quanto deste produto o cliente de fato recebeu, declarado na conclusão. '
  'NULL = não declarado (vale qtd). Menor que qtd = entrega parcial: a '
  'diferença volta ao saldo do pedido, ou vira um card de não realizado com '
  'encerra_saldo quando o cliente recusa o restante.';

alter table entregas
  add column if not exists encerra_saldo boolean not null default false;

comment on column entregas.encerra_saldo is
  'Só em nao_realizado: true quando é o restante RECUSADO pelo cliente numa '
  'entrega parcial. Nesse caso os itens desta viagem consomem saldo (o pedido '
  'é encerrado) em vez de voltar para a fila, que é o que um nao_realizado '
  'comum faz.';

alter table entregas
  add column if not exists origem_entrega_id uuid
    references entregas(id) on delete set null;

comment on column entregas.origem_entrega_id is
  'A viagem cuja conclusão parcial gerou este card (restante recusado). NULL '
  'em todas as outras entregas.';

insert into motivos_nao_entrega (descricao, ordem)
values ('Cliente recusou o restante', 6)
on conflict do nothing;
