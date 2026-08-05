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

Conferido contra o banco em 05/08/2026.

| Migração | Aplicada em produção? |
|---|---|
| 0001 – 0015 | sim |
| 0016 ausencia_orix | não — pendente de autorização |
| 0017 reset_quadro_teste | não — pendente de autorização |

A 0017 apaga TODAS as entregas, por assumir que são o teste da equipe (13, a
última de 28/07). Ela aborta sozinha se encontrar entrega criada depois de
28/07 — quanto mais tempo passar, maior a chance de a guarda disparar, e aí o
recorte precisa ser refeito antes de aplicar.

Dev e produção compartilham o MESMO projeto Supabase (`xphebokxfgmhbpspcuar`).
Aplicar aqui vale para a equipe na hora — por isso as migrações da Onda 2 só
sobem na janela combinada com o David.
