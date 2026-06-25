# Sistema de Logística Inteligente — Pasto Bom (Fase 1)

Monorepo que conecta os **pedidos da Pasto Bom (via API Órix)** a um **quadro
Kanban logístico** operado pelo time, com **notificações automáticas de WhatsApp**
em cada etapa da entrega.

A Fase 1 entrega o fluxo central: **ingestão automática de pedidos da Órix →
quadro de status (pendente → agendada → em rota → entregue / cancelada) →
disparo de WhatsApp em cada transição**.

---

## Visão do sistema

```
            ┌─────────────────────────────────────────────────────────────┐
            │                         Órix (ERP)                           │
            │   POST /Login · POST /PedidosPorProdutos · GET /Cliente ·     │
            │   GET /Propriedades  (empresa operacional = 2)               │
            └───────────────▲───────────────────────────────┬─────────────┘
                            │ poll (node-cron, POLL_CRON)    │
                            │                                │ enriquece
            ┌───────────────┴────────────────────────────────▼─────────────┐
            │                    apps/backend (Node + Fastify)              │
            │                                                               │
            │  worker/scheduler → worker/poll → worker/ingest  (idempotente)│
            │      • agrupa 1-linha-por-produto em 1 pedido + N itens       │
            │      • upsert em pedidos/itens/clientes/propriedades          │
            │      • NUNCA dispara WhatsApp                                  │
            │                                                               │
            │  api/server (/api) → routes/pedidos · routes/config           │
            │      • GET /api/pedidos, /api/pedidos/:id, /api/config ...     │
            │      • POST /api/pedidos/:id/transicao                        │
            │            → services/transitions.aplicarTransicao()          │
            │              • valida máquina de estados (@pastobom/shared)    │
            │              • RF-1.8: exige propriedade se cliente tem >1     │
            │              • grava evento + dispara WhatsApp (exactly-once)  │
            │                                                               │
            │  whatsapp/evolution → Evolution API v2 (sendText)             │
            └───────────────┬───────────────────────────────▲──────────────┘
                            │ Supabase service-role          │ REST + JWT
                            │ (ignora RLS)                   │ (token Supabase)
            ┌───────────────▼─────────────┐   ┌──────────────┴──────────────┐
            │      Supabase / Postgres     │   │   apps/frontend (React+Vite) │
            │  pedidos · itens_pedido ·    │   │   Kanban (4 colunas) +       │
            │  clientes · propriedades ·   │   │   aba de cancelados          │
            │  eventos_status ·            │◄──┤   Auth Supabase (email/senha)│
            │  mensagens_whatsapp ·        │   │   vendedor = somente leitura │
            │  sync_state · profiles · RLS │   └──────────────────────────────┘
            └──────────────────────────────┘
```

Tipos, contrato REST e a **máquina de estados** ficam em `packages/shared` e são
a fonte única da verdade compartilhada entre backend e frontend.

---

## Estrutura do monorepo

```
sistema-logistica/
├── package.json                  # workspaces + scripts da raiz
├── tsconfig.base.json            # TS estrito compartilhado
├── .env.example                  # variáveis de ambiente (com credenciais de homologação Órix)
├── README.md
├── supabase/
│   ├── README.md
│   └── migrations/
│       ├── 0001_schema.sql       # extensões, enums, tabelas, índices
│       ├── 0002_rls.sql          # RLS + helper papel_atual()
│       └── 0003_seed_config.sql  # seeds em sync_state (status, cursor, templates)
├── packages/shared/              # TS puro, sem deps de runtime
│   └── src/
│       ├── index.ts
│       ├── state-machine.ts      # TRANSICOES, podeTransicionar, templateDaTransicao
│       └── types/{domain,api,orix}.ts
├── apps/backend/                 # Fastify 4 + supabase-js + node-cron + zod
│   └── src/
│       ├── index.ts              # bootstrap: sobe API + agendador
│       ├── config/env.ts         # validação de env com zod
│       ├── db/supabase.ts        # cliente service-role
│       ├── log.ts
│       ├── orix/{client,status}.ts + smoke.mjs
│       ├── whatsapp/{evolution,templates}.ts
│       ├── worker/{poll,ingest,scheduler}.ts
│       ├── services/transitions.ts
│       └── api/{server,auth}.ts + routes/{pedidos,config}.ts
└── apps/frontend/                # React 18 + Vite 5 + Tailwind 3 + react-query
    └── src/
        ├── main.tsx · App.tsx · index.css
        ├── lib/{supabase,api,format}.ts
        ├── auth/{AuthProvider,Login}.tsx
        ├── pages/Board.tsx       # kanban
        └── components/{Header,KanbanColumn,PedidoCard,TransicaoModal,status}.tsx
```

---

## Requisitos

- **Node.js >= 20.18** (ou 22+) — o backend executa TypeScript direto via
  `tsx` (`node --import tsx`), carrega o `.env` com `--env-file-if-exists` e usa
  `fetch` nativo.
- **npm >= 9** (workspaces).
- Um **projeto Supabase** (Postgres + Auth) — para rodar a aplicação de fato.
- Uma instância da **Evolution API v2** (WhatsApp) — opcional; sem ela o envio
  roda em modo *dry-run* (loga e não envia, sem quebrar).
- Acesso de rede à **API Órix** (homologação: `http://177.71.135.247:19201`).

---

## Instalação

Na raiz do monorepo:

```bash
npm install
```

Isso instala as dependências de todos os workspaces (`packages/*`, `apps/*`).

---

## Variáveis de ambiente

Copie o arquivo de exemplo e preencha os valores do seu ambiente:

```bash
cp .env.example apps/backend/.env
```

> O backend lê o `.env` do diretório a partir do qual é executado. Para `npm run
> dev:api` / `dev:worker`, o processo nasce em `apps/backend`, então coloque o
> `.env` lá (ou exporte as variáveis no shell). O `.env.example` da raiz já traz
> as **credenciais de homologação da Órix** (são de teste e fazem parte da
> documentação do projeto). Segredos reais (Supabase, Evolution) **nunca** são
> commitados — `.gitignore` cobre `.env` e `**/.env`.

### Backend (`apps/backend/.env`)

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `ORIX_BASE_URL` | sim | Base da API Órix. Homologação: `http://177.71.135.247:19201/ws/integradores/v1` |
| `ORIX_LOGIN` | sim | Login da Órix (`api ia` em homologação) |
| `ORIX_SENHA` | sim | Senha da Órix (`123` em homologação) |
| `ORIX_EMPRESA` | não (default 2) | Empresa operacional |
| `SUPABASE_URL` | sim | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | Service-role key (backend ignora RLS) |
| `SUPABASE_ANON_KEY` | não | Chave anônima (não usada server-side) |
| `EVOLUTION_URL` | não | URL da Evolution API v2 (ausente ⇒ dry-run) |
| `EVOLUTION_INSTANCE` | não | Nome da instância Evolution |
| `EVOLUTION_API_KEY` | não | API key da Evolution |
| `POLL_CRON` | não (default `*/30 * * * *`) | Frequência do polling |
| `API_PORT` | não (default 3333) | Porta da API |
| `ALLOW_NO_AUTH` | não (default `true`) | Em dev, libera rotas sem JWT (assume papel `logistica`) |

### Frontend (`apps/frontend/.env`)

| Variável | Descrição |
|----------|-----------|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Chave anônima do Supabase (login email/senha) |
| `VITE_API_URL` | URL da API backend (default `http://localhost:3333`) |

---

## Provisionamento (Supabase + Evolution)

### 1. Criar o projeto Supabase

1. Crie um projeto novo em <https://supabase.com>.
2. Anote a **Project URL**, a **anon key** e a **service-role key**
   (Project Settings → API).

### 2. Aplicar as migrations — **em ordem**

As migrations estão em `supabase/migrations/` e devem ser aplicadas
**numericamente** (detalhes em `supabase/README.md`):

```bash
# via Supabase CLI (recomendado)
supabase db push

# OU manualmente, em ordem:
supabase db execute --file supabase/migrations/0001_schema.sql      # extensões, enums, tabelas, índices
supabase db execute --file supabase/migrations/0002_rls.sql         # RLS + helper papel_atual()
supabase db execute --file supabase/migrations/0003_seed_config.sql # seeds em sync_state
```

3. Crie ao menos um usuário no **Supabase Auth** (email/senha) e o `profile`
   correspondente com o papel desejado:

   ```sql
   insert into profiles (id, papel, nome)
   values ('<uuid-do-auth-user>', 'logistica', 'Operador Logística');
   ```

   Papéis: `logistica` (leitura+escrita), `vendedor` (somente leitura),
   `motorista` (escopo mínimo, Fase 3).

### 3. Configurar a Evolution API (WhatsApp) — opcional

- Suba/contrate uma instância da **Evolution API v2** e crie uma instância
  conectada ao número da Pasto Bom.
- Preencha `EVOLUTION_URL`, `EVOLUTION_INSTANCE` e `EVOLUTION_API_KEY` no
  `apps/backend/.env`.
- Sem essas variáveis o envio entra em **dry-run**: a linha em
  `mensagens_whatsapp` é criada, marcada como `falha`/`pendente` e nada é
  enviado — útil para testar o fluxo sem WhatsApp real.

---

## Scripts npm

Todos rodam a partir da **raiz** do monorepo.

| Script | Comando | O que faz |
|--------|---------|-----------|
| Instalar | `npm install` | Instala dependências de todos os workspaces |
| Typecheck | `npm run typecheck` | `tsc --noEmit` em shared, backend e frontend |
| Build | `npm run build` | Build de cada workspace que tenha o script |
| API (dev) | `npm run dev:api` | Sobe a API + o agendador (`apps/backend/src/index.ts`, watch) |
| Worker (dev) | `npm run dev:worker` | Sobe **apenas** o agendador de polling (`worker/scheduler.ts`, watch) |
| Frontend (dev) | `npm run dev --workspace apps/frontend` | Vite dev server (porta 5173) |
| Frontend (build) | `npm run build --workspace apps/frontend` | `tsc -b && vite build` |

> `npm run dev:api` já inicia o agendador **e** a API no mesmo processo
> (`index.ts` chama `startScheduler()` e `startServer()`). O `dev:worker` existe
> para rodar o polling isolado (ex.: separar worker e API em processos distintos).

### Ordem típica para subir tudo em desenvolvimento

```bash
npm install
cp .env.example apps/backend/.env        # preencha SUPABASE_* (e EVOLUTION_* se houver)
# aplique as migrations no Supabase (ver acima)
npm run dev:api                          # backend: API :3333 + polling
# em outro terminal:
npm run dev --workspace apps/frontend    # frontend: http://localhost:5173
```

---

## Deploy (Easypanel)

O sistema sobe como **serviço único**: o backend Fastify também serve o
frontend React buildado (mesmo domínio, sem CORS). O `Dockerfile` na raiz faz
todo o trabalho; o Easypanel builda direto do GitHub.

**Como funciona o serviço único**

- O `Dockerfile` instala as deps, roda `vite build` (gera `apps/frontend/dist`)
  e sobe `node --import tsx apps/backend/src/index.ts` na porta `3333`.
- Em produção, `apps/frontend/.env.production` deixa `VITE_API_URL` vazio, então
  o front chama `/api/...` no **mesmo domínio**. O `server.ts` serve os arquivos
  estáticos com **fallback SPA** (qualquer GET fora de `/api` devolve
  `index.html`).
- O `@pastobom/shared` roda como código TS via `tsx` (não há passo de compilação
  separado), o que evita problemas de resolução do pacote.

**Passo a passo no painel**

1. Crie um **App** apontando para o repositório GitHub, **Build = Dockerfile**.
2. **Porta**: `3333`. **Réplicas**: **1** (o agendador roda no mesmo processo e
   não tem lock distribuído — mais de uma réplica duplicaria o polling do Órix).
3. **Domínio**: gere o subdomínio do Easypanel (HTTPS automático).
4. **Healthcheck**: `GET /api/health` → `{ "ok": true }`.
5. **Environment** (runtime) — copie os valores do seu `apps/backend/.env`, com
   estes ajustes de produção:

   | Variável | Valor |
   |----------|-------|
   | `ORIX_BASE_URL`, `ORIX_LOGIN`, `ORIX_SENHA`, `ORIX_EMPRESA` | (do `.env`) |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | (do `.env`) |
   | `EVOLUTION_URL`, `EVOLUTION_INSTANCE`, `EVOLUTION_API_KEY` | (do `.env`) |
   | `POLL_CRON` | `*/5 * * * *` |
   | `API_PORT` | `3333` |
   | `ALLOW_NO_AUTH` | **`false`** (liga a autenticação real) |
   | `APP_URL` | `https://<seu-subdominio>.easypanel.host` (links de convite) |
   | `WHATSAPP_NUMERO_TESTE` | `5514998859650` no 1º deploy (valida sem disparar p/ clientes); **esvazie** para ir "pra valer" |

> A `SUPABASE_SERVICE_ROLE_KEY` é **secreta** e só existe como env de runtime do
> backend — nunca vai para o repositório nem para o bundle do front. A anon key
> (pública) fica no `.env.production` por ser embarcada no browser por design.

**Primeiro acesso (auth)**

Com `ALLOW_NO_AUTH=false` é preciso um login Supabase válido. Crie o primeiro
usuário com papel `logistica` (via painel do Supabase ou Auth Admin) — depois,
novos colaboradores entram pela tela **Usuários** (convite por link).

---

## Smoke test da integração Órix

O `apps/backend/src/orix/smoke.mjs` é **autônomo** (só usa `fetch` nativo) e
valida login + busca de pedidos + propriedades contra a Órix real:

```bash
ORIX_BASE_URL='http://177.71.135.247:19201/ws/integradores/v1' \
ORIX_LOGIN='api ia' ORIX_SENHA='123' ORIX_EMPRESA='2' \
node apps/backend/src/orix/smoke.mjs
```

Saída esperada: HTTP 200 no `/Login` com `valid:true`, registros em
`/PedidosPorProdutos` (status `00041`) e a propriedade em `/Propriedades/00001`.

---

## Status da Fase 1: o que está pronto × o que falta provisionar

### Pronto e verificado (compila + integração Órix real testada)

- **`packages/shared`** — tipos de domínio/API/Órix + máquina de estados.
  `tsc --noEmit` **limpo**.
- **`apps/backend`** — config (zod), cliente Supabase service-role, cliente Órix
  (com cache de token, retry/backoff, renovação em 401), classificador de status,
  worker (poll com chunking ≤16 dias + ingestão idempotente), serviço de
  transições (máquina de estados + RF-1.8 + WhatsApp exactly-once), Evolution
  (com dry-run), API Fastify (`/api/...`) e auth (JWT Supabase + papéis).
  `tsc --noEmit` **limpo**; bootstrap (`index.ts`) conecta API + agendador.
- **`apps/frontend`** — Kanban (4 colunas + aba de cancelados), modal de
  transição (com RF-1.8 no cliente), Auth Supabase, modo leitura para vendedor.
  `tsc --noEmit` **limpo**.
- **Integração Órix real** — smoke test passou contra a API de homologação
  (login OK, pedidos agrupáveis por `id_pedido`, propriedades retornadas).
- **Migrations SQL** — schema, RLS e seeds escritos conforme o contrato (nomes
  de tabelas/colunas/enums exatos; templates PT-BR e listas de status semeadas).

### Provisionado e verificado ao vivo (14/06/2026)

- **Projeto Supabase** — provisionado (projeto "Pasto Bom",
  `xphebokxfgmhbpspcuar`). As **4 migrations foram aplicadas** (`0001`–`0004`):
  11 tabelas com RLS, função `papel_atual()` endurecida (advisor `anon`
  resolvido) e `sync_state` semeado.
- **Ingestão Órix → Supabase** — `pollOnce()` rodou contra a Órix real e a
  janela de 30 dias gravou **34 pedidos / 56 itens / 28 clientes / 3
  propriedades** (todos `pendente`), com 0 erros e idempotência confirmada.
- **API HTTP** — `npm run dev:api` sobe limpo; `GET /api/health`, `/api/config`
  e `/api/pedidos` (34 pedidos agrupados com itens) respondem corretamente.

### Falta provisionar / executar

- **Usuário de login (Auth + `profiles`)** — criar pelo painel do Supabase e
  inserir a linha correspondente em `profiles` com o papel desejado.
- **Frontend rodando** — `npm run dev --workspace apps/frontend` (depende apenas
  do usuário de login para autenticar e exibir o quadro).
- **Evolution API** — sem instância configurada; o envio de WhatsApp roda em
  **dry-run**. O caminho real `POST /message/sendText` ainda não foi exercitado.
- **Build de produção do frontend** (`vite build`) não foi executado (não
  requerido na Fase 1); apenas o typecheck (`tsc --noEmit` / `tsc -b`).

---

## Critérios de Aceite do PRD → onde está implementado

> Os "RF-x" abaixo refletem os requisitos funcionais do contrato/PRD da Fase 1.
> Caminhos relativos à raiz do monorepo.

| Critério de Aceite | Implementado em | Observações |
|--------------------|-----------------|-------------|
| **CA-1** Pedidos da Órix entram automaticamente no sistema (polling por status-gatilho) | `apps/backend/src/worker/scheduler.ts:45` (`start`), `worker/poll.ts:173` (`pollOnce`) | node-cron com `POLL_CRON`; lê `status_gatilho` de `sync_state` |
| **CA-2** Janela controlada por data (≤16 dias) e cursor persistido | `worker/poll.ts:108` (`dividirEmSubJanelas`), `:89` (`calcularJanela`), `:138` (`atualizarCursor`) | `MAX_DIAS_JANELA=16`; cursor em `sync_state.poll_cursor` |
| **CA-3** 1 linha por produto agrupada em 1 pedido com N itens | `worker/ingest.ts:97` (agrupamento por `id_pedido`), `:135` (`processarGrupo`) | `Map<id_pedido, OrixPedidoItem[]>` |
| **CA-4** Ingestão idempotente (reprocessar não duplica) | `worker/ingest.ts:174` (busca existente), `:186` update / `:215` insert, `:246` recria itens | upsert por `orix_id_pedido` (UNIQUE) |
| **CA-5** Pedido novo nasce `pendente`; status logístico nunca é sobrescrito na re-ingestão | `worker/ingest.ts:232` (`status_logistico:'pendente'` no insert), `:191` (update sem `status_logistico`) | estado logístico é manual |
| **CA-6** Ingestão **nunca** envia WhatsApp | `worker/ingest.ts` (sem chamadas a `enviarTexto`); efeito colateral só em `services/transitions.ts` | por desenho |
| **CA-7** Datas Órix `dd/mm/yyyy` convertidas para ISO | `worker/ingest.ts:27` (`dataOrixParaISO`) | também aceita ISO de entrada |
| **CA-8** Máquina de estados é a fonte única da verdade | `packages/shared/src/state-machine.ts:11` (`TRANSICOES`), `:22` (`podeTransicionar`), `:42` (`templateDaTransicao`) | consumida por backend e frontend |
| **CA-9** Transição inválida ⇒ 409 | `services/transitions.ts:355`; mapeado em `api/routes/pedidos.ts:254` (`responderErro`) | `TransicaoError(409,...)` |
| **CA-10 (RF-1.8)** `→ agendada` com cliente de >1 propriedade exige `propriedadeCodigo` (422) | `services/transitions.ts:366` (`contarPropriedades` + 422); UI em `components/TransicaoModal.tsx:60` (`exigeSelecao`) | backend valida; frontend exige seleção |
| **CA-11** Cada transição grava evento de auditoria | `services/transitions.ts:411` (insert em `eventos_status`) | `de_status`, `para_status`, `ator` |
| **CA-12** WhatsApp **exactly-once** por transição; reenvio só manual | `services/transitions.ts:255` (`dispararWhatsapp`, 1×), `:452` (`reenviarWhatsapp` manual) | linha em `mensagens_whatsapp` `pendente→enviada/falha` |
| **CA-13** `data_entregue` setada ao entregar | `services/transitions.ts:393` (`patch.data_entregue`) | em `para==='entregue'` |
| **CA-14** Cliente Órix com cache de token + renovação (<2h / 401) + retry/timeout | `orix/client.ts:123` (`login`), `:139` (`tokenValido`), `:277` (`requestComRetry`), `:248` (renova em 401) | timeout 30s, 3 tentativas, backoff |
| **CA-15** `getPedidos` não faz chunking (worker faz) | `orix/client.ts:178` (`getPedidos` — 1 janela) | corpo com `somente_vendas`, `empresas` |
| **CA-16** Status configuráveis via `sync_state` | `orix/status.ts:60` (`carregarStatusConfig`), classificadores `:108`–`:121` | gatilho/cancelado/concluído, cache 60s |
| **CA-17** Normalização de número BR (55+DDD) | `whatsapp/evolution.ts:39` (`normalizarNumeroBR`) | retorna `null` se inválido |
| **CA-18** Envio Evolution v2 com dry-run sem env | `whatsapp/evolution.ts:100` (`enviarTexto`), `:107` (dry-run) | `POST /message/sendText/{instance}` |
| **CA-19** Render de template `{chave}` | `whatsapp/templates.ts:21` (`renderTemplate`) | mantém placeholder desconhecido |
| **CA-20** REST: `GET /api/health` | `api/server.ts:62` | público (fora do escopo auth) |
| **CA-21** REST: `GET /api/pedidos?status=...` (sem filtro ⇒ não-finalizados) | `api/routes/pedidos.ts:123`, `:57` (`FINALIZADOS`/`NAO_FINALIZADOS`) | join com `itens_pedido` |
| **CA-22** REST: `GET /api/pedidos/:id` | `api/routes/pedidos.ts:149` → `services/transitions.ts:135` (`carregarPedido`) | 404 se inexistente |
| **CA-23** REST: `POST /api/pedidos/:id/transicao` (200/409/422) | `api/routes/pedidos.ts:160` → `aplicarTransicao` | body validado com zod |
| **CA-24** REST: `GET /api/clientes/:codigo/propriedades` | `api/routes/pedidos.ts:186` | retorna `Propriedade[]` |
| **CA-25** REST: `GET /api/config` | `api/routes/config.ts:28` | lê `status_gatilho` + `templates` |
| **CA-26** REST: `POST /api/pedidos/:id/reenviar-whatsapp` | `api/routes/pedidos.ts:218` → `reenviarWhatsapp` | reenvio manual explícito |
| **CA-27** Auth: JWT Supabase + papel; logística escreve, vendedor só GET; `ALLOW_NO_AUTH` em dev | `api/auth.ts:76` (`autenticar`), `:89` (no-auth), `:119` (escrita só logística) | backend usa service-role |
| **CA-28** Backend usa `SUPABASE_SERVICE_ROLE_KEY` | `apps/backend/src/db/supabase.ts` + `config/env.ts:15` | ignora RLS |
| **CA-29** Frontend: Kanban 4 colunas + cancelados; cartão com cliente/cidade/valor/itens/propriedade | `pages/Board.tsx:73` (`porStatus`), `components/PedidoCard.tsx:16`, `components/KanbanColumn.tsx` | aba "Cancelados" em `Board.tsx:133` |
| **CA-30** Frontend: ação de transição via modal (RF-1.8 no cliente) | `components/TransicaoModal.tsx:37`, `pages/Board.tsx:201` | exige propriedade+data quando >1 propriedade |
| **CA-31** Frontend: papel exibido; vendedor em modo leitura | `auth/AuthProvider.tsx` (`podeEscrever`), `components/Header.tsx`, `pages/Board.tsx:193` | botões ocultos sem permissão |
| **CA-32** Frontend: token Supabase injetado nas chamadas à API | `lib/api.ts:49` (`obterToken`), `:66` (header Bearer) | usa `VITE_API_URL` |
| **CA-33** Banco: schema/enums/índices exatos | `supabase/migrations/0001_schema.sql` | `gen_random_uuid()`, índices em `status_logistico`/`cliente_codigo` |
| **CA-34** Banco: RLS por papel via `profiles` | `supabase/migrations/0002_rls.sql:16` (`papel_atual()`) + políticas | service-role faz bypass |
| **CA-35** Banco: seeds de `sync_state` (status, cursor, templates PT-BR) | `supabase/migrations/0003_seed_config.sql` | textos PT-BR com placeholders `{}` |

> **Não verificável sem Supabase/Evolution:** CA-1 a CA-7, CA-9 a CA-13, CA-16,
> CA-20 a CA-35 dependem de banco/Auth/WhatsApp provisionados para validação
> *funcional* end-to-end. Todos **compilam** e estão escritos contra o contrato;
> a única integração externa **executada de verdade** nesta fase foi a **Órix**
> (CA-14, CA-15, CA-18 parcialmente — login/pedidos/propriedades via smoke test).

---

## Notas de integração (decisões de build)

- O pacote `@pastobom/shared` é resolvido **a partir do código-fonte**
  (`package.json` `main`/`types` → `src/index.ts`). Para o `tsc --noEmit` por
  workspace funcionar de forma isolada e sem depender de uma ordem de build,
  removeu-se a configuração `composite` do shared e as `references` de
  backend/frontend. Em runtime, backend (`node --experimental-strip-types`) e
  frontend (Vite) também resolvem o shared como fonte. Esse foi o único ajuste
  estrutural de wiring necessário para zerar o typecheck.
- O backend roda via **`tsx`** (`node --import tsx`). O `--experimental-strip-types`
  nativo do Node **não** reescreve os specifiers `.js` (convenção NodeNext) para
  os arquivos `.ts` reais, então `node --experimental-strip-types` falhava em
  runtime com `ERR_MODULE_NOT_FOUND`. O `tsx` resolve `.js`→`.ts` de forma
  transparente, mantém `--watch`/`--env-file-if-exists` e não exige reescrever
  nenhum import. (Para produção, `npm run build` emite `dist/*.js` e `npm start`
  roda com Node puro.)
