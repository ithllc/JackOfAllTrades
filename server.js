/**
 * =============================================================================
 * JackOfAllTrades — Production Node.js / Express Backend (Google Cloud Run)
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Architecture Traceability:
 *  - ADR 001 (PostgreSQL + pgvector): Uses pg.Pool (Object Method) to query
 *    Recursive CTEs (`v_component_hierarchy`, `rag_search_ontology_subgraph`)
 *    and update embeddings transactionally via `apply_ontology_correction`.
 *  - ADR 002 (Google Cloud Run): Stateless HTTP/2 Express container listening
 *    on `process.env.PORT || 8080`, serving the compiled Vite PWA (`dist/`)
 *    and relaying WebRTC SDP/ICE signaling messages.
 *  - ADR 003 & Test Case 3 (Zero-Token Routing): Proxies the client's 15-second
 *    frame buffer to `gemini-decision-1` (v1beta Decisions API, 0 output tokens).
 *    ONLY calls `gemini-4-neon` if the Decisions model returns a high-confidence
 *    anomaly (>= 0.78) or the user explicitly asks a voice question.
 *  - Break 2 ("Scale" Hallucination Guard): Bars specific tool size advice when
 *    both WebXR depth and physical scale anchors (coin, credit card, thumb) are absent.
 * =============================================================================
 */

import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const ANOMALY_CONFIDENCE_THRESHOLD = 0.78;

// -----------------------------------------------------------------------------
// 1. PostgreSQL Connection Pool (ADR 001 — Cloud SQL Auth Proxy + Public IP TLS)
//    Instance: gemini4nyc26nyc-2273:us-east1:free-trial-first-project
//    Public IP: 34.74.102.222 | Outgoing IP: 34.73.184.213 | Port: 5432
// -----------------------------------------------------------------------------
const DEFAULT_SQL_PORT = 5432;
const DEFAULT_SQL_CONNECTION_NAME = 'gemini4nyc26nyc-2273:us-east1:free-trial-first-project';
const DEFAULT_SQL_PUBLIC_IP = '34.74.102.222';
const DEFAULT_SQL_OUTGOING_IP = '34.73.184.213';
const LOCAL_SQL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const PLACEHOLDER_SQL_SECRETS = new Set([
  'CHANGE_ME_IN_SECRET_MANAGER',
  'MY_SQL_PASSWORD',
  'REPLACE_ME',
]);

function resolveCloudSqlPoolConfig(env) {
  const connectionName = (
    env.SQL_CONNECTION_NAME ||
    env.SQL_Connection_Name ||
    DEFAULT_SQL_CONNECTION_NAME
  ).trim();
  const publicIp = (env.SQL_PUBLIC_IP || DEFAULT_SQL_PUBLIC_IP).trim();
  const outgoingIp = (
    env.SQL_OUTGOING_IP ||
    env.SQL_Outgoing_IP ||
    DEFAULT_SQL_OUTGOING_IP
  ).trim();
  const parsedPort = Number.parseInt(String(env.SQL_PORT || DEFAULT_SQL_PORT), 10);
  const port =
    Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535
      ? parsedPort
      : DEFAULT_SQL_PORT;

  const database = env.SQL_DB_NAME?.trim() || '';
  const user = env.SQL_USER?.trim() || '';
  const password = env.SQL_PASSWORD;
  const explicitHost = env.SQL_HOST?.trim() || '';
  const socketPath = `/cloudsql/${connectionName}`;
  const useUnixSocket =
    env.SQL_USE_UNIX_SOCKET?.trim().toLowerCase() === 'true' ||
    (Boolean(env.K_SERVICE?.trim()) && fs.existsSync(socketPath));

  if (!database || !user || (password && PLACEHOLDER_SQL_SECRETS.has(password.trim()))) {
    return {
      poolConfig: null,
      transport: 'unconfigured',
      connectionName,
      publicIp,
      outgoingIp,
      port,
      sslEnabled: false,
      hostSummary: useUnixSocket ? socketPath : `${publicIp}:${port}`,
    };
  }

  let host;
  let transport;
  if (explicitHost) {
    host = explicitHost;
    transport = explicitHost.startsWith('/cloudsql/')
      ? 'cloud_sql_socket'
      : explicitHost === publicIp
        ? 'public_ip_tcp'
        : 'custom_tcp';
  } else if (useUnixSocket) {
    host = socketPath;
    transport = 'cloud_sql_socket';
  } else {
    host = publicIp;
    transport = 'public_ip_tcp';
  }

  if (transport === 'cloud_sql_socket') {
    return {
      poolConfig: {
        host,
        database,
        user,
        password,
        max: 10,
        connectionTimeoutMillis: 15000,
        idleTimeoutMillis: 30000,
        ssl: false,
      },
      transport,
      connectionName,
      publicIp,
      outgoingIp,
      port,
      sslEnabled: false,
      hostSummary: host,
    };
  }

  const sslCa = env.SQL_SSL_CA?.trim();
  const sslFlag = env.SQL_SSL?.trim().toLowerCase();
  const isLocalHost = LOCAL_SQL_HOSTS.has(host.toLowerCase());
  let ssl = false;
  if (sslCa) ssl = { ca: sslCa, rejectUnauthorized: true };
  else if (sslFlag === 'false') ssl = false;
  else if (sslFlag === 'true' || !isLocalHost) ssl = { rejectUnauthorized: false };

  return {
    poolConfig: {
      host,
      port,
      database,
      user,
      password,
      max: 10,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
      ssl,
    },
    transport,
    connectionName,
    publicIp,
    outgoingIp,
    port,
    sslEnabled: Boolean(ssl),
    hostSummary: `${host}:${port}`,
  };
}

const cloudSqlConfig = resolveCloudSqlPoolConfig(process.env);
const pool = cloudSqlConfig.poolConfig ? new Pool(cloudSqlConfig.poolConfig) : null;

if (pool) {
  pool.on('error', (err) => {
    console.error('[Cloud SQL Pool Error]', err.message);
  });
}

// -----------------------------------------------------------------------------
// 2. Gemini 4 API Clients (Server-Side Key Isolation — Technical Doc §1)
// -----------------------------------------------------------------------------
function initGeminiClients() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  // Decisions API (`gemini-decision-1`) requires `apiVersion: 'v1beta'` on @google/genai >= 3.2.0
  const decisionsAi = new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
    },
  });

  // Interactions API client for `gemini-4-neon`, `gemini-omni-1.2-flash`, and `gemini-embedding-2`
  const interactionsAi = new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
    },
  });

  return { decisionsAi, interactionsAi };
}

function parseBase64Frame(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (match) return { mimeType: match[1], base64: match[2] };
  return { mimeType: 'image/jpeg', base64: String(dataUrl || '') };
}

/**
 * Enforces Break 2 ("Scale" Hallucination Guard):
 * Without WebXR depth mapping or a physical scale anchor (coin, credit card, thumb),
 * strip exact numeric tool sizes before returning instructions to the PWA.
 */
function enforceScaleAnchorGuard(diagnosis, scaleAnchor, hasWebXRDepth) {
  const hasReference = Boolean(hasWebXRDepth) || (scaleAnchor && scaleAnchor !== 'none');
  if (diagnosis.requiresScaleAnchor && !hasReference) {
    return {
      ...diagnosis,
      toolSizeSpec: 'REDACTED — Place scale anchor (coin, credit card, or thumb) first',
      scaleGuardBlocked: true,
      nextStepInstruction:
        'Place a standard scale anchor (a coin, credit card, or your thumb) next to the part so JackOfAllTrades can safely verify tool sizing.',
    };
  }
  return { ...diagnosis, scaleGuardBlocked: false };
}

const app = express();
app.use(express.json({ limit: '25mb' }));

// Ephemeral WebRTC SDP/ICE signaling store (ADR 002)
const rtcRooms = new Map();

// -----------------------------------------------------------------------------
// 3. Healthcheck & WebRTC Signaling Routes (ADR 002)
// -----------------------------------------------------------------------------
app.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'jackofalltrades',
    license: 'AGPL-3.0-only',
    port: PORT,
    databaseConnected: Boolean(pool),
    databaseTransport: cloudSqlConfig.transport,
    sqlConnectionName: cloudSqlConfig.connectionName,
    sqlPublicIp: cloudSqlConfig.publicIp,
    sqlOutgoingIp: cloudSqlConfig.outgoingIp,
    sqlPort: cloudSqlConfig.port,
    sqlSslEnabled: cloudSqlConfig.sslEnabled,
    sqlTarget: cloudSqlConfig.hostSummary,
  });
});

app.get('/api/db/status', async (_req, res) => {
  if (!pool) {
    return res.json({
      connected: false,
      configured: false,
      transport: cloudSqlConfig.transport,
      connectionName: cloudSqlConfig.connectionName,
      publicIp: cloudSqlConfig.publicIp,
      outgoingIp: cloudSqlConfig.outgoingIp,
      port: cloudSqlConfig.port,
    });
  }
  try {
    const { rows } = await pool.query(
      "SELECT current_database() AS database_name, current_user AS db_user, EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS pgvector_enabled"
    );
    return res.json({
      connected: true,
      configured: true,
      transport: cloudSqlConfig.transport,
      connectionName: cloudSqlConfig.connectionName,
      target: cloudSqlConfig.hostSummary,
      sslEnabled: cloudSqlConfig.sslEnabled,
      details: rows[0] ?? null,
    });
  } catch (err) {
    return res.status(503).json({
      connected: false,
      configured: true,
      transport: cloudSqlConfig.transport,
      connectionName: cloudSqlConfig.connectionName,
      target: cloudSqlConfig.hostSummary,
      sslEnabled: cloudSqlConfig.sslEnabled,
      error: err.message,
    });
  }
});

app.post('/api/webrtc/signal', (req, res) => {
  const { roomId, type, payload } = req.body ?? {};
  if (!roomId || !type) {
    return res.status(400).json({ error: 'roomId and type are required.' });
  }
  const room = rtcRooms.get(roomId) ?? { candidates: [], updatedAt: Date.now() };
  if (type === 'offer') room.offer = payload;
  else if (type === 'answer') room.answer = payload;
  else if (type === 'ice-candidate') room.candidates.push(payload);
  room.updatedAt = Date.now();
  rtcRooms.set(roomId, room);
  return res.json({ roomId, status: 'relayed' });
});

// -----------------------------------------------------------------------------
// 4. Core 15-Second Buffer Proxy: `gemini-decision-1` -> `gemini-4-neon`
//    Fulfills ADR 003, Break 1 (Thermal/Cost Gate), and QA Test Case 3
// -----------------------------------------------------------------------------
app.post('/api/analyze-buffer', async (req, res) => {
  const {
    frames = [],
    ingestMode = 'webrtc_15fps',
    scaleAnchor = 'none',
    hasWebXRDepth = false,
    stillDurationMs = 0,
    userQuestion = '',
  } = req.body ?? {};

  if (!Array.isArray(frames) || frames.length === 0) {
    return res.status(400).json({ error: 'Expected 15-second frame buffer array.' });
  }

  const clients = initGeminiClients();
  if (!clients) {
    return res.status(503).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
  }

  // Uniformly sample up to 6 frames spanning the 15-second rolling ring buffer
  const stride = Math.max(1, Math.floor(frames.length / 6));
  const sampled = frames.filter((_f, i) => i % stride === 0).slice(0, 6);

  const multimodalInput = [
    {
      type: 'text',
      text:
        `JackOfAllTrades 15-second camera buffer (${sampled.length} frames, mode=${ingestMode}, ` +
        `handStillMs=${stillDurationMs}, scaleAnchor=${scaleAnchor}, webXRDepth=${Boolean(hasWebXRDepth)}).` +
        (userQuestion ? ` User question: ${userQuestion}\n` : '\n'),
    },
    ...sampled.map((frame) => {
      const { mimeType, base64 } = parseBase64Frame(frame.dataUrl);
      return {
        type: 'image',
        data: base64,
        mime_type: mimeType,
        resolution: ingestMode === 'burst_photo_3x' ? 'medium' : 'low',
      };
    }),
  ];

  // --- STAGE 1: Zero-Token Gate via `gemini-decision-1` (0 output tokens) ---
  let scores;
  let decisionUsage;
  try {
    const decision = await clients.decisionsAi.decisions.create({
      model: 'gemini-decision-1',
      input: multimodalInput,
      questions: {
        user_stalled: {
          type: 'noul',
          instructions: 'Has the user stalled or held hands motionless on an unresolved step?',
          criteria: {
            true_description: 'Hands stationary in hesitation or awaiting guidance.',
            false_description: 'User is actively progressing without confusion.',
          },
        },
        hazard_proximity: {
          type: 'noul',
          instructions: 'Are hands or tools near a hazard or forcing a fastener/clip incorrectly?',
        },
        alignment_anomaly: {
          type: 'noul',
          instructions: 'Is there a misaligned bracket, wrong tool size, or cross-threaded fastener?',
        },
        visual_noise_extreme: {
          type: 'noul',
          instructions: 'Are water droplets, harsh chrome glare, or blur obscuring the component?',
        },
      },
    });

    if (!decision.answers) {
      return res.status(400).json({ error: 'Decisions API returned no answers.' });
    }

    const noul = (k) => (decision.answers[k]?.type === 'noul' ? decision.answers[k].noul : 0.01);
    scores = {
      userStalled: noul('user_stalled'),
      hazardProximity: noul('hazard_proximity'),
      alignmentAnomaly: noul('alignment_anomaly'),
      visualNoiseExtreme: noul('visual_noise_extreme'),
    };
    decisionUsage = decision.usage ?? { total_output_tokens: 0 };
  } catch (err) {
    return res.status(502).json({
      error: `gemini-decision-1 call failed: ${err.message}`,
    });
  }

  // Hardest Input Mitigation: Downgrade to 3-shot burst mode on extreme visual noise
  if (scores.visualNoiseExtreme >= ANOMALY_CONFIDENCE_THRESHOLD) {
    return res.json({
      escalatedToNeon: false,
      downgradeToBurst: true,
      decisionModel: 'gemini-decision-1',
      decisionScores: scores,
      decisionUsage,
      voiceInstruction:
        "I can't see the threading clearly. Wipe the lens and hold still for three high-contrast burst photos.",
    });
  }

  // Strict High-Confidence Anomaly Gate (ADR 003): Stay zero-token if below 0.78
  const maxAnomaly = Math.max(scores.userStalled, scores.hazardProximity, scores.alignmentAnomaly);
  const highConfidenceAnomaly = maxAnomaly >= ANOMALY_CONFIDENCE_THRESHOLD;

  if (!highConfidenceAnomaly && !String(userQuestion).trim()) {
    return res.json({
      escalatedToNeon: false,
      downgradeToBurst: false,
      decisionModel: 'gemini-decision-1',
      decisionScores: scores,
      decisionUsage,
      message: 'Nominal stream verified with zero output tokens. gemini-4-neon kept asleep.',
    });
  }

  // --- STAGE 2: Retrieve PostgreSQL pgvector + Recursive CTE RAG Subgraph (ADR 001) ---
  let ragContext = [];
  if (pool) {
    try {
      const { mimeType, base64 } = parseBase64Frame(sampled[sampled.length - 1].dataUrl);
      const emb = await clients.interactionsAi.models.embedContent({
        model: 'gemini-embedding-2',
        contents: [{ inlineData: { data: base64, mimeType } }],
      });
      const vec = emb.embeddings?.[0]?.values?.slice(0, 768);
      if (Array.isArray(vec) && vec.length === 768) {
        const hasAnchor = Boolean(hasWebXRDepth) || scaleAnchor !== 'none';
        const { rows } = await pool.query(
          'SELECT * FROM rag_search_ontology_subgraph($1::vector, $2, 0.55, 5)',
          [`[${vec.join(',')}]`, hasAnchor]
        );
        ragContext = rows;
      }
    } catch (dbErr) {
      console.warn('[Ontology RAG warning]', dbErr.message);
    }
  }

  // --- STAGE 3: Wake `gemini-4-neon` (The Brain) with 15s Buffer + RAG Subgraph ---
  try {
    const hasScaleRef = Boolean(hasWebXRDepth) || scaleAnchor !== 'none';
    const neonInteraction = await clients.interactionsAi.interactions.create({
      model: 'gemini-4-neon',
      system_instruction:
        'You are JackOfAllTrades. Diagnose the physical component and provide the next corrective action. ' +
        (hasScaleRef
          ? 'Scale anchor verified; exact tool sizes are permitted.'
          : 'BREAK 2 GUARD: No scale anchor or WebXR depth detected. Do NOT suggest a numeric tool size; instruct the user to place a coin, credit card, or thumb beside the part.'),
      input: [
        ...multimodalInput,
        {
          type: 'text',
          text: `PostgreSQL Ontology RAG context:\n${JSON.stringify(ragContext, null, 2)}`,
        },
      ],
      response_format: {
        type: Type.OBJECT,
        properties: {
          componentName: { type: Type.STRING },
          diagnosisSummary: { type: Type.STRING },
          nextStepInstruction: { type: Type.STRING },
          toolRequired: { type: Type.STRING },
          toolSizeSpec: { type: Type.STRING },
          requiresScaleAnchor: { type: Type.BOOLEAN },
          pipMotionPrompt: { type: Type.STRING },
          voiceCoachingLine: { type: Type.STRING },
        },
        required: ['componentName', 'diagnosisSummary', 'nextStepInstruction', 'toolRequired', 'requiresScaleAnchor', 'pipMotionPrompt'],
      },
      generation_config: { thinking_level: 'medium' },
    });

    const parsed = JSON.parse(neonInteraction.output_text || '{}');
    const safeDiagnosis = enforceScaleAnchorGuard(parsed, scaleAnchor, hasWebXRDepth);

    return res.json({
      escalatedToNeon: true,
      downgradeToBurst: false,
      decisionModel: 'gemini-decision-1',
      reasoningModel: 'gemini-4-neon',
      decisionScores: scores,
      decisionUsage,
      ragMatches: ragContext,
      diagnosis: safeDiagnosis,
    });
  } catch (err) {
    return res.status(502).json({
      error: `gemini-4-neon call failed: ${err.message}`,
      decisionScores: scores,
    });
  }
});

// -----------------------------------------------------------------------------
// 5. Ontology Graph Feedback Loop (PRD §2 / QA Test Case 2: M4 vs M6 Screw)
// -----------------------------------------------------------------------------
app.post('/api/ontology/feedback', async (req, res) => {
  const { predictedComponentId, correctedComponentId, tag, frameDataUrl, regionCode = 'GLOBAL' } =
    req.body ?? {};

  if (!correctedComponentId || !tag) {
    return res.status(400).json({ error: 'correctedComponentId and tag are required.' });
  }

  const clients = initGeminiClients();
  if (!clients || !pool) {
    return res.status(503).json({
      error: 'Both PostgreSQL (SQL_HOST) and GEMINI_API_KEY must be configured for production ontology updates.',
    });
  }

  try {
    const { mimeType, base64 } = parseBase64Frame(frameDataUrl);
    const emb = await clients.interactionsAi.models.embedContent({
      model: 'gemini-embedding-2',
      contents: [
        `Corrected physical component: ${tag}`,
        ...(base64 ? [{ inlineData: { data: base64, mimeType } }] : []),
      ],
    });
    const vector768 = emb.embeddings?.[0]?.values?.slice(0, 768);
    const { rows } = await pool.query(
      'SELECT * FROM apply_ontology_correction($1, $2, $3, $4, $5::vector, $6)',
      [
        null,
        predictedComponentId || null,
        Number(correctedComponentId),
        String(tag).slice(0, 80),
        `[${vector768.join(',')}]`,
        String(regionCode).slice(0, 32),
      ]
    );
    return res.json({ status: 'updated', result: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: `Ontology feedback update failed: ${err.message}` });
  }
});

// -----------------------------------------------------------------------------
// 6. Live Spatial Output: PiP Hand-Motion Loop via `gemini-omni-1.2-flash`
// -----------------------------------------------------------------------------
app.post('/api/generate-pip', async (req, res) => {
  const { prompt, referenceFrameDataUrl } = req.body ?? {};
  const clients = initGeminiClients();
  if (!clients) {
    return res.status(503).json({ error: 'GEMINI_API_KEY is not configured.' });
  }

  try {
    const input = [];
    if (referenceFrameDataUrl) {
      const { mimeType, base64 } = parseBase64Frame(referenceFrameDataUrl);
      input.push({ type: 'image', mime_type: mimeType, data: base64 });
    }
    input.push({ type: 'text', text: String(prompt) });

    const interaction = await clients.interactionsAi.interactions.create(
      {
        model: 'gemini-omni-1.2-flash',
        input,
        background: false,
        store: false,
        stream: false,
        response_format: {
          type: 'video',
          aspect_ratio: '16:9',
          duration: '6s',
          resolution: '720p',
        },
      },
      { timeout: 300000 }
    );

    const video = interaction.output_video;
    return res.json({
      model: 'gemini-omni-1.2-flash',
      mimeType: video?.mime_type || 'video/mp4',
      videoDataUrl: video?.data ? `data:${video.mime_type || 'video/mp4'};base64,${video.data}` : null,
      videoUri: video?.uri || null,
    });
  } catch (err) {
    return res.status(502).json({ error: `PiP video generation failed: ${err.message}` });
  }
});

// -----------------------------------------------------------------------------
// 7. Serve Compiled Vite React PWA (`dist/`) on Google Cloud Run Port 8080
// -----------------------------------------------------------------------------
const distDir = path.join(__dirname, 'dist');
app.use(express.static(distDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[JackOfAllTrades] Cloud Run backend listening on port ${PORT}`);
});
