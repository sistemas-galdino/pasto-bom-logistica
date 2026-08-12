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

Conferido contra o banco em 12/08/2026.

| Migração | Aplicada em produção? |
|---|---|
| 0001 – 0018 | sim |

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
