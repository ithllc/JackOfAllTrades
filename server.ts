/**
 * JackOfAllTrades — Full-Stack Express + Vite Dev/Prod Server (TypeScript Runtime)
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Architecture Traceability:
 *  - ADR 001: Connects to PostgreSQL + pgvector via pg.Pool (Object Method) when SQL_HOST
 *    is configured; falls back cleanly to InMemoryOntologyGraph parity engine in local sandboxes.
 *  - ADR 002: Stateless Express API proxy + WebRTC signaling + Vite PWA host.
 *  - ADR 003 / Test Case 3: Proxies a 15-second rolling frame buffer to `gemini-decision-1`
 *    (v1beta Decisions API, 0 output tokens) and ONLY calls `gemini-4-neon` if the decision
 *    model returns a high-confidence anomaly (>= 0.78).
 *  - Break 2: Enforces Scale Anchor Guard server-side before returning tool size specs.
 */

import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { GoogleGenAI, Type } from '@google/genai';
import {
  ANOMALY_CONFIDENCE_THRESHOLD,
  InMemoryOntologyGraph,
  buildFeatureVector,
  enforceScaleAnchorInvariant,
  evaluateDecisionsRouting,
  type DecisionsCheckScores,
  type ScaleAnchorType,
} from './src/lib/routingLogic.ts';
import { resolveCloudSqlPoolConfig } from './src/lib/dbConfig.ts';
import {
  EXPERT_MECHANIC_SYSTEM_PROMPT,
  enforceThreeSentenceCap,
  normalizeBcp47Language,
  stripAudioDataUrl,
  validateAudioPayload,
} from './src/lib/audioUtils.ts';
import {
  DEMO_NARRATION_CUES,
  isValidDemoCueId,
} from './src/lib/demoNarration.ts';
import {
  mapDetectedObjectToScaleAnchor,
  resolveScaleCalibration,
  WHY_SCALE_MATTERS_SPOKEN,
  type ScaleCalibrationResult,
} from './src/lib/scaleCalibration.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

// -----------------------------------------------------------------------------
// PostgreSQL Pool (ADR 001 — Object Method, Cloud SQL Auth Proxy + Public IP TLS)
// -----------------------------------------------------------------------------
const cloudSqlConfig = resolveCloudSqlPoolConfig(process.env);
let pgPool: Pool | null = null;
if (cloudSqlConfig.poolConfig) {
  pgPool = new Pool(cloudSqlConfig.poolConfig);
  pgPool.on('error', (err) => {
    console.error('[PostgreSQL Pool Error]', err.message);
  });
}

// Local parity ontology store implementing the exact same Recursive CTE & cosine RAG rules
const localOntology = new InMemoryOntologyGraph();

// Ephemeral WebRTC signaling map (SDP offers/answers & ICE candidates per room)
const signalingRooms = new Map<
  string,
  { offer?: unknown; answer?: unknown; candidates: unknown[]; updatedAt: number }
>();

// -----------------------------------------------------------------------------
// Gemini 4 SDK Clients (Server-Side Only — API Key Never Exposed to Browser)
// -----------------------------------------------------------------------------
function getGeminiClients() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }

  // Dedicated v1beta client REQUIRED for Decisions API (gemini-decision-1)
  const decisionsAi = new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // Primary Interactions API client for gemini-4-neon, gemini-omni-1.2-flash, gemini-embedding-2
  // Uses v1beta to support flat multimodal input arrays ([{ type: 'text' }, { type: 'image' }])
  const interactionsAi = new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  return { decisionsAi, interactionsAi };
}

interface IncomingFrame {
  timestampMs: number;
  dataUrl: string; // data:image/jpeg;base64,...
  mimeType?: string;
}

function stripDataUrlPrefix(dataUrl: string): { mimeType: string; base64: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], base64: match[2] };
  }
  return { mimeType: 'image/jpeg', base64: dataUrl };
}

function extractErrorDetails(err: unknown): { status: number; message: string } {
  const anyErr = err as { status?: number; code?: number; message?: string };
  const status =
    typeof anyErr?.status === 'number' && anyErr.status >= 400 && anyErr.status < 600
      ? anyErr.status
      : typeof anyErr?.code === 'number' && anyErr.code >= 400 && anyErr.code < 600
        ? anyErr.code
        : 502;
  const rawMessage = anyErr?.message || 'Gemini API request failed.';
  return { status, message: rawMessage };
}

async function createApp() {
  const app = express();
  // Support 15-second frame buffers (up to 30 sampled JPEGs) + 3-shot high-contrast bursts
  app.use(express.json({ limit: '25mb' }));

  // ---------------------------------------------------------------------------
  // Health & AGPL-3.0 Corresponding Source Disclosure Endpoints
  // ---------------------------------------------------------------------------
  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'jackofalltrades',
      license: 'AGPL-3.0-only',
      postgresConfigured: Boolean(pgPool),
      databaseTransport: cloudSqlConfig.transport,
      sqlConnectionName: cloudSqlConfig.connectionName,
      sqlPublicIp: cloudSqlConfig.publicIp,
      sqlOutgoingIp: cloudSqlConfig.outgoingIp,
      sqlPort: cloudSqlConfig.port,
      sqlSslEnabled: cloudSqlConfig.sslEnabled,
      sqlTarget: cloudSqlConfig.hostSummary,
      geminiConfigured: Boolean(getGeminiClients()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/db/status', async (req: Request, res: Response) => {
    if (!pgPool) {
      return res.json({
        connected: false,
        configured: false,
        transport: cloudSqlConfig.transport,
        connectionName: cloudSqlConfig.connectionName,
        publicIp: cloudSqlConfig.publicIp,
        outgoingIp: cloudSqlConfig.outgoingIp,
        port: cloudSqlConfig.port,
        message:
          'Set DB_NAME/DB_USER/DB_PASS (or SQL_DB_NAME/SQL_USER/SQL_PASSWORD) in runtime secrets to enable live Cloud SQL queries. Falling back to InMemoryOntologyGraph.',
      });
    }

    try {
      const { rows } = await pgPool.query(
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
      const statusCode = req.query.strict === '1' ? 503 : 200;
      return res.status(statusCode).json({
        connected: false,
        configured: true,
        fallbackActive: true,
        transport: cloudSqlConfig.transport,
        connectionName: cloudSqlConfig.connectionName,
        target: cloudSqlConfig.hostSummary,
        sslEnabled: cloudSqlConfig.sslEnabled,
        error: (err as Error).message,
      });
    }
  });

  app.get('/api/deliverables', async (_req: Request, res: Response) => {
    const deliverablePaths: Record<string, string> = {
      'schema.sql': path.join(__dirname, 'schema.sql'),
      'server.js': path.join(__dirname, 'server.js'),
      'App.jsx': path.join(__dirname, 'App.jsx'),
      Dockerfile: path.join(__dirname, 'Dockerfile'),
      'docs/ARCHITECTURE.md': path.join(__dirname, 'docs', 'ARCHITECTURE.md'),
      'docs/RUNBOOK.md': path.join(__dirname, 'docs', 'RUNBOOK.md'),
      LICENSE: path.join(__dirname, 'LICENSE'),
    };

    try {
      const files: Record<string, string> = {};
      for (const [label, filePath] of Object.entries(deliverablePaths)) {
        try {
          files[label] = await fs.readFile(filePath, 'utf8');
        } catch {
          files[label] = `// File ${label} not found on disk.`;
        }
      }
      res.json({ license: 'AGPL-3.0-only', files });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load AGPL-3.0 source deliverables.' });
    }
  });

  // ---------------------------------------------------------------------------
  // WebRTC Signaling Relay (ADR 002: Stateless Cloud Run Signaling)
  // ---------------------------------------------------------------------------
  app.post('/api/webrtc/signal', (req: Request, res: Response) => {
    const { roomId, type, payload } = req.body ?? {};
    if (!roomId || typeof roomId !== 'string') {
      return res.status(400).json({ error: 'roomId is required for WebRTC signaling.' });
    }

    const room = signalingRooms.get(roomId) ?? { candidates: [], updatedAt: Date.now() };
    room.updatedAt = Date.now();

    if (type === 'offer') room.offer = payload;
    else if (type === 'answer') room.answer = payload;
    else if (type === 'ice-candidate' && payload) room.candidates.push(payload);
    else return res.status(400).json({ error: 'Unsupported signaling payload type.' });

    signalingRooms.set(roomId, room);
    return res.json({ roomId, status: 'relayed', candidateCount: room.candidates.length });
  });

  app.get('/api/webrtc/signal/:roomId', (req: Request, res: Response) => {
    const room = signalingRooms.get(req.params.roomId);
    if (!room) {
      return res.status(404).json({ error: 'Signaling room not found.' });
    }
    return res.json({ roomId: req.params.roomId, ...room });
  });

  // ---------------------------------------------------------------------------
  // Ontology Graph API (ADR 001: Recursive CTEs + pgvector RAG + Test Case 2)
  // ---------------------------------------------------------------------------
  app.get('/api/ontology/tree', async (req: Request, res: Response) => {
    const rootId = req.query.rootId ? Number(req.query.rootId) : undefined;

    if (pgPool) {
      try {
        const queryText = rootId
          ? 'SELECT * FROM get_component_hierarchy($1)'
          : 'SELECT * FROM v_component_hierarchy ORDER BY depth ASC, id ASC';
        const { rows } = await pgPool.query(queryText, rootId ? [rootId] : []);
        return res.json({
          source: 'postgresql_pgvector',
          tree: rows,
          nodes: localOntology.getAllNodes(),
          feedbackLog: localOntology.getFeedbackLog(),
          flywheel: localOntology.getFlywheelMetrics(),
        });
      } catch (err) {
        console.error('[Ontology DB Fallback]', (err as Error).message);
      }
    }

    return res.json({
      source: 'in_memory_cte_parity',
      tree: localOntology.getHierarchyTree(rootId),
      nodes: localOntology.getAllNodes(),
      feedbackLog: localOntology.getFeedbackLog(),
      flywheel: localOntology.getFlywheelMetrics(),
    });
  });

  app.post('/api/ontology/search', async (req: Request, res: Response) => {
    const {
      queryVector,
      scaleAnchor = 'none',
      hasWebXRDepth = false,
      limit = 4,
    } = req.body ?? {};

    const hasScaleAnchor = Boolean(hasWebXRDepth) || scaleAnchor !== 'none';
    const maxRows = Number(limit) || 4;

    if (pgPool && Array.isArray(queryVector) && queryVector.length === 768) {
      try {
        const vectorLiteral = `[${queryVector.map(Number).join(',')}]`;
        const { rows } = await pgPool.query(
          'SELECT * FROM rag_search_ontology_subgraph($1::vector, $2, $3)',
          [vectorLiteral, hasScaleAnchor, maxRows]
        );
        return res.json({
          source: 'postgresql_pgvector',
          hasScaleAnchor,
          matches: rows,
        });
      } catch (err) {
        console.error('[PostgreSQL rag_search_ontology_subgraph fallback]', (err as Error).message);
      }
    }

    const vector = Array.isArray(queryVector) && queryVector.length > 0
      ? buildFeatureVector(queryVector.map(Number))
      : buildFeatureVector([0.14, 0.16, 0.87, 0.43, 0.10, 0.07, 0.06, 0.09]);

    const matches = localOntology.searchRagSubgraph(
      vector,
      scaleAnchor as ScaleAnchorType,
      Boolean(hasWebXRDepth),
      maxRows
    );

    return res.json({
      source: 'in_memory_cte_parity',
      hasScaleAnchor,
      matches,
    });
  });

  app.post('/api/ontology/feedback', async (req: Request, res: Response) => {
    const {
      predictedComponentId,
      correctedComponentId,
      tag,
      capturedVector,
      frameDataUrl,
      regionCode = 'US-CHI',
    } = req.body ?? {};

    if (!correctedComponentId || !tag) {
      return res.status(400).json({
        error: 'correctedComponentId and tag are required to update the ontology graph.',
      });
    }

    // Attempt live multimodal embedding via gemini-embedding-2 when frame + API key exist
    let embeddingModelUsed: string | null = null;
    const clients = getGeminiClients();
    let fullEmbedding768: number[] | null = null;

    if (clients && typeof frameDataUrl === 'string' && frameDataUrl.length > 32) {
      try {
        const { mimeType, base64 } = stripDataUrlPrefix(frameDataUrl);
        const embResult = await clients.interactionsAi.models.embedContent({
          model: 'gemini-embedding-2',
          contents: [
            `Hardware component user correction: ${String(tag)}`,
            { inlineData: { data: base64, mimeType } },
          ],
        });
        const values = embResult.embeddings?.[0]?.values;
        if (Array.isArray(values) && values.length > 0) {
          fullEmbedding768 = values.slice(0, 768);
          embeddingModelUsed = 'gemini-embedding-2';
        }
      } catch (err) {
        console.warn('[gemini-embedding-2 warning]', (err as Error).message);
      }
    }

    const compactVector =
      Array.isArray(capturedVector) && capturedVector.length > 0
        ? capturedVector.map(Number)
        : fullEmbedding768
          ? fullEmbedding768.slice(0, 8)
          : [0.14, 0.16, 0.87, 0.43, 0.10, 0.07, 0.06, 0.09];

    // Persist to Cloud SQL PostgreSQL if configured
    if (pgPool && fullEmbedding768 && fullEmbedding768.length === 768) {
      try {
        const vectorLiteral = `[${fullEmbedding768.join(',')}]`;
        await pgPool.query(
          'SELECT * FROM apply_ontology_correction($1, $2, $3, $4, $5::vector, $6)',
          [
            null,
            predictedComponentId ? Number(predictedComponentId) : null,
            Number(correctedComponentId),
            String(tag).slice(0, 80),
            vectorLiteral,
            String(regionCode).slice(0, 32),
          ]
        );
      } catch (err) {
        console.error('[PostgreSQL apply_ontology_correction failed]', (err as Error).message);
      }
    }

    try {
      const { updated, event } = localOntology.applyCorrection({
        predictedComponentId: Number(predictedComponentId || correctedComponentId),
        correctedComponentId: Number(correctedComponentId),
        capturedEmbedding: compactVector,
        tag: String(tag).slice(0, 80),
        regionCode: String(regionCode).slice(0, 32),
      });

      return res.json({
        status: 'updated',
        embeddingModelUsed: embeddingModelUsed ?? 'compact_signature_fallback',
        updatedComponent: updated,
        feedbackEvent: event,
        tree: localOntology.getHierarchyTree(),
        feedbackLog: localOntology.getFeedbackLog(),
        flywheel: localOntology.getFlywheelMetrics(),
      });
    } catch (err) {
      return res.status(404).json({ error: (err as Error).message });
    }
  });

  app.post('/api/ontology/deflection', async (req: Request, res: Response) => {
    const computeCostUsd = Number(req.body?.computeCostUsd ?? 1.45);
    const safeCost = Number.isFinite(computeCostUsd) && computeCostUsd > 0 ? computeCostUsd : 1.45;
    let persistedToSql = false;

    if (pgPool) {
      try {
        await pgPool.query(
          `INSERT INTO deflection_bounties (brand_id, bounty_usd, compute_cost_usd)
           VALUES (1, 30.00, $1)`,
          [safeCost]
        );
        persistedToSql = true;
      } catch (err) {
        console.error('[PostgreSQL deflection_bounties fallback]', (err as Error).message);
      }
    }

    const flywheel = localOntology.recordDeflection(safeCost);
    return res.json({
      status: 'recorded',
      source: persistedToSql ? 'postgresql_pgvector' : 'in_memory_cte_parity',
      flywheel,
    });
  });

  // ---------------------------------------------------------------------------
  // CORE GEMINI 4 ROUTING PROXY (ADR 003 / Test Case 3 / Break 2)
  // Step 1: Proxy 15-second frame buffer to `gemini-decision-1` (0 output tokens).
  // Step 2: ONLY call `gemini-4-neon` if Decisions API returns a high-confidence anomaly.
  // ---------------------------------------------------------------------------
  app.post('/api/analyze-buffer', async (req: Request, res: Response) => {
    const {
      frames = [],
      ingestMode = 'webrtc_15fps',
      scaleAnchor = 'none',
      hasWebXRDepth = false,
      scaleOptOut = false,
      preferredLanguage = 'en-US',
      stillDurationMs = 0,
      scenarioHint = '',
      userQuestion = '',
      queryVector,
    } = req.body ?? {};

    if (!Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({
        error: 'A 15-second frame buffer or 3-shot burst payload with at least 1 frame is required.',
      });
    }

    const clients = getGeminiClients();
    if (!clients) {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Configure a valid Gemini 4 API key in Secrets to invoke gemini-decision-1 and gemini-4-neon.',
        code: 'API_KEY_MISSING',
      });
    }

    // Sample up to 6 chronological frames spanning the 15-second ring buffer to control token budget
    const incomingFrames = frames as IncomingFrame[];
    const step = Math.max(1, Math.floor(incomingFrames.length / 6));
    const sampledFrames = incomingFrames.filter((_f, idx) => idx % step === 0).slice(0, 6);

    const multimodalInput: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mime_type: string; resolution: 'low' | 'medium' }
    > = [
      {
        type: 'text',
        text:
          `JackOfAllTrades 15-second visual buffer (${sampledFrames.length} chronological frames, ` +
          `ingestMode=${ingestMode}, handStillMs=${Math.round(Number(stillDurationMs))}, ` +
          `scaleAnchor=${scaleAnchor}, webXRDepth=${Boolean(hasWebXRDepth)}). ` +
          (scenarioHint ? `Workshop context: ${String(scenarioHint)}. ` : '') +
          (userQuestion ? `User voice query: "${String(userQuestion)}".\n` : '\n'),
      },
    ];

    for (const frame of sampledFrames) {
      const { mimeType, base64 } = stripDataUrlPrefix(frame.dataUrl);
      multimodalInput.push({
        type: 'image',
        data: base64,
        mime_type: mimeType,
        resolution: ingestMode === 'burst_photo_3x' ? 'medium' : 'low',
      });
    }

    // -------------------------------------------------------------------------
    // STEP 1: Zero-Token Routing via Gemini Decisions API (`gemini-decision-1`)
    // -------------------------------------------------------------------------
    let decisionScores: DecisionsCheckScores;
    let decisionUsage = { total_input_tokens: 0, total_output_tokens: 0 };

    try {
      const decisionResponse = await clients.decisionsAi.decisions.create({
        model: 'gemini-decision-1',
        input: multimodalInput,
        questions: {
          user_stalled: {
            type: 'noul',
            instructions:
              'Has the user hesitated, stalled, or kept hands stationary on an unresolved physical assembly/repair step?',
            criteria: {
              true_description: 'Hands are stalled, confused, or waiting for the next physical step.',
              false_description: 'User is smoothly and confidently progressing through assembly.',
            },
          },
          hazard_proximity: {
            type: 'noul',
            instructions:
              'Are the user hands or tool near a mechanical hazard, active leak, or forcing a clip/fastener in a damaging direction?',
            criteria: {
              true_description: 'Clear risk of snapping a clip, stripping a fastener, water spray, or hand injury.',
              false_description: 'Safe hand placement and controlled tool orientation.',
            },
          },
          alignment_anomaly: {
            type: 'noul',
            instructions:
              'Is there a visible physical misalignment, wrong fastener/tool mismatch, or crooked bracket/nut in the frame?',
            criteria: {
              true_description: 'Visible crooked hinge, mismatched screw/bolt size, cross-threading, or wrong rotation direction.',
              false_description: 'All visible components are properly aligned and matched.',
            },
          },
          visual_noise_extreme: {
            type: 'noul',
            instructions:
              'Is the image buffer severely degraded by water droplets on the lens, harsh chrome flashlight glare, or extreme motion blur?',
            criteria: {
              true_description: 'Cannot reliably read threads or component geometry due to glare, water, or blur.',
              false_description: 'Component geometry is legible enough for visual inspection.',
            },
          },
          camera_focused: {
            type: 'noul',
            instructions: 'Is the primary physical component sharply focused?',
          },
          object_in_frame: {
            type: 'noul',
            instructions: 'Is the target physical object completely inside the camera frame?',
          },
        },
      });

      const answers = decisionResponse.answers;
      if (!answers) {
        return res.status(400).json({
          error: 'gemini-decision-1 returned no answers (content may have been filtered).',
          promptFeedback: decisionResponse.prompt_feedback ?? null,
        });
      }

      const readNoul = (key: string): number => {
        const a = answers[key];
        return a?.type === 'noul' ? Number(a.noul.toFixed(4)) : 0.01;
      };

      decisionScores = {
        userStalled: readNoul('user_stalled'),
        hazardProximity: readNoul('hazard_proximity'),
        alignmentAnomaly: readNoul('alignment_anomaly'),
        visualNoiseExtreme: readNoul('visual_noise_extreme'),
        cameraFocused: readNoul('camera_focused'),
        objectInFrame: readNoul('object_in_frame'),
      };

      const usageAny = decisionResponse.usage as
        | { total_input_tokens?: number; total_output_tokens?: number }
        | undefined;
      decisionUsage = {
        total_input_tokens: usageAny?.total_input_tokens ?? 0,
        total_output_tokens: usageAny?.total_output_tokens ?? 0,
      };
    } catch (err) {
      const { status, message } = extractErrorDetails(err);
      return res.status(status).json({
        error: `Gemini Decisions API (gemini-decision-1) failed: ${message}`,
        stage: 'gemini-decision-1',
      });
    }

    // Evaluate routing gate strictly against threshold (0.78)
    const route = evaluateDecisionsRouting(decisionScores, ANOMALY_CONFIDENCE_THRESHOLD);

    // Retrieve Ontology RAG subgraph (with Break 2 Scale Anchor enforcement)
    const ragMatches = localOntology.searchRagSubgraph(
      Array.isArray(queryVector) && queryVector.length > 0
        ? buildFeatureVector(queryVector.map(Number))
        : buildFeatureVector([0.14, 0.16, 0.87, 0.43, 0.10, 0.07, 0.06, 0.09]),
      scaleAnchor as ScaleAnchorType,
      Boolean(hasWebXRDepth),
      3
    );

    // If Decisions API detected extreme glare/water -> instruct client to downgrade to 3-shot burst
    if (route.shouldDowngradeToBurst) {
      return res.json({
        escalatedToNeon: false,
        downgradeToBurst: true,
        decisionModel: 'gemini-decision-1',
        decisionScores,
        decisionUsage,
        route,
        voiceInstruction:
          "I can't see the threading clearly. Wipe the lens and hold still for three high-contrast burst photos.",
        ragMatches,
      });
    }

    // If no high-confidence anomaly AND no explicit user voice question -> hold gemini-4-neon asleep!
    const hasExplicitQuestion = typeof userQuestion === 'string' && userQuestion.trim().length > 0;
    if (!route.shouldEscalateToNeon && !hasExplicitQuestion) {
      return res.json({
        escalatedToNeon: false,
        downgradeToBurst: false,
        decisionModel: 'gemini-decision-1',
        decisionScores,
        decisionUsage,
        route,
        ragMatches,
      });
    }

    // -------------------------------------------------------------------------
    // STEP 2: Wake `gemini-4-neon` (The Brain) ONLY on High-Confidence Anomaly
    // Actively inspects the frame for a physical scale anchor (quarter/coin,
    // credit card, thumb, or ruler) so exact sizing is confirmed before unlock.
    // -------------------------------------------------------------------------
    const clientHasScale = Boolean(hasWebXRDepth) || scaleAnchor !== 'none';
    const responseLang = normalizeBcp47Language(
      typeof preferredLanguage === 'string' ? preferredLanguage : undefined,
      'en-US'
    );
    const ragContextText = ragMatches
      .map(
        (m, i) =>
          `${i + 1}. [ID ${m.component.id}] ${m.component.name} (${m.ancestryPath}) | ` +
          `Similarity=${m.similarity} | Pitch=${m.component.threadPitchMm ?? 'N/A'}mm | ` +
          `Precursor=${m.component.failurePrecursorCue} | ` +
          `Tool=${m.scaleGatedAdvice.toolRequired} (${m.scaleGatedAdvice.toolSizeSpec}) | ` +
          `Step=${m.scaleGatedAdvice.instructionText}`
      )
      .join('\n');

    try {
      const neonInteraction = await clients.interactionsAi.interactions.create({
        model: 'gemini-4-neon',
        system_instruction:
          'You are Jack of All Trades, a precision physical repair and assembly diagnostic engine. ' +
          'Analyze the visual frames alongside the Ontology RAG matches and produce plain-English, actionable steps.\n' +
          'CRITICAL SCALE CALIBRATION RULE (Break 2 — Scale Hallucination Guard):\n' +
          '1. Inspect the image(s) carefully for any known-size physical reference object placed beside the part: a US quarter / coin ("us_quarter" or "coin"), a credit/debit/ID card ("credit_card"), a human thumb/finger ("human_thumb"), or a ruler/tape measure ("ruler"). If none is clearly visible beside the part, set detectedScaleObject="none" and scaleCalibrated=false.\n' +
          '2. ONLY set scaleCalibrated=true if a reference object is clearly visible right next to the part (or WebXR depth is active: ' +
          String(clientHasScale) +
          ').\n' +
          '3. If scaleCalibrated=true, explicitly confirm in voiceCoachingLine which reference object calibrated scale and recommend exact metric/imperial tool sizes.\n' +
          '4. If scaleCalibrated=false, you are STRICTLY BARRED from recommending a specific numeric tool size (e.g., 10mm, M4, 3/8"). Set requiresScaleAnchor=true and toolSizeSpec="". ' +
          (scaleOptOut
            ? 'The user chose to continue without scaling: briefly note why a reference object helps avoid wrong tool sizes, and still give safe actionable repair steps.'
            : 'Ask the user in voiceCoachingLine to place a quarter, credit card, or their thumb next to the part so we can calibrate exact tool size—or let them know they can continue without scaling.') +
          ' Return concise JSON only.',
        input: [
          ...multimodalInput,
          {
            type: 'text',
            text:
              `\nDecisions API trigger: ${route.dominantTrigger} (confidence=${route.maxAnomalyConfidence}).\n` +
              `scaleOptOut=${Boolean(scaleOptOut)}, clientScaleAnchor=${scaleAnchor}, webXRDepth=${Boolean(hasWebXRDepth)}.\n` +
              `Ontology RAG Subgraph:\n${ragContextText}\n` +
              'Return the detected scale object (if any), calibration confidence, component diagnosis, 2-3 clear plain-English repair steps, tool required, PiP hand-motion prompt, and a concise spoken voiceCoachingLine (under 3 sentences).',
          },
        ],
        response_format: {
          type: Type.OBJECT,
          properties: {
            componentId: { type: Type.INTEGER },
            componentName: { type: Type.STRING },
            diagnosisSummary: { type: Type.STRING },
            failurePrecursor: { type: Type.STRING },
            nextStepInstruction: { type: Type.STRING },
            toolRequired: { type: Type.STRING },
            toolSizeSpec: { type: Type.STRING },
            requiresScaleAnchor: { type: Type.BOOLEAN },
            detectedScaleObject: {
              type: Type.STRING,
              description:
                'One of: us_quarter, coin, credit_card, human_thumb, ruler, webxr_depth, or none.',
            },
            scaleCalibrated: {
              type: Type.BOOLEAN,
              description:
                'True ONLY if a known-size reference object is clearly visible beside the target part and scale was properly calibrated.',
            },
            scaleConfidence: {
              type: Type.NUMBER,
              description: 'Confidence from 0.0 to 1.0 in the detected scale reference object.',
            },
            steps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  detail: { type: Type.STRING },
                },
                required: ['title', 'detail'],
              },
            },
            rotationDirection: { type: Type.STRING },
            pipMotionPrompt: { type: Type.STRING },
            voiceCoachingLine: { type: Type.STRING },
          },
          required: [
            'componentName',
            'diagnosisSummary',
            'nextStepInstruction',
            'toolRequired',
            'requiresScaleAnchor',
            'detectedScaleObject',
            'scaleCalibrated',
            'steps',
            'pipMotionPrompt',
            'voiceCoachingLine',
          ],
        },
        generation_config: {
          thinking_level: 'medium',
        },
      });

      const rawText = neonInteraction.output_text ?? '';
      let parsedDiagnosis: Record<string, unknown> = {};
      try {
        parsedDiagnosis = JSON.parse(rawText);
      } catch {
        const match = rawText.match(/\{[\s\S]*\}/);
        parsedDiagnosis = match ? JSON.parse(match[0]) : { diagnosisSummary: rawText };
      }

      const scaleCalibration = resolveScaleCalibration({
        detectedObject:
          typeof parsedDiagnosis.detectedScaleObject === 'string'
            ? parsedDiagnosis.detectedScaleObject
            : 'none',
        scaleCalibrated: Boolean(parsedDiagnosis.scaleCalibrated),
        scaleConfidence:
          typeof parsedDiagnosis.scaleConfidence === 'number'
            ? parsedDiagnosis.scaleConfidence
            : undefined,
        explicitOptOut: Boolean(scaleOptOut),
        hasWebXRDepth: Boolean(hasWebXRDepth),
        clientScaleAnchor: scaleAnchor as ScaleAnchorType,
      });

      const effectiveAnchor = mapDetectedObjectToScaleAnchor(scaleCalibration.detectedObject);

      // Hard programmatic enforcement of Break 2 Scale Anchor Invariant
      const scaleGated = enforceScaleAnchorInvariant(
        {
          toolRequired: String(parsedDiagnosis.toolRequired || 'Hand Inspection'),
          toolSizeSpec:
            scaleCalibration.confirmed && parsedDiagnosis.toolSizeSpec
              ? String(parsedDiagnosis.toolSizeSpec)
              : null,
          requiresScaleAnchor: !scaleCalibration.confirmed,
          instructionText: String(parsedDiagnosis.nextStepInstruction || ''),
        },
        effectiveAnchor,
        Boolean(hasWebXRDepth)
      );

      // Build concise spoken guidance guaranteeing scale confirmation / prompt / opt-out summary is heard
      const baseCoaching = String(
        parsedDiagnosis.voiceCoachingLine || parsedDiagnosis.nextStepInstruction || ''
      ).trim();
      let spokenText = baseCoaching;
      if (scaleCalibration.status === 'calibrated') {
        const alreadyMentionsScale = /scale|calibrat|quarter|coin|card|thumb|ruler/i.test(baseCoaching);
        spokenText = alreadyMentionsScale
          ? baseCoaching
          : `${scaleCalibration.spokenScaleNotice} ${baseCoaching}`.trim();
      } else if (scaleCalibration.status === 'opted_out') {
        spokenText = `${scaleCalibration.spokenScaleNotice} ${baseCoaching}`.trim();
      } else {
        const alreadyAsksAnchor = /quarter|credit card|thumb|scale/i.test(baseCoaching);
        spokenText = alreadyAsksAnchor
          ? baseCoaching
          : `${baseCoaching} ${scaleCalibration.spokenScaleNotice}`.trim();
      }

      // Best-effort Gemini neural TTS so Scan Problem speaks its scale guidance & fix aloud
      let audioBase64: string | null = null;
      let audioMimeType: string | null = null;
      if (spokenText.length > 0) {
        try {
          const ttsRes = await clients.interactionsAi.interactions.create({
            model: 'gemini-3.8-flash-lite-tts',
            input: [
              {
                type: 'text',
                text: spokenText,
                annotations: [
                  {
                    type: 'speech_metadata',
                    style: 'Calm, clear, helpful expert mechanic speaking concisely',
                  },
                ],
              },
            ],
            store: false,
            response_format: { type: 'audio' },
            generation_config: {
              speech_config: [{ language: responseLang, voice: 'Kore' }],
            },
          });
          if (ttsRes.output_audio?.data) {
            audioBase64 = ttsRes.output_audio.data;
            audioMimeType = ttsRes.output_audio.mime_type || 'audio/wav';
          }
        } catch (ttsErr) {
          console.warn('[Scan TTS fallback]', (ttsErr as Error).message);
        }
      }

      return res.json({
        escalatedToNeon: true,
        downgradeToBurst: false,
        decisionModel: 'gemini-decision-1',
        reasoningModel: 'gemini-4-neon',
        decisionScores,
        decisionUsage,
        route,
        ragMatches,
        scaleCalibration,
        spokenText,
        audioBase64,
        audioMimeType,
        diagnosis: {
          ...parsedDiagnosis,
          toolRequired: scaleGated.toolRequired,
          toolSizeSpec: scaleGated.toolSizeSpec,
          scaleGuardBlocked: scaleGated.scaleGuardBlocked,
          nextStepInstruction: scaleGated.instructionText,
          anchorPrompt: scaleGated.anchorPrompt,
        },
      });
    } catch (err) {
      const { status, message } = extractErrorDetails(err);
      return res.status(status).json({
        error: `Gemini 4 Neon (gemini-4-neon) failed: ${message}`,
        stage: 'gemini-4-neon',
        decisionScores,
        route,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // LIVE SPATIAL OUTPUT: PiP Hand-Motion Loop (`gemini-omni-1.2-flash`)
  // ---------------------------------------------------------------------------
  app.post('/api/generate-pip', async (req: Request, res: Response) => {
    const { prompt, referenceFrameDataUrl, duration = '6s' } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'A motion guidance prompt is required.' });
    }

    const clients = getGeminiClients();
    if (!clients) {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Configure a billing-enabled Gemini 4 API key to generate PiP video loops via gemini-omni-1.2-flash.',
        code: 'API_KEY_MISSING',
      });
    }

    try {
      const inputParts: Array<
        { type: 'text'; text: string } | { type: 'image'; mime_type: string; data: string }
      > = [];

      if (typeof referenceFrameDataUrl === 'string' && referenceFrameDataUrl.length > 32) {
        const { mimeType, base64 } = stripDataUrlPrefix(referenceFrameDataUrl);
        inputParts.push({ type: 'image', mime_type: mimeType, data: base64 });
      }

      inputParts.push({
        type: 'text',
        text: `Clean instructional workbench close-up showing exact hand mechanics for repair guidance: ${prompt}`,
      });

      const interaction = await clients.interactionsAi.interactions.create(
        {
          model: 'gemini-omni-1.2-flash',
          input: inputParts,
          background: false,
          store: false,
          stream: false,
          response_format: {
            type: 'video',
            aspect_ratio: '16:9',
            duration: duration === '10s' ? '10s' : '6s',
            resolution: '720p',
          },
        },
        { timeout: 300000 }
      );

      const videoPart = interaction.output_video;
      if (!videoPart || (!videoPart.data && !videoPart.uri)) {
        return res.status(502).json({
          error: 'gemini-omni-1.2-flash returned no video payload.',
        });
      }

      return res.json({
        model: 'gemini-omni-1.2-flash',
        mimeType: videoPart.mime_type || 'video/mp4',
        videoDataUrl: videoPart.data
          ? `data:${videoPart.mime_type || 'video/mp4'};base64,${videoPart.data}`
          : null,
        videoUri: videoPart.uri || null,
      });
    } catch (err) {
      const { status, message } = extractErrorDetails(err);
      return res.status(status).json({
        error: `Gemini Omni Flash (gemini-omni-1.2-flash) PiP generation failed: ${message}`,
        stage: 'gemini-omni-1.2-flash',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // NATIVE TWO-WAY AUDIO: Push-to-Talk Visual + Audio -> Generated Speech (WAV)
  // Audio Pipeline:
  //   1. Browser MediaRecorder captures microphone Blob (audio/webm or audio/mp4)
  //      and encodes it to a Base64 data URL alongside recent JPEG video frames.
  //   2. Express strips the data URL prefix and validates byte length, passing
  //      BOTH inline visual `image` parts AND the raw inline `audio` part to
  //      `gemini-4-neon` (`ai.interactions.create`) with the strict mechanic prompt.
  //   3. Express passes the concise (< 3 sentence) response to
  //      `gemini-3.8-flash-lite-tts` with `response_format: { type: 'audio' }`,
  //      which returns a complete 24kHz mono 16-bit WAV file in Base64.
  //   4. Express decodes `Buffer.from(audio.data, 'base64')` and pipes raw binary
  //      `audio/wav` bytes directly back to the browser when `Accept: audio/*`
  //      is requested (or JSON Base64 otherwise).
  // ---------------------------------------------------------------------------
  app.post('/api/voice-assist', async (req: Request, res: Response) => {
    const {
      frames = [],
      audio,
      audioDataUrl,
      audioBase64,
      audioMimeType = 'audio/webm',
      preferredLanguage,
      scaleAnchor = 'none',
      hasWebXRDepth = false,
      scaleOptOut = false,
      format,
    } = req.body ?? {};

    const rawAudioInput =
      typeof audio === 'string'
        ? audio
        : typeof audio?.data === 'string'
          ? audio.data
          : typeof audioDataUrl === 'string'
            ? audioDataUrl
            : typeof audioBase64 === 'string'
              ? audioBase64
              : '';

    const rawMime =
      (typeof audio === 'object' && audio?.mimeType) ||
      (typeof audioMimeType === 'string' ? audioMimeType : 'audio/webm');

    const fallbackLanguage = normalizeBcp47Language(
      typeof preferredLanguage === 'string' ? preferredLanguage : undefined,
      'en-US'
    );

    const { mimeType: cleanAudioMime, base64: cleanAudioBase64 } = stripAudioDataUrl(
      rawAudioInput,
      rawMime
    );

    const validation = validateAudioPayload(cleanAudioBase64);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const clients = getGeminiClients();
    if (!clients) {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Configure a valid Gemini 4 API key in Secrets.',
        code: 'API_KEY_MISSING',
      });
    }

    // Sample up to 4 recent video frames from the client's rolling buffer
    const incomingFrames = Array.isArray(frames) ? (frames as IncomingFrame[]) : [];
    const stride = Math.max(1, Math.floor(incomingFrames.length / 4));
    const sampledFrames = incomingFrames.filter((_f, i) => i % stride === 0).slice(0, 4);

    // Build multimodal input combining visual frames + raw inline user audio
    const multimodalParts: Array<
      | { type: 'image'; data: string; mime_type: string; resolution: 'low' | 'medium' }
      | { type: 'audio'; data: string; mime_type: string }
      | { type: 'text'; text: string }
    > = [];

    for (const frame of sampledFrames) {
      if (typeof frame?.dataUrl !== 'string' || frame.dataUrl.length < 32) continue;
      const { mimeType, base64 } = stripDataUrlPrefix(frame.dataUrl);
      multimodalParts.push({
        type: 'image',
        data: base64,
        mime_type: mimeType,
        resolution: 'medium',
      });
    }

    // Attach the user's raw recorded microphone audio directly as an inline audio part
    multimodalParts.push({
      type: 'audio',
      data: cleanAudioBase64,
      mime_type: cleanAudioMime,
    });

    multimodalParts.push({
      type: 'text',
      text:
        '1. Listen carefully to the attached audio clip. Set speechDetected=true ONLY if intelligible human speech is actually audible; set speechDetected=false if the clip is silent or contains only noise.\n' +
        '2. If speechDetected=true, write the exact verbatim words heard in userTranscript (in the original spoken language) and set detectedLanguageCode to the matching BCP-47 tag (e.g., "es-ES", "es-MX", "fr-FR", "ja-JP", "de-DE", "pt-BR", "zh-CN", "ar-EG", "hi-IN", "en-US").\n' +
        '3. If speechDetected=false, set userTranscript="", set detectedLanguageCode="' +
        fallbackLanguage +
        '", do NOT invent a repair problem, and write a brief polite prompt in "' +
        fallbackLanguage +
        '" asking the user to hold the button and speak closer to the microphone.\n' +
        '4. SCALE ANCHOR CHECK (MANDATORY): Inspect the attached camera frame(s) for a known-size reference object placed beside the part: a US quarter / coin ("us_quarter" or "coin"), a credit/debit/ID card ("credit_card"), a human thumb ("human_thumb"), or a ruler ("ruler"). Set detectedScaleObject and set scaleCalibrated=true ONLY if clearly visible right beside the target part.\n' +
        '5. SCALE OPT-OUT CHECK: Set userDeclinedScale=true if the user says they do not want to scale, want to skip scaling, or do not have a scale object (client scaleOptOut=' +
        String(Boolean(scaleOptOut)) +
        ').\n' +
        '6. Write ALL user-facing text (spokenResponse, componentName, diagnosisSummary, nextStepInstruction, steps, and whyScaleMattersLocalized) STRICTLY in detectedLanguageCode — never switch languages.\n' +
        '7. In spokenResponse (3 short sentences max, no markdown):\n' +
        '   - If scaleCalibrated=true: explicitly confirm you calibrated scale using the detected object, then give the direct mechanic fix (exact tool size allowed).\n' +
        '   - If scaleCalibrated=false AND (userDeclinedScale=true OR scaleOptOut=true): acknowledge continuing without scaling, include a 1-sentence summary of why a reference object matters (camera lenses distort close-up size so tool sizes are approximate), and give the safe repair step without claiming exact numeric tool sizes.\n' +
        '   - If scaleCalibrated=false AND NOT opted out: give safe preliminary guidance (NO specific numeric tool sizes) AND ask the user to hold a quarter, credit card, or their thumb next to the part so you can confirm exact scale—or say if they prefer to continue without scaling.\n' +
        '8. Always populate componentName, diagnosisSummary, nextStepInstruction, toolRequired, 2-3 clear steps[], and pipMotionPrompt so the on-screen AI Fix sheet renders completely alongside your spoken reply.',
    });

    // STAGE 1: Multimodal Visual + Audio Reasoning + Language + Scale Calibration via `gemini-4-neon`
    let spokenText = '';
    let detectedLanguageCode = fallbackLanguage;
    let detectedLanguageName = 'Auto';
    let speechDetected = true;
    let userTranscript = '';
    let scaleCalibration: ScaleCalibrationResult | null = null;
    let structuredDiagnosis: Record<string, unknown> | null = null;

    try {
      const reasoning = await clients.interactionsAi.interactions.create({
        model: 'gemini-4-neon',
        system_instruction: EXPERT_MECHANIC_SYSTEM_PROMPT,
        input: multimodalParts,
        store: false,
        generation_config: {
          thinking_level: 'low',
        },
        response_format: {
          type: Type.OBJECT,
          properties: {
            speechDetected: {
              type: Type.BOOLEAN,
              description:
                'True only if intelligible human speech is present in the audio clip; false if silent or unintelligible noise.',
            },
            userTranscript: {
              type: Type.STRING,
              description:
                'Verbatim transcription of the user speech in its original spoken language (empty string if speechDetected is false).',
            },
            detectedLanguageCode: {
              type: Type.STRING,
              description:
                'BCP-47 locale tag matching userTranscript (e.g., es-ES, fr-FR, ja-JP, pt-BR, en-US), or the fallback locale if speechDetected is false.',
            },
            detectedLanguageName: {
              type: Type.STRING,
              description: 'Human-readable name of the detected language (e.g., Spanish, French, Japanese, English).',
            },
            detectedScaleObject: {
              type: Type.STRING,
              description:
                'Detected scale object beside the part: us_quarter, coin, credit_card, human_thumb, ruler, webxr_depth, or none.',
            },
            scaleCalibrated: {
              type: Type.BOOLEAN,
              description:
                'True ONLY if a known-size reference object is clearly visible right next to the part and scale was properly calibrated.',
            },
            scaleConfidence: {
              type: Type.NUMBER,
              description: 'Confidence 0.0 to 1.0 in the detected scale reference object.',
            },
            userDeclinedScale: {
              type: Type.BOOLEAN,
              description:
                'True if the user explicitly asked to skip scaling or continue without using a reference object.',
            },
            whyScaleMattersLocalized: {
              type: Type.STRING,
              description:
                'A short 1-2 sentence explanation in detectedLanguageCode explaining why placing a quarter, credit card, or thumb beside the part matters for accurate tool sizing.',
            },
            spokenResponse: {
              type: Type.STRING,
              description:
                'Direct, actionable mechanic guidance written strictly in detectedLanguageCode, under 3 sentences, including scale confirmation, anchor prompt, or opt-out explanation as appropriate.',
            },
            componentName: {
              type: Type.STRING,
              description: 'Short plain-language name of the visible part/assembly in detectedLanguageCode.',
            },
            diagnosisSummary: {
              type: Type.STRING,
              description: 'Concise 1-2 sentence summary of the visual issue and fix in detectedLanguageCode.',
            },
            nextStepInstruction: {
              type: Type.STRING,
              description: 'Primary actionable repair step in detectedLanguageCode.',
            },
            toolRequired: {
              type: Type.STRING,
              description: 'Tool category needed (e.g., Phillips screwdriver, Hex key, No tools needed).',
            },
            toolSizeSpec: {
              type: Type.STRING,
              description: 'Exact numeric size ONLY if scaleCalibrated=true; otherwise empty string.',
            },
            steps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  detail: { type: Type.STRING },
                },
                required: ['title', 'detail'],
              },
            },
            pipMotionPrompt: {
              type: Type.STRING,
              description: 'Short visual hand-motion prompt for optional PiP demonstration.',
            },
          },
          required: [
            'speechDetected',
            'userTranscript',
            'detectedLanguageCode',
            'detectedLanguageName',
            'detectedScaleObject',
            'scaleCalibrated',
            'userDeclinedScale',
            'whyScaleMattersLocalized',
            'spokenResponse',
            'componentName',
            'diagnosisSummary',
            'nextStepInstruction',
            'toolRequired',
            'steps',
          ],
        },
      });

      const rawOutput = reasoning.output_text || '';
      try {
        const parsed = JSON.parse(rawOutput) as {
          speechDetected?: boolean;
          userTranscript?: string;
          detectedLanguageCode?: string;
          detectedLanguageName?: string;
          detectedScaleObject?: string;
          scaleCalibrated?: boolean;
          scaleConfidence?: number;
          userDeclinedScale?: boolean;
          whyScaleMattersLocalized?: string;
          spokenResponse?: string;
          componentName?: string;
          diagnosisSummary?: string;
          nextStepInstruction?: string;
          toolRequired?: string;
          toolSizeSpec?: string;
          steps?: Array<{ title?: string; detail?: string }>;
          pipMotionPrompt?: string;
        };

        speechDetected = parsed.speechDetected !== false;
        userTranscript = parsed.userTranscript?.trim() || '';
        const rawCode = speechDetected ? parsed.detectedLanguageCode : fallbackLanguage;
        detectedLanguageCode = normalizeBcp47Language(rawCode, fallbackLanguage);
        detectedLanguageName = parsed.detectedLanguageName?.trim() || detectedLanguageCode;
        spokenText = enforceThreeSentenceCap(parsed.spokenResponse || rawOutput);

        scaleCalibration = resolveScaleCalibration({
          detectedObject: parsed.detectedScaleObject,
          scaleCalibrated: Boolean(parsed.scaleCalibrated),
          scaleConfidence: parsed.scaleConfidence,
          explicitOptOut: Boolean(scaleOptOut),
          userDeclinedInSpeech: Boolean(parsed.userDeclinedScale),
          userTranscript,
          hasWebXRDepth: Boolean(hasWebXRDepth),
          clientScaleAnchor: scaleAnchor as ScaleAnchorType,
          localizedWhyScaleMatters: parsed.whyScaleMattersLocalized,
        });

        const effectiveAnchor = mapDetectedObjectToScaleAnchor(scaleCalibration.detectedObject);

        const scaleGated = enforceScaleAnchorInvariant(
          {
            toolRequired: parsed.toolRequired?.trim() || 'Hand Inspection',
            toolSizeSpec:
              scaleCalibration.confirmed && parsed.toolSizeSpec?.trim()
                ? parsed.toolSizeSpec.trim()
                : null,
            requiresScaleAnchor: !scaleCalibration.confirmed,
            instructionText: parsed.nextStepInstruction?.trim() || spokenText,
          },
          effectiveAnchor,
          Boolean(hasWebXRDepth)
        );

        if (speechDetected) {
          structuredDiagnosis = {
            componentName: parsed.componentName?.trim() || 'Visual Repair Guidance',
            diagnosisSummary: parsed.diagnosisSummary?.trim() || spokenText,
            nextStepInstruction: scaleGated.instructionText,
            toolRequired: scaleGated.toolRequired,
            toolSizeSpec: scaleGated.toolSizeSpec,
            scaleGuardBlocked: scaleGated.scaleGuardBlocked,
            anchorPrompt: scaleGated.anchorPrompt,
            pipMotionPrompt: parsed.pipMotionPrompt?.trim() || undefined,
            steps: Array.isArray(parsed.steps) ? parsed.steps : [],
          };
        }
      } catch {
        spokenText = enforceThreeSentenceCap(rawOutput);
      }
    } catch (err) {
      const { status, message } = extractErrorDetails(err);
      return res.status(status).json({
        error: `Multimodal voice analysis failed: ${message}`,
        stage: 'gemini-4-neon',
      });
    }

    // STAGE 2: Native Multilingual Speech Generation (`gemini-3.8-flash-lite-tts`)
    // Passes the detected BCP-47 language code directly to `speech_config` so the
    // synthesized WAV speaks back naturally in the user's exact language.
    try {
      const ttsInteraction = await clients.interactionsAi.interactions.create({
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
        generation_config: {
          speech_config: [
            {
              language: detectedLanguageCode,
              voice: 'Kore',
            },
          ],
        },
      });

      const outputAudio = ttsInteraction.output_audio;
      if (!outputAudio?.data) {
        return res.status(502).json({
          error: 'Gemini speech synthesis returned no audio payload.',
          spokenText,
          detectedLanguageCode,
          detectedLanguageName,
          diagnosis: structuredDiagnosis,
          scaleCalibration,
        });
      }

      const wavMime = outputAudio.mime_type || 'audio/wav';
      const wantsBinary =
        format === 'binary' ||
        (typeof req.headers.accept === 'string' && req.headers.accept.includes('audio/'));

      if (wantsBinary) {
        // Decode Gemini's Base64 WAV into raw binary bytes and pipe directly to the browser
        const wavBuffer = Buffer.from(outputAudio.data, 'base64');
        res.setHeader('Content-Type', wavMime);
        res.setHeader('Content-Length', String(wavBuffer.length));
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-MakerLens-Transcript', encodeURIComponent(spokenText));
        res.setHeader('X-MakerLens-Language', detectedLanguageCode);
        res.setHeader('X-MakerLens-Language-Name', encodeURIComponent(detectedLanguageName));
        if (scaleCalibration) {
          res.setHeader('X-MakerLens-Scale-Status', scaleCalibration.status);
          res.setHeader('X-MakerLens-Scale-Object', scaleCalibration.detectedObject);
        }
        res.setHeader('X-MakerLens-Vision-Model', 'gemini-4-neon');
        res.setHeader('X-MakerLens-Speech-Model', 'gemini-3.8-flash-lite-tts');
        return res.status(200).send(wavBuffer);
      }

      return res.json({
        speechDetected,
        userTranscript,
        spokenText,
        detectedLanguageCode,
        detectedLanguageName,
        audioBase64: outputAudio.data,
        audioMimeType: wavMime,
        diagnosis: structuredDiagnosis,
        scaleCalibration,
        visionModel: 'gemini-4-neon',
        speechModel: 'gemini-3.8-flash-lite-tts',
      });
    } catch (err) {
      const { status, message } = extractErrorDetails(err);
      return res.status(status).json({
        error: `Speech synthesis failed: ${message}`,
        spokenText,
        detectedLanguageCode,
        detectedLanguageName,
        diagnosis: structuredDiagnosis,
        scaleCalibration,
        stage: 'gemini-3.8-flash-lite-tts',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // SPOKEN SCALE NOTICE TTS: Cached neural speech for opt-out / scale prompts
  // ---------------------------------------------------------------------------
  const spokenNoticeCache = new Map<string, { wavBuffer: Buffer; mimeType: string }>();

  app.post('/api/speak-notice', async (req: Request, res: Response) => {
    const rawText =
      typeof req.body?.text === 'string' && req.body.text.trim().length > 0
        ? req.body.text.trim().slice(0, 480)
        : WHY_SCALE_MATTERS_SPOKEN;
    const lang = normalizeBcp47Language(
      typeof req.body?.language === 'string' ? req.body.language : undefined,
      'en-US'
    );
    const cacheKey = `${lang}:${rawText}`;

    const cached = spokenNoticeCache.get(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', cached.mimeType);
      res.setHeader('Content-Length', String(cached.wavBuffer.length));
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(cached.wavBuffer);
    }

    const clients = getGeminiClients();
    if (!clients) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured.',
        fallbackText: rawText,
      });
    }

    try {
      const ttsInteraction = await clients.interactionsAi.interactions.create({
        model: 'gemini-3.8-flash-lite-tts',
        input: [
          {
            type: 'text',
            text: rawText,
            annotations: [
              {
                type: 'speech_metadata',
                style: 'Warm, clear, reassuring repair assistant speaking concisely',
              },
            ],
          },
        ],
        store: false,
        response_format: { type: 'audio' },
        generation_config: {
          speech_config: [{ language: lang, voice: 'Kore' }],
        },
      });

      const outputAudio = ttsInteraction.output_audio;
      if (!outputAudio?.data) {
        return res.status(502).json({ error: 'No audio payload returned.', fallbackText: rawText });
      }

      const wavBuffer = Buffer.from(outputAudio.data, 'base64');
      const mimeType = outputAudio.mime_type || 'audio/wav';
      if (spokenNoticeCache.size < 32) {
        spokenNoticeCache.set(cacheKey, { wavBuffer, mimeType });
      }
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', String(wavBuffer.length));
      return res.status(200).send(wavBuffer);
    } catch (err) {
      const { status, message } = extractErrorDetails(err);
      return res.status(status).json({ error: message, fallbackText: rawText });
    }
  });

  // ---------------------------------------------------------------------------
  // GUIDED DEMO NARRATION: Cached Neural Voiceover (`gemini-3.8-flash-lite-tts`)
  // Synthesizes each onboarding demo cue (`intro`, `step-1`, `step-2`, `step-3`)
  // once via Gemini TTS and caches the 24kHz RIFF WAV in memory so subsequent
  // visits and step transitions play with zero latency.
  // ---------------------------------------------------------------------------
  const demoNarrationCache = new Map<string, { wavBuffer: Buffer; mimeType: string }>();

  app.get('/api/demo-narration', async (req: Request, res: Response) => {
    const rawCue = typeof req.query.cue === 'string' ? req.query.cue.trim() : 'intro';
    if (!isValidDemoCueId(rawCue)) {
      return res.status(400).json({ error: 'Invalid demo narration cue.' });
    }

    const cue = DEMO_NARRATION_CUES[rawCue];
    const cached = demoNarrationCache.get(rawCue);
    if (cached) {
      res.setHeader('Content-Type', cached.mimeType);
      res.setHeader('Content-Length', String(cached.wavBuffer.length));
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Demo-Cue', rawCue);
      res.setHeader('X-Demo-Cache', 'HIT');
      return res.status(200).send(cached.wavBuffer);
    }

    const clients = getGeminiClients();
    if (!clients) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server.',
        fallbackText: cue.spokenText,
      });
    }

    try {
      const tts = await clients.interactionsAi.interactions.create({
        model: 'gemini-3.8-flash-lite-tts',
        input: [
          {
            type: 'text',
            text: cue.spokenText,
            annotations: [
              {
                type: 'speech_metadata',
                style:
                  'Warm, reassuring, natural product guide speaking clearly at a conversational pace',
              },
            ],
          },
        ],
        store: false,
        response_format: { type: 'audio' },
        generation_config: {
          speech_config: [{ language: 'en-US', voice: 'Kore' }],
        },
      });

      const outputAudio = tts.output_audio;
      if (!outputAudio?.data) {
        return res.status(502).json({
          error: 'Demo narration TTS returned no audio.',
          fallbackText: cue.spokenText,
        });
      }

      const wavBuffer = Buffer.from(outputAudio.data, 'base64');
      const mimeType = outputAudio.mime_type || 'audio/wav';
      demoNarrationCache.set(rawCue, { wavBuffer, mimeType });

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', String(wavBuffer.length));
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Demo-Cue', rawCue);
      res.setHeader('X-Demo-Cache', 'MISS');
      return res.status(200).send(wavBuffer);
    } catch (err) {
      const { status, message } = extractErrorDetails(err);
      return res.status(status).json({
        error: `Demo narration synthesis failed: ${message}`,
        fallbackText: cue.spokenText,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Frontend Serving: Vite Dev Middleware (AI Studio Port 3000) / Static dist/
  // ---------------------------------------------------------------------------
  const httpServer = http.createServer(app);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    // Disable Vite HMR WebSockets when DISABLE_HMR=true or running behind the
    // Cloud Run / AI Studio HTTPS preview proxy (K_SERVICE), preventing
    // "@vite/client: WebSocket closed without opened" console errors.
    const disableHmr =
      process.env.DISABLE_HMR === 'true' || Boolean(process.env.K_SERVICE);

    if (disableHmr) {
      // Serve a lightweight zero-WebSocket /@vite/client shim before vite.middlewares.
      // Preserves CSS injection (updateStyle/removeStyle) and React Fast Refresh
      // import.meta.hot stubs while never opening a dev WebSocket connection.
      const NOOP_VITE_CLIENT_ESM = [
        'const sheetsMap = new Map();',
        'export function updateStyle(id, content) {',
        '  let style = sheetsMap.get(id);',
        '  if (!style) {',
        '    style = document.createElement("style");',
        '    style.setAttribute("type", "text/css");',
        '    style.setAttribute("data-vite-dev-id", id);',
        '    style.textContent = content;',
        '    document.head.appendChild(style);',
        '    sheetsMap.set(id, style);',
        '  } else {',
        '    style.textContent = content;',
        '  }',
        '}',
        'export function removeStyle(id) {',
        '  const style = sheetsMap.get(id);',
        '  if (style) {',
        '    document.head.removeChild(style);',
        '    sheetsMap.delete(id);',
        '  }',
        '}',
        'export function injectQuery(url, queryToInject) {',
        '  if (!url || (!url.startsWith(".") && !url.startsWith("/"))) return url;',
        '  const [pathname, search] = url.split("?");',
        '  return `${pathname}?${queryToInject}${search ? "&" + search : ""}`;',
        '}',
        'export function createHotContext() {',
        '  return {',
        '    data: {},',
        '    accept() {},',
        '    acceptExports() {},',
        '    dispose() {},',
        '    prune() {},',
        '    decline() {},',
        '    invalidate() {},',
        '    on() {},',
        '    off() {},',
        '    send() {},',
        '  };',
        '}',
        'export class ErrorOverlay extends HTMLElement {}',
      ].join('\n');

      app.get('/@vite/client', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(NOOP_VITE_CLIENT_ESM);
      });
    }

    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : { server: httpServer },
        ws: disableHmr ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[JackOfAllTrades] Express + PWA listening on http://0.0.0.0:${PORT}`);
  });
}

createApp().catch((err) => {
  console.error('[JackOfAllTrades] Fatal startup error:', err);
  process.exit(1);
});
