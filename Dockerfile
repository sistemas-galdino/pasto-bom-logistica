# Imagem única (serviço único): backend Fastify que também serve o frontend
# React buildado. Pensada para o Easypanel buildar direto do GitHub.
#
# Runtime via `tsx` (não `node dist/`): o pacote @pastobom/shared é consumido
# como código TS (seu package.json aponta para src/index.ts), então rodar a
# fonte via tsx evita o problema de resolução do pacote compilado.

FROM node:22-bookworm-slim

WORKDIR /app

# 1) Só os manifests primeiro → camada de cache estável para o `npm ci`.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/

# Instala TODAS as deps (inclui devDeps: tsx p/ runtime e vite/tsc p/ o build).
# NÃO definir NODE_ENV=production aqui, senão o npm pularia as devDependencies.
#
# O registry cai no meio do download de vez em quando (ECONNRESET) e o padrão do
# npm são só 2 tentativas com backoff curto — um blip derruba o build inteiro.
# Daí as tentativas extras e os timeouts folgados.
RUN npm ci --no-audit --no-fund \
      --fetch-retries=5 \
      --fetch-retry-factor=2 \
      --fetch-retry-mintimeout=15000 \
      --fetch-retry-maxtimeout=120000 \
      --fetch-timeout=600000

# 2) Código-fonte.
COPY . .

# 3) Build do frontend. O Vite carrega apps/frontend/.env.production
#    automaticamente (VITE_API_URL vazio → chamadas relativas /api).
RUN npm run build --workspace apps/frontend

# 4) Runtime.
ENV NODE_ENV=production
ENV API_PORT=3333
EXPOSE 3333

CMD ["node", "--import", "tsx", "apps/backend/src/index.ts"]
