# --- Etapa 1: Instalación de dependencias ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# --- Etapa 2: Build de Next.js ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* se incrusta en el bundle del navegador en build-time, no en runtime,
# por eso debe recibirse como build ARG (valor accesible desde el host, no el DNS interno de docker)
ARG NEXT_PUBLIC_ENGINE_URL=http://localhost:8080
ENV NEXT_PUBLIC_ENGINE_URL=$NEXT_PUBLIC_ENGINE_URL

RUN npm run build

# --- Etapa 3: Runtime mínimo ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg es requerido por /api/render-video (lib/videoGenerator.ts)
RUN apk add --no-cache ffmpeg

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
