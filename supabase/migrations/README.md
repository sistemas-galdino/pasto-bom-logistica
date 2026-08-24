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
| 0001 – 0021 | sim |
| 0022 | **NÃO** — escrita, aguardando autorização do David |

A 0022 acrescenta `entregas.ordem_rota` (integer nulável) — a ordem das paradas
que o motorista informa ao concluir cada entrega (item 11 da Natália). Aditiva e
nulável: entrega sem ordem é o estado normal, não dado faltando. **Não tem
UNIQUE de propósito** — dois motoristas sequenciando o mesmo dia tomariam erro de
banco na estrada, sem ter o que fazer com o erro; empate se desempata na leitura.
Como a 0020 e a 0021, a ordem é migration ANTES do deploy.

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
