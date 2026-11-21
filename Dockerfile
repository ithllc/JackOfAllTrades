# =============================================================================
# JackOfAllTrades — Production Dockerfile for Google Cloud Run
# License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
#
# Architecture Traceability:
#   - ADR 002 (Infrastructure & Compute): Containerized Node.js/Express backend
#     + React Vite PWA frontend deployed to Google Cloud Run for scale-to-zero
#     economics and native WebRTC signaling / HTTP2 transport.
#   - Cloud Run Contract: Exposes port 8080 and honors process.env.PORT.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build the React + Vite Progressive Web App (dist/)
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifests first for optimal Docker layer caching
COPY package.json package-lock.json* ./
RUN npm ci

# Copy application source and compile the production PWA bundle + Service Worker
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Minimal Production Runtime Image (Cloud Run Stateless Container)
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner

LABEL org.opencontainers.image.title="JackOfAllTrades" \
      org.opencontainers.image.description="Autonomous visual repair & assembly PWA with WebRTC, PostgreSQL pgvector ontology, and Gemini 4 routing" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

WORKDIR /app

# Cloud Run injects PORT=8080; explicitly default to 8080 for container parity
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

# Install only production Node.js dependencies (express, @google/genai, pg, dotenv)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built static PWA assets from Stage 1 and the production Express server
COPY --from=builder /app/dist ./dist
COPY server.js ./server.js
COPY schema.sql ./schema.sql
COPY LICENSE ./LICENSE
COPY docs ./docs

# Security hardening: run under non-root node user
RUN chown -R node:node /app
USER node

# Expose Google Cloud Run's standard HTTP port
EXPOSE 8080

# Container healthcheck targeting the Express /healthz endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT}/healthz || exit 1

# Launch the stateless Express backend (API proxy + WebRTC signaling + PWA static host)
CMD ["node", "server.js"]
