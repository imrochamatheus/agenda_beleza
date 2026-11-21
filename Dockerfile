# syntax=docker/dockerfile:1
# Uma única imagem para a app (Next.js) e o worker; o papel vem do argumento do entrypoint.
ARG NODE_IMAGE=node:24-trixie-slim

# ---------- build: dependências completas, cliente Prisma, Next e bundles do worker ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Camada de dependências: só muda quando o package.json/lock mudam.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
# Sem DATABASE_URL: generate e build não dependem do banco (CA-7).
# next.config.ts vira um único next.config.mjs autocontido (D-012, correção R-A): tudo o que ele
# importa de src/ entra no bundle, e só pacotes de node_modules ficam externos. Assim o estágio
# final não depende de src/ e um import novo no next.config.ts não quebra o `next start`.
RUN npm run db:generate \
 && npm run build \
 && npm run build:node \
 && npx esbuild next.config.ts --bundle --platform=node --format=esm --target=node24 \
      --packages=external --outfile=dist/next.config.mjs \
 && npm prune --omit=dev

# ---------- final: só o necessário para rodar, como usuário não root ----------
FROM ${NODE_IMAGE} AS final
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=UTC \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# O prisma CLI (migrate deploy) precisa do node_modules de produção, do schema e do config.
# src/ não entra: o cliente gerado já está empacotado em .next/ e dist/, e o next.config vai
# compilado (dist/next.config.mjs), nunca o .ts, que importa de src/.
COPY --from=build --chown=node:node /app/package.json /app/prisma.config.ts ./
COPY --from=build --chown=node:node /app/dist/next.config.mjs ./next.config.mjs
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# Armazenamento simulado de fotos (D-021): criado com dono node ANTES do USER, para o volume nomeado
# montado aqui herdar o dono. O sharp usa os binários glibc (@img/sharp-linux-x64) já em node_modules.
RUN mkdir -p /app/.armazenamento && chown node:node /app/.armazenamento

USER node
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["app"]
