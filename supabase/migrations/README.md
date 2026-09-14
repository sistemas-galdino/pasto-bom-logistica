# Migrações

Cada migração `NNNN_nome.sql` que altera schema ou dados tem um par
`NNNN_nome_rollback.sql`. Aplicar e voltar são operações manuais, feitas pelo
SQL Editor do Supabase — não há CLI conectada a este projeto.

## Ordem

Aplicar em ordem crescente. **Voltar em ordem DECRESCENTE** — os rollbacks têm
dependências entre si (o da 0013 derruba tabelas que o da 0014 usa).

## Regras que valem para todos os rollbacks aqui

1. **O rollback é uma saída de emergência, não um botão de desfazer.** Ele
   restaura o estado do momento da migração. Tudo o que a equipe fizer depois,
   no modelo novo, se perde — e quanto mais tempo passar, mais isso pesa.
2. **Todo rollback abre com o que se perde**, explicitamente, e com a consulta
   de exportação para salvar antes.
3. **Migração destrutiva tira um snapshot antes.** A 0014 é o exemplo: ela cria
   `backup_pedidos_pre_entregas` e `backup_itens_separacao_pre_entregas`, e não
   apaga nenhuma coluna do modelo antigo — é isso que torna a volta possível.
4. **Rollback nunca apaga o snapshot.** Se precisar rodar duas vezes ou auditar
   depois, ele é a única fonte.

## Estado

Conferido contra o banco em 24/08/2026, objeto por objeto (ver "Como conferir"
abaixo) e contra o ledger `supabase_migrations.schema_migrations`.

| Migração | Aplicada em produção? |
|---|---|
| 0001 – 0022 | sim |
| 0023 – 0024 | sim (14/09/2026) |

A **0023 e a 0024 rodaram em 14/09/2026**, com autorização do David, pelo MCP do
Supabase (que voltou a responder — ver a pendência antiga abaixo). Conferidas
depois de aplicar, objeto por objeto:

| | RLS | políticas | índices | checks | FKs | colunas |
|---|---|---|---|---|---|---|
| `rotas_cidade` | ativa | 2 | 2 | 4 | 1 | 10 |
| `produtos_estoque` | ativa | 2 | 1 | 0 | 0 | 6 |

Os quatro checks da 0023 são os do arquivo: cidade não vazia, `dias_semana` em
0..6, `periodos` com 1 ou 2 itens, vigência coerente. A FK é `criado_por ->
auth.users`. Os **zeros da 0024 são de propósito**: nenhum check em
`quantidade` (estoque negativo é o caso que a operação precisa ver) e nenhuma FK
para `produtos_peso` (são dois espelhos independentes do mesmo ERP, e um não
pode derrubar o outro).

**O deploy do código ainda não subiu.** As duas tabelas estão de pé e ninguém as
lê: `GET /api/agenda` só consulta `rotas_cidade` na versão nova, e o alerta de
estoque idem. A ordem foi respeitada — migration ANTES do deploy.

A CARGA INICIAL DO ESTOQUE JÁ RODOU (14/09/2026, 17:14): ciclo completo, 31/31
páginas, **15.418 produtos gravados** em 114 s. Sem ela o alerta nasceria mudo
(tabela vazia = "não sei" em todo produto). Para repetir:

```
node --import tsx --env-file-if-exists=.env \
  apps/backend/src/scripts/sincronizar-estoque.ts
```

O script imprime um placar de COBERTURA, e é ele o critério que autoriza (ou
retira) a feature. Medido no banco depois da carga:

- 6.461 produtos com `quantidade > 0` no cadastro inteiro.
- Dos **632 produtos que a operação realmente entrega**: **632 casaram** com o
  espelho (nenhum vira "não sei"), **539 com estoque**, 93 em zero, 0 negativo.
- Os dois zerados mais frequentes são o `11930` (126 pedidos) e o `11931` — os
  itens de PRESTAÇÃO DE SERVIÇO, que `GET /api/estoque` corta do alerta pela
  lista `produtos_servico`. Os demais zerados são produto de verdade em falta
  (adubo, milho, gesso), que é exatamente o que o alerta deve apontar.

Se um dia vier tudo zero, **não suba o alerta** — um aviso que grita em todo
item ensina a equipe a ignorá-lo, e o aviso verdadeiro passa batido junto.


A **0007 rodou em 24/08/2026**, com autorização do David, depois de dois meses
pulada — ele aplicou pelo SQL Editor. Conferido após aplicar: as duas colunas
existem e o índice parcial saiu idêntico ao do arquivo
(`CREATE INDEX idx_clientes_numero_whatsapp ON clientes (numero_whatsapp) WHERE
numero_whatsapp IS NOT NULL`). O relato abaixo fica porque a forma de falhar é
mais instrutiva que a correção.

### Como a 0007 ficou dois meses pulada sem ninguém ver

Descoberto em 24/08/2026 lendo o log de produção: centenas de
`[ingest] upsert cliente XXXX falhou: Could not find the 'numero_whatsapp'
column of 'clientes' in the schema cache`, em todo tick, desde junho.

O `worker/ingest.ts:548-549` grava `numero_whatsapp` e `whatsapp_tipo` na mesma
linha do cliente. Sem as colunas, o PostgREST rejeita **a linha inteira** — não
só os dois campos. Consequência medida no banco:

| | |
|---|---|
| clientes citados em `pedidos` | 288 |
| clientes no espelho | 36 |
| espelho congelado desde | 16/06/2026 |

Duas consequências. A **visível**: os cartões e a agenda tiram bairro e cidade
de `clientes`, e 252 dos 288 não estão lá — entrega rural se orienta por bairro
+ cidade. A **latente**: `lerContatoCliente` (`services/transitions.ts:383`) faz
`select` da coluna inexistente e devolve `null` sempre; hoje isso não aparece
porque o MODO TESTE redireciona todo envio para um número fixo, mas **no dia em
que o modo teste for desligado, nenhum cliente recebe WhatsApp**.

A correção foi rodar a 0007 como estava: aditiva, `add column if not exists`,
sem backfill. **Não há backfill a fazer**: o primeiro tick de ingestão regrava os
clientes que tocar, e a varredura profunda (365 dias) completa o resto. Em
24/08, logo após aplicar, o espelho seguia em 36 de 288 — porque o Órix estava
inalcançável (`fetch failed` no `POST /Login`) desde sexta 21/08. O repovoamento
acontece no primeiro tick que conseguir falar com o ERP.

**Por que o README dizia "0001 – 0022 | sim":** a conferência de 12/08 olhou a
lista de arquivos, não o banco. O ledger do Supabase é a fonte da verdade — e
nem ele basta, porque migration rodada pelo SQL Editor não entra nele (foi o
caso das 0008–0012, que ESTÃO no banco e não no ledger). A única conferência que
vale é procurar o OBJETO.

### Como conferir (não confie nesta tabela; refaça)

```sql
-- o que o ledger conhece
select version, name from supabase_migrations.schema_migrations order by version;

-- o objeto de cada migration existe? (exemplos; o nome tem de sair do .sql)
select
  (select count(*) from information_schema.columns
    where table_name='clientes' and column_name='numero_whatsapp')    as m0007,
  (select count(*) from information_schema.columns
    where table_name='pedidos'  and column_name='ausente_orix_desde') as m0016,
  (select count(*) from information_schema.columns
    where table_name='profiles' and column_name='acesso_token_hash')  as m0018;
```

Aviso de quem já errou nisso hoje: **leia o nome real do objeto no `.sql` antes
de conferir.** Chutar o nome produz falso alarme — foi o que aconteceu comigo
com a 0016 e a 0018, que estão aplicadas.

A 0022 rodou em 24/08/2026, com autorização do David. Acrescenta
`entregas.ordem_rota` (integer nulável) — a ordem das paradas que o motorista
informa ao concluir cada entrega (item 11 da Natália). Aditiva e nulável: entrega
sem ordem é o estado normal, não dado faltando. **Não tem UNIQUE de propósito** —
dois motoristas sequenciando o mesmo dia tomariam erro de banco na estrada, sem
ter o que fazer com o erro; empate se desempata na leitura (`rota-ordem.ts` no
shared). Conferido após aplicar: coluna integer nulável, 1 check
(`ordem_rota IS NULL OR ordem_rota > 0`), índice parcial
`idx_entregas_ordem_rota (motorista_id, data_agendada, ordem_rota)` nas viagens
agendada/em_rota, e as 98 entregas existentes com `ordem_rota` nulo — nenhuma foi
tocada.

Como a 0020 e a 0021, a ordem é migration ANTES do deploy: o código do C2 já
consulta `ordem_rota` no select de `entregas`.

A 0021 rodou em 24/08/2026, com autorização do David. Ela cria `fornecedores`
(espelho somente-leitura do cadastro do Órix) e `reservas` (o card avulso que
RESERVA um caminhão num slot — oficina, coleta de adubo). Puramente aditiva:
duas tabelas novas, nada destrutivo, sem backfill. Conferido após aplicar: RLS
ativa nas duas, 2 políticas cada, 5 índices em `reservas` e 3 em `fornecedores`.

Mesma ordem da 0020: **migration antes do deploy**, porque o código passa a
consultar `reservas` no caminho do agendamento. Enquanto o código da Onda C não
subir, as tabelas ficam vazias e ninguém as lê — aplicar antes não tem efeito.

A 0020 rodou em 24/08/2026, com autorização do David. Ela cria
`caminhao_limites` — o teto de entregas por dia de cada caminhão, por janela de
vigência (pedido da Natália, item 10 do documento de 08/2026). É a primeira
tabela datada do schema. Puramente aditiva, nada destrutivo, sem backfill, e
reaplicável (`if not exists`). Conferido após aplicar: RLS ativa, 2 políticas,
2 índices, 2 checks, 2 FKs.

**A ordem importava e foi respeitada: migration ANTES do deploy.** Diferente da
0019, aqui o código consulta a tabela no caminho do agendamento — subir o código
primeiro faria `validarCargaDoAgendamento` consultar tabela inexistente. A
leitura degrada em log em caso de erro (o limite é regra a MAIS e não pode
travar a operação), mas isso é rede de segurança, não plano.

> **Correção de 13/09/2026 — o `comment on table caminhao_limites` está
> desatualizado no banco.** Ele diz que o teto "soma-se à regra de tonelagem
> (capacidade_kg): as duas valem juntas". Deixou de ser verdade em 09/2026: a
> tonelagem parou de recusar agendamento e virou só sinalizador na tela
> (decisão da Natália na reunião de 27/08 — "que ele não seja um impeditivo de
> agendamento, mas que ele sinalize se aquele caminhão já tá lotado ou não").
> Hoje `caminhao_limites` é a ÚNICA regra que recusa agendamento, e caminhão
> sem janela cadastrada não tem teto nenhum.
>
> Fica registrado aqui, e **não** numa migration: uma migration que só troca um
> `comment on` gastaria uma janela de aplicação num banco compartilhado com
> produção para mudar texto que nenhum código lê. Quem for mexer nessa tabela
> lê este arquivo antes — e a regra viva está em
> `packages/shared/src/limite-entregas.ts` e `apps/backend/src/services/carga.ts`,
> os dois já corrigidos.
>
> A `caminhao_limites` também **não foi alterada**: o esquema continua certo. O
> que mudou foi o peso, que nunca esteve nesta tabela.

A 0019 rodou em 12/08/2026, com autorização do David. Só ACRESCENTA uma coluna
nulável (`peso_unit_kg`) em `entrega_itens` — o peso congelado da viagem. Nada
destrutivo, sem backfill, e o código anterior não se importa com ela. Pode ser
reaplicada à vontade: é `if not exists`.

A 0018 rodou em 12/08/2026, com autorização do David. Ela só ACRESCENTA três
colunas nuláveis em `profiles` (o link curto de acesso) — nada destrutivo, e o
código anterior não se importa com elas. Pode ser reaplicada à vontade: é toda
`if not exists`.

A 0017 já rodou (05/08/2026, com autorização do David). Ela apagou as 13
entregas de teste da equipe e não pode ser reaplicada: a guarda dela aborta se
encontrar entrega criada depois de 28/07, o que passa a ser o caso assim que a
operação de verdade começar. Os snapshots `backup_*_pre_reset` continuam no
banco — são a fonte do rollback e da auditoria, e só devem ser derrubados
quando a equipe estiver rodando há tempo suficiente para a volta deixar de
fazer sentido.

Dev e produção compartilham o MESMO projeto Supabase (`xphebokxfgmhbpspcuar`).
Aplicar aqui vale para a equipe na hora — por isso as migrações da Onda 2 só
sobem na janela combinada com o David.
