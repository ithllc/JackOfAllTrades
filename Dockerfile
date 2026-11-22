# =============================================================================
# JackOfAllTrades — Production Dockerfile for Google Cloud Run
# License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
#
# Architecture Traceability:
#   - ADR 002 (Infrastructure & Compute): Containerized Node.js/Express backend
#     + React Vite PWA frontend deployed to Google Cloud Run for scale-to-zero
#     economics and native WebRTC signaling / HTTP2 transport.
#   - Unified Server Contract: Compiles server.ts -> server.js (ESM) so Cloud Run,
#     `npm run start:cloudrun`, and `node server.js` all run the exact unified API
#     including /api/health, /api/db/status, /api/ontology/*, /api/deliverables,
#     /api/analyze-buffer, /api/voice-assist, and /api/generate-pip.
#   - Cloud Run Contract: Exposes port 8080 and honors process.env.PORT.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build the React + Vite Progressive Web App (dist/) + Unified server.js
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifests first for optimal Docker layer caching
COPY package.json package-lock.json* ./
RUN npm ci

# Copy application source and compile the production PWA bundle + unified backend
COPY index.html vite.config.ts tsconfig.json server.ts ./
COPY public ./public
COPY src ./src
RUN npm run build && \
    npx esbuild server.ts --bundle --platform=node --format=esm --packages=external --outfile=server.js

# -----------------------------------------------------------------------------
# Stage 2: Minimal Production Runtime Image (Cloud Run Stateless Container)
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner

LABEL org.opencontainers.image.title="JackOfAllTrades" \
      org.opencontainers.image.description="Autonomous visual repair & assembly PWA with Spatial AR Overlays, Multi-Step Per-Step PiP, PostgreSQL pgvector ontology, and Gemini 4 routing" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

WORKDIR /app

# Cloud Run injects PORT=8080; explicitly default to 8080 for container parity
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

# Install only production Node.js dependencies (express, @google/genai, pg, dotenv)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built static PWA assets + compiled unified server.js + AGPL-3.0 corresponding source
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js
COPY server.ts ./server.ts
COPY App.jsx ./App.jsx
COPY database ./database
COPY Dockerfile ./Dockerfile
COPY LICENSE ./LICENSE
COPY docs ./docs

# Security hardening: run under non-root node user
RUN chown -R node:node /app
USER node

# Expose Google Cloud Run's standard HTTP port
EXPOSE 8080

# Container healthcheck targeting the Cloud Run-safe Express /api/health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT}/api/health || exit 1

# Launch the unified Express backend (API proxy + Cloud SQL pgvector + Scale Guard + PWA static host)
CMD ["node", "server.js"]
