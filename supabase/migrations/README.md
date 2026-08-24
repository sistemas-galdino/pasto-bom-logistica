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
| 0001 – 0006 | sim |
| **0007** | **NÃO** — pulada por engano; ver abaixo |
| 0008 – 0022 | sim |

### A 0007 nunca rodou, e isso quebrou o espelho de clientes

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

A correção é rodar a 0007 como está: aditiva, `add column if not exists`, sem
backfill. Assim que as colunas existirem, o primeiro tick de ingestão regrava os
clientes e a varredura profunda (365 dias) completa o resto.

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
