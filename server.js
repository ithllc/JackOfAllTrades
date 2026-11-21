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
  const parsedPort = Number.parseInt(
    String(env.SQL_PORT || env.DB_PORT || DEFAULT_SQL_PORT),
    10
  );
  const port =
    Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535
      ? parsedPort
      : DEFAULT_SQL_PORT;

  const database = (env.SQL_DB_NAME || env.DB_NAME || '').trim();
  const user = (env.SQL_USER || env.DB_USER || '').trim();
  const password = env.SQL_PASSWORD ?? env.DB_PASS;
  const explicitHost = (env.SQL_HOST || env.DB_HOST || '').trim();
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

  const sslCa = (env.SQL_SSL_CA || env.DB_SSL_CA || '').trim();
  const sslFlag = (env.SQL_SSL ?? env.DB_SSL)?.trim().toLowerCase();
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
// 6b. Native Two-Way Audio: Push-to-Talk Visual + Audio -> Generated Speech (WAV)
//     Audio Encoding/Decoding Flow:
//       - Client MediaRecorder records microphone audio as a Blob (audio/webm or audio/mp4)
//         and Base64-encodes it alongside sampled JPEG camera frames.
//       - Server strips data-URL headers, normalizes MIME (removing `;codecs=opus`),
//         and sends BOTH inline `image` parts AND the raw inline `audio` part to
//         `gemini-4-neon` with the strict expert mechanic system prompt.
//       - Server synthesizes spoken WAV audio via `gemini-3.8-flash-lite-tts` with
//         `response_format: { type: 'audio' }` (complete 24kHz mono 16-bit RIFF WAV).
//       - Server decodes the Base64 WAV via `Buffer.from(data, 'base64')` and pipes
//         raw binary `audio/wav` bytes back when `Accept: audio/*` is sent (or JSON Base64).
// -----------------------------------------------------------------------------
const EXPERT_MECHANIC_SYSTEM_PROMPT =
  "You are an expert mechanic. Detect the exact spoken language of the user's audio query and respond in that exact same language using the visual context provided. Keep your spoken response under 3 sentences. Be direct and actionable.";

const SHORT_LANGUAGE_DEFAULTS = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-BR',
  ja: 'ja-JP',
  ko: 'ko-KR',
  zh: 'zh-CN',
  ar: 'ar-EG',
  hi: 'hi-IN',
  ru: 'ru-RU',
  nl: 'nl-NL',
  pl: 'pl-PL',
  tr: 'tr-TR',
  vi: 'vi-VN',
  th: 'th-TH',
  id: 'id-ID',
  uk: 'uk-UA',
  sv: 'sv-SE',
};

function normalizeBcp47Language(rawCode, fallback = 'en-US') {
  const safeFallback = /^[a-z]{2,3}-[A-Z]{2}$/.test(fallback) ? fallback : 'en-US';
  if (!rawCode || typeof rawCode !== 'string') return safeFallback;
  const cleaned = rawCode.trim().replace(/_/g, '-');
  if (!cleaned) return safeFallback;
  const lower = cleaned.toLowerCase();
  if (/^[a-z]{2}$/.test(lower)) {
    return SHORT_LANGUAGE_DEFAULTS[lower] ?? `${lower}-${lower.toUpperCase()}`;
  }
  const parts = cleaned.split('-').filter(Boolean);
  if (parts.length === 2 && /^[a-z]{2,3}$/i.test(parts[0]) && /^[a-z0-9]{2,4}$/i.test(parts[1])) {
    return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
  }
  if (parts.length === 3 && /^[a-z]{2,3}$/i.test(parts[0]) && /^[a-z]{2}$/i.test(parts[2])) {
    return `${parts[0].toLowerCase()}-${parts[2].toUpperCase()}`;
  }
  return safeFallback;
}

function parseBase64Audio(rawInput, fallbackMime = 'audio/webm') {
  const trimmed = String(rawInput || '').trim();
  const match = trimmed.match(/^data:([^,]+);base64,(.+)$/i);
  const rawMime = match ? match[1] : fallbackMime;
  const base64 = (match ? match[2] : trimmed).replace(/\s+/g, '');
  const baseMime = String(rawMime || 'audio/webm').split(';')[0].trim().toLowerCase();
  const mimeType = baseMime === 'audio/x-wav' ? 'audio/wav' : baseMime || 'audio/webm';
  return { mimeType, base64 };
}

function capToThreeSentences(rawText) {
  const clean = String(rawText || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return 'Hold steady with a little more light and tell me what feels stuck.';
  const sentences = clean.match(/[^.!?。！？؟।]+[.!?。！？؟।]+|[^.!?。！？؟।]+$/g) ?? [clean];
  return sentences.map((s) => s.trim()).filter(Boolean).slice(0, 3).join(' ');
}

app.post('/api/voice-assist', async (req, res) => {
  const {
    frames = [],
    audio,
    audioDataUrl,
    audioBase64,
    audioMimeType = 'audio/webm',
    preferredLanguage,
    format,
  } = req.body ?? {};

  const rawAudio =
    typeof audio === 'string'
      ? audio
      : typeof audio?.data === 'string'
        ? audio.data
        : typeof audioDataUrl === 'string'
          ? audioDataUrl
          : typeof audioBase64 === 'string'
            ? audioBase64
            : '';

  const fallbackLanguage = normalizeBcp47Language(
    typeof preferredLanguage === 'string' ? preferredLanguage : undefined,
    'en-US'
  );

  const { mimeType: cleanAudioMime, base64: cleanAudioBase64 } = parseBase64Audio(
    rawAudio,
    (typeof audio === 'object' && audio?.mimeType) || audioMimeType
  );

  if (cleanAudioBase64.length < 16) {
    return res.status(400).json({ error: 'Recording was too short. Hold the button while speaking.' });
  }

  const clients = initGeminiClients();
  if (!clients) {
    return res.status(503).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
  }

  // Sample up to 4 recent video frames from the client's rolling buffer
  const safeFrames = Array.isArray(frames) ? frames : [];
  const stride = Math.max(1, Math.floor(safeFrames.length / 4));
  const sampled = safeFrames.filter((_f, i) => i % stride === 0).slice(0, 4);

  const multimodalInput = [
    ...sampled
      .filter((f) => typeof f?.dataUrl === 'string' && f.dataUrl.length >= 32)
      .map((frame) => {
        const { mimeType, base64 } = parseBase64Frame(frame.dataUrl);
        return { type: 'image', data: base64, mime_type: mimeType, resolution: 'medium' };
      }),
    // Raw microphone audio passed as an inline audio part alongside visual frames
    { type: 'audio', data: cleanAudioBase64, mime_type: cleanAudioMime },
    {
      type: 'text',
      text:
        '1. Listen carefully to the attached audio clip. Set speechDetected=true ONLY if intelligible human speech is actually audible; set speechDetected=false if the clip is silent or contains only noise.\n' +
        '2. If speechDetected=true, write the exact verbatim words heard in userTranscript (in the original spoken language) and set detectedLanguageCode to the matching BCP-47 tag (e.g., "es-ES", "es-MX", "fr-FR", "ja-JP", "de-DE", "pt-BR", "zh-CN", "ar-EG", "hi-IN", "en-US").\n' +
        `3. If speechDetected=false, set userTranscript="", set detectedLanguageCode="${fallbackLanguage}", do NOT invent a repair problem, and write a brief polite prompt in "${fallbackLanguage}" asking the user to hold the button and speak closer to the microphone.\n` +
        '4. Write spokenResponse STRICTLY in detectedLanguageCode — never switch languages. Keep spokenResponse under 3 short, direct, actionable sentences with no markdown.',
    },
  ];

  let spokenText;
  let detectedLanguageCode = fallbackLanguage;
  let detectedLanguageName = 'Auto';
  try {
    const reasoning = await clients.interactionsAi.interactions.create({
      model: 'gemini-4-neon',
      system_instruction: EXPERT_MECHANIC_SYSTEM_PROMPT,
      input: multimodalInput,
      store: false,
      generation_config: { thinking_level: 'low' },
      response_format: {
        type: Type.OBJECT,
        properties: {
          speechDetected: { type: Type.BOOLEAN },
          userTranscript: { type: Type.STRING },
          detectedLanguageCode: { type: Type.STRING },
          detectedLanguageName: { type: Type.STRING },
          spokenResponse: { type: Type.STRING },
        },
        required: [
          'speechDetected',
          'userTranscript',
          'detectedLanguageCode',
          'detectedLanguageName',
          'spokenResponse',
        ],
      },
    });
    const rawOutput = reasoning.output_text || '';
    try {
      const parsed = JSON.parse(rawOutput);
      const rawCode =
        parsed.speechDetected === false ? fallbackLanguage : parsed.detectedLanguageCode;
      detectedLanguageCode = normalizeBcp47Language(rawCode, fallbackLanguage);
      detectedLanguageName = parsed.detectedLanguageName?.trim() || detectedLanguageCode;
      spokenText = capToThreeSentences(parsed.spokenResponse || rawOutput);
    } catch {
      spokenText = capToThreeSentences(rawOutput);
    }
  } catch (err) {
    return res.status(502).json({ error: `Multimodal voice analysis failed: ${err.message}` });
  }

  try {
    // Request native WAV audio output in the exact detected BCP-47 language
    const tts = await clients.interactionsAi.interactions.create({
      model: 'gemini-3.8-flash-lite-tts',
      input: [
        {
          type: 'text',
          text: spokenText,
          annotations: [
            {
              type: 'speech_metadata',
              style: `Calm, confident, direct expert mechanic speaking naturally in ${detectedLanguageName}`,
            },
          ],
        },
      ],
      store: false,
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ language: detectedLanguageCode, voice: 'Kore' }] },
    });

    const outputAudio = tts.output_audio;
    if (!outputAudio?.data) {
      return res.status(502).json({
        error: 'Gemini speech synthesis returned no audio.',
        spokenText,
        detectedLanguageCode,
        detectedLanguageName,
      });
    }

    const wavMime = outputAudio.mime_type || 'audio/wav';
    const wantsBinary =
      format === 'binary' ||
      (typeof req.headers.accept === 'string' && req.headers.accept.includes('audio/'));

    if (wantsBinary) {
      const wavBuffer = Buffer.from(outputAudio.data, 'base64');
      res.setHeader('Content-Type', wavMime);
      res.setHeader('Content-Length', String(wavBuffer.length));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-MakerLens-Transcript', encodeURIComponent(spokenText));
      res.setHeader('X-MakerLens-Language', detectedLanguageCode);
      res.setHeader('X-MakerLens-Language-Name', encodeURIComponent(detectedLanguageName));
      res.setHeader('X-MakerLens-Vision-Model', 'gemini-4-neon');
      res.setHeader('X-MakerLens-Speech-Model', 'gemini-3.8-flash-lite-tts');
      return res.status(200).send(wavBuffer);
    }

    return res.json({
      spokenText,
      detectedLanguageCode,
      detectedLanguageName,
      audioBase64: outputAudio.data,
      audioMimeType: wavMime,
      visionModel: 'gemini-4-neon',
      speechModel: 'gemini-3.8-flash-lite-tts',
    });
  } catch (err) {
    return res.status(502).json({
      error: `Speech synthesis failed: ${err.message}`,
      spokenText,
      detectedLanguageCode,
      detectedLanguageName,
    });
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
