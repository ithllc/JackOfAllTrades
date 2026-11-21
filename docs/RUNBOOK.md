# JackOfAllTrades (MakerLens) — Production Operations Runbook

**License:** GNU Affero General Public License v3.0 (`AGPL-3.0-only`)  
**Maintainers:** JackOfAllTrades / MakerLens Open-Source Engineering  
**Runtime Stack:** Google Cloud Run (Node.js 22 / Express) · Google Cloud SQL (PostgreSQL 16 + `pgvector`) · Gemini 4 API (`@google/genai >= 2.4.0` / `gemini-4-neon`, `gemini-decision-1`, `gemini-3.8-flash-lite-tts`, `gemini-omni-1.2-flash`)

---

## 1. Prerequisites & Environment Configuration

Required environment variables (inject credentials via Google Secret Manager on Cloud Run or AI Studio Secrets; never commit secrets to source control):

| Variable (Primary / Alias) | Description | Configured Value / Example |
| :--- | :--- | :--- |
| `PORT` | HTTP listen port (`3000` local dev, `8080` Cloud Run) | `8080` |
| `GEMINI_API_KEY` | Server-side Gemini 4 API key (never exposed to browser) | Secret Manager ref |
| `SQL_CONNECTION_NAME` | Cloud SQL instance connection name (`project:region:instance`) | `gemini4nyc26nyc-2273:us-east1:free-trial-first-project` |
| `SQL_PUBLIC_IP` | Cloud SQL Public IPv4 address for direct TLS TCP | `34.74.102.222` |
| `SQL_OUTGOING_IP` | Cloud SQL instance Outgoing IPv4 address (for firewall allowlists) | `34.73.184.213` |
| `SQL_PORT` | PostgreSQL TCP port (ignored when using `/cloudsql/` Unix socket) | `5432` |
| `SQL_HOST` / `DB_HOST` | Optional explicit host override (`/cloudsql/...` on Cloud Run, `127.0.0.1` for local Auth Proxy, or blank for auto-detection) | `/cloudsql/gemini4nyc26nyc-2273:us-east1:free-trial-first-project` |
| `SQL_SSL` | Enable TLS for Public IP TCP (`true`); automatically disabled on `/cloudsql/` Unix sockets | `true` |
| `SQL_DB_NAME` / `DB_NAME` | Target PostgreSQL database name | `postgres` or `jackofalltrades` |
| `SQL_USER` / `DB_USER` | PostgreSQL application role (prefer least-privilege DML role in production) | `joat_app` or `postgres` |
| `SQL_PASSWORD` / `DB_PASS` | PostgreSQL role password | Secret Manager ref |

**Transport Auto-Detection (`src/lib/dbConfig.ts` & `server.js`):**
- On **Google Cloud Run** (`K_SERVICE` is set automatically **and** the `/cloudsql/<SQL_CONNECTION_NAME>` Unix socket exists on disk): connects over the encrypted Cloud SQL Auth Proxy Unix domain socket with `ssl: false`.
- Outside Cloud Run (or in sandboxes where `K_SERVICE` is set without a mounted `/cloudsql/` socket): falls back cleanly to Public IP TCP (`34.74.102.222:5432`) with TLS enabled by default (or strict CA verification when `SQL_SSL_CA` is set).

---

## 2. Database Setup (`gemini4nyc26nyc-2273:us-east1:free-trial-first-project`)

1. **Create the application database and least-privilege user on your existing Cloud SQL instance:**
   ```bash
   gcloud config set project gemini4nyc26nyc-2273

   gcloud sql databases create jackofalltrades \
     --instance=free-trial-first-project

   gcloud sql users create joat_app \
     --instance=free-trial-first-project \
     --password="$SQL_PASSWORD"
   ```

2. **Apply `schema.sql` (enables `pgvector`, creates Recursive CTE views/functions, seeds ontology):**

   **Option A — Via Cloud SQL Auth Proxy (recommended, no public IP allowlist required):**
   ```bash
   cloud-sql-proxy gemini4nyc26nyc-2273:us-east1:free-trial-first-project --port 5432 &
   psql "host=127.0.0.1 port=5432 dbname=jackofalltrades user=postgres" -f schema.sql
   ```

   **Option B — Direct over Public IP (`34.74.102.222:5432`) with TLS:**
   *(Ensure your workstation IP is listed under Cloud SQL → Connections → Authorized Networks.)*
   ```bash
   psql "host=34.74.102.222 port=5432 dbname=jackofalltrades user=postgres sslmode=require" -f schema.sql
   ```

3. **Verify `pgvector` HNSW index and Recursive CTE traversal:**
   ```sql
   SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
   SELECT * FROM get_component_hierarchy(1);
   ```

   > **Network Reference:** Cloud SQL Public IP is `34.74.102.222:5432`; instance Outgoing IP is `34.73.184.213` (use this if federating external replicas or outbound firewall allowlists).

---

## 3. Build & Deploy to Google Cloud Run (`us-east1`)

1. **Build and push the multi-stage Docker container:**
   ```bash
   gcloud builds submit \
     --project gemini4nyc26nyc-2273 \
     --tag gcr.io/gemini4nyc26nyc-2273/jackofalltrades:latest .
   ```

2. **Deploy stateless service to Cloud Run (Port 8080, co-located in `us-east1` with Cloud SQL Auth Proxy):**
   ```bash
   gcloud run deploy jackofalltrades \
     --project gemini4nyc26nyc-2273 \
     --image gcr.io/gemini4nyc26nyc-2273/jackofalltrades:latest \
     --platform managed \
     --region us-east1 \
     --port 8080 \
     --min-instances 0 \
     --max-instances 50 \
     --concurrency 80 \
     --timeout 300 \
     --add-cloudsql-instances gemini4nyc26nyc-2273:us-east1:free-trial-first-project \
     --set-env-vars "NODE_ENV=production,SQL_CONNECTION_NAME=gemini4nyc26nyc-2273:us-east1:free-trial-first-project,SQL_HOST=/cloudsql/gemini4nyc26nyc-2273:us-east1:free-trial-first-project,SQL_PORT=5432,SQL_PUBLIC_IP=34.74.102.222,SQL_OUTGOING_IP=34.73.184.213,SQL_DB_NAME=jackofalltrades,SQL_USER=joat_app" \
     --set-secrets "GEMINI_API_KEY=joat-gemini-key:latest,SQL_PASSWORD=joat-sql-password:latest" \
     --allow-unauthenticated
   ```

3. **Smoke-test the deployed revision, PostgreSQL connectivity, and voice endpoints:**
   ```bash
   curl -fsS https://<CLOUD_RUN_URL>/healthz
   curl -fsS https://<CLOUD_RUN_URL>/api/db/status
   curl -fsS https://<CLOUD_RUN_URL>/api/ontology/tree
   ```

---

## 4. Quality Assurance Verification Protocol (Test Cases 1–4)

### Test Case 1: Adaptive Degradation (3G / Low Bandwidth & Visual Glare)
- **Steps:** Open Chrome DevTools → Network → throttle to **Slow 3G**. Start a live session.
- **Expected:** PWA detects `downlink < 1.2 Mbps` or `RTT > 350 ms`, pauses continuous WebRTC streaming, switches automatically to **3-Shot High-Contrast Burst Mode**, and speaks: *"Network latency is high. Switching to 3-shot burst photography. Hold still for two seconds."*

### Test Case 2: Ontology Graph Feedback Loop (M4 vs M6 Screw)
- **Steps:** Inspect a fastener misidentified as `M6 Hex Socket Cap Screw`. Tap its bounding box → select **Correct to M4 Machine Screw**.
- **Expected:** Client sends `POST /api/ontology/feedback`. Backend generates a multimodal embedding (`gemini-embedding-2` when API key is configured) and executes `apply_ontology_correction(...)` in PostgreSQL. Subsequent RAG scan immediately ranks `M4 Machine Screw` #1 without retraining.

### Test Case 3: Zero-Token Decisions API Routing (`gemini-decision-1` → `gemini-4-neon`)
- **Steps:** Keep hands completely stationary for ≥3–5 seconds (or tap **Scan Problem**).
- **Expected:**
  1. Wasm motion detector registers stillness (`delta < 2.2%` for `>= 3.0s`) and uploads the 15-second rolling frame buffer to `POST /api/analyze-buffer`.
  2. Backend calls `decisionsAi.decisions.create({ model: "gemini-decision-1", ... })` on `v1beta` (`total_output_tokens === 0`).
  3. Only when `user_stalled`, `hazard_proximity`, or `alignment_anomaly` exceeds the `0.78` confidence threshold does the server invoke `gemini-4-neon` with PostgreSQL RAG context.
  4. When no scale anchor (WebXR depth, coin, credit card, or thumb) is active, **Break 2 Scale Guard** redacts exact tool sizes and prompts the user to place a scale anchor.

### Test Case 4: Native Two-Way Multilingual Voice Assist (`POST /api/voice-assist`)
- **Steps:**
  1. On the MakerLens Magic Window camera screen, press and hold the **Hold to Explain** microphone button and speak a repair question in a non-English language (e.g., Spanish: *"Hola, este tornillo no gira y parece atascado. ¿Qué hago?"* or French/Japanese) even if the browser locale (`preferredLanguage`) is `en-US`.
  2. Release the button.
- **Expected:**
  1. Client stops `MediaRecorder`, Base64-encodes the audio `Blob` + current camera JPEG frame(s), and sends `POST /api/voice-assist` with `Accept: audio/wav`.
  2. `gemini-4-neon` detects the spoken language from the audio itself (`detectedLanguageCode`, e.g., `es-ES`), ignoring the English `preferredLanguage` fallback, and produces a direct, actionable mechanic reply under 3 sentences in that exact language.
  3. `gemini-3.8-flash-lite-tts` synthesizes 24 kHz mono 16-bit RIFF WAV speech with `speech_config: [{ language: detectedLanguageCode, voice: 'Kore' }]`.
  4. Response returns HTTP `200`, `Content-Type: audio/wav`, valid `RIFF`/`WAVE` header, and headers `X-MakerLens-Language` (`es-ES`), `X-MakerLens-Language-Name` (`Spanish`), and URL-encoded `X-MakerLens-Transcript` in Spanish.
  5. Hidden `<audio>` element auto-plays the WAV response and the caption card displays `Speaking · Spanish` (or `Mechanic Guidance · Spanish`).

### Automated Unit Test Suite
Run all pure-logic tests before every release:
```bash
npx --yes tsx --test \
  src/lib/audioUtils.test.ts \
  src/lib/dbConfig.test.ts \
  src/lib/makerLensState.test.ts \
  src/lib/routingLogic.test.ts
node --check server.js
```

---

## 5. Incident Response Playbooks

### Incident A: Gemini API `429 RESOURCE_EXHAUSTED` or `403 PERMISSION_DENIED`
1. Confirm `GEMINI_API_KEY` in Google Secret Manager points to a billing-enabled project with access to `gemini-4-neon`, `gemini-decision-1`, `gemini-3.8-flash-lite-tts`, and `gemini-omni-1.2-flash`.
2. Verify Wasm motion gating is active on clients (check ratio `neon_calls_count / decision_calls_count`; target `< 0.20`).
3. Never synthesize fake `noul` probabilities or fallback diagnoses—return HTTP `429`/`503` so the PWA guides the user cleanly.

### Incident B: Mobile Browser Thermal Dimming Spike (Break 1 Regression)
1. Audit `captureFps` telemetry on iOS Safari sessions. Ensure continuous streaming caps at `5 fps` under `fair` thermal pressure and drops to `burst_photo_3x` under `serious`/`critical` pressure.
2. Confirm `MediaRecorder` / canvas capture resolution does not exceed `640x360` for the 15-second ring buffer.

### Incident C: Scale Hallucination Report (Break 2 Regression)
1. Query `diagnostic_sessions` where `scale_anchor_type = 'none'` and `has_webxr_depth = FALSE`.
2. Verify `rag_search_ontology_subgraph(..., has_scale_anchor => FALSE)` returns `scale_guard_active = TRUE` and redacted `tool_size_spec`.
3. Add the misclassified fastener pair into `component_edges` with `relationship_type = 'often_confused_with'`.

### Incident D: Cloud SQL Connection Pool Saturation or Socket Mount Failure
1. Confirm `server.ts` / `server.js` uses `pg.Pool` with `max: 10` per Cloud Run container and `--max-instances` stays within `max_connections / 10`.
2. Verify `GET /api/db/status` reports `connected: true` and the expected `transport` (`cloudsql-unix-socket` on Cloud Run with `--add-cloudsql-instances`, or `public-ip-tls` over `34.74.102.222:5432`).
3. Ensure no typo exists in `DB_HOST` / `SQL_CONNECTION_NAME` (must match `gemini4nyc26nyc-2273:us-east1:free-trial-first-project`).

### Incident E: Voice Assist Wrong Language or TTS `400 INVALID_ARGUMENT`
1. Inspect `X-MakerLens-Language` and `X-MakerLens-Transcript` on `POST /api/voice-assist` responses.
2. Verify `gemini-3.8-flash-lite-tts` calls use `response_format: { type: 'audio' }` (never uppercase `response_modalities: ["AUDIO"]`) and a normalized BCP-47 tag from `normalizeBcp47Language()` (e.g., `es-ES`, `ja-JP`, `zh-CN` without script subtags like `zh-Hans-CN`).
3. If a browser blocks `<audio>.play()` autoplay policy after an async round-trip, verify the user can tap the replay speaker icon on the spoken caption card to trigger playback within a direct user gesture.
4. Confirm incoming `MediaRecorder` audio clips are ≤10 MB (`MAX_AUDIO_UPLOAD_BYTES`) and have codec suffixes stripped by `normalizeAudioMimeType()` before reaching `gemini-4-neon`.

---

## 6. AGPL-3.0 Network Compliance Checklist

Because JackOfAllTrades / MakerLens is licensed under **GNU AGPL-3.0**, any organization modifying and hosting this service over a network (including Google Cloud Run deployments) MUST:
- Preserve the `LICENSE` file and AGPL-3.0 copyright notices in all source files.
- Provide a visible link in the PWA footer and `/api/source-disclosure` endpoint offering the complete Corresponding Source of the deployed revision at no charge.

