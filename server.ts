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

  app.get('/api/db/status', async (_req: Request, res: Response) => {
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
          'Set SQL_DB_NAME, SQL_USER, and SQL_PASSWORD in runtime secrets to enable live Cloud SQL queries. Falling back to InMemoryOntologyGraph.',
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
      return res.status(503).json({
        connected: false,
        configured: true,
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

  app.post('/api/ontology/search', (req: Request, res: Response) => {
    const {
      queryVector,
      scaleAnchor = 'none',
      hasWebXRDepth = false,
      limit = 4,
    } = req.body ?? {};

    const vector = Array.isArray(queryVector) && queryVector.length > 0
      ? buildFeatureVector(queryVector.map(Number))
      : buildFeatureVector([0.14, 0.16, 0.87, 0.43, 0.10, 0.07, 0.06, 0.09]);

    const matches = localOntology.searchRagSubgraph(
      vector,
      scaleAnchor as ScaleAnchorType,
      Boolean(hasWebXRDepth),
      Number(limit) || 4
    );

    return res.json({
      hasScaleAnchor: Boolean(hasWebXRDepth) || scaleAnchor !== 'none',
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

  app.post('/api/ontology/deflection', (req: Request, res: Response) => {
    const computeCostUsd = Number(req.body?.computeCostUsd ?? 1.45);
    const flywheel = localOntology.recordDeflection(
      Number.isFinite(computeCostUsd) && computeCostUsd > 0 ? computeCostUsd : 1.45
    );
    return res.json({ status: 'recorded', flywheel });
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
    // -------------------------------------------------------------------------
    const hasScaleReference = Boolean(hasWebXRDepth) || scaleAnchor !== 'none';
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
          'You are JackOfAllTrades, a precision physical repair and assembly diagnostic engine. ' +
          'Analyze the 15-second frame buffer alongside the PostgreSQL Ontology RAG matches. ' +
          'CRITICAL SAFETY RULE (Break 2 — Scale Hallucination Guard): ' +
          (hasScaleReference
            ? `A calibrated scale reference is ACTIVE (${hasWebXRDepth ? 'WebXR depth map' : scaleAnchor}). You may recommend exact metric/imperial tool sizes.`
            : 'NO WebXR depth data and NO physical scale anchor (coin, credit card, thumb) is present. You are STRICTLY BARRED from recommending a specific numeric tool size (e.g., 10mm, M4, 3/8"). Set requiresScaleAnchor=true, toolSizeSpec=null, and instruct the user to place a coin, credit card, or thumb beside the part first.') +
          ' Return concise, actionable JSON only.',
        input: [
          ...multimodalInput,
          {
            type: 'text',
            text:
              `\nDecisions API trigger: ${route.dominantTrigger} (confidence=${route.maxAnomalyConfidence}).\n` +
              `Ontology RAG Subgraph:\n${ragContextText}\n` +
              'Diagnose the visible component, failure precursor, next physical action, and PiP hand-motion prompt.',
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

      // Hard programmatic enforcement of Break 2 Scale Anchor Invariant
      const scaleGated = enforceScaleAnchorInvariant(
        {
          toolRequired: String(parsedDiagnosis.toolRequired || 'Hand Inspection'),
          toolSizeSpec: parsedDiagnosis.toolSizeSpec ? String(parsedDiagnosis.toolSizeSpec) : null,
          requiresScaleAnchor: Boolean(parsedDiagnosis.requiresScaleAnchor ?? true),
          instructionText: String(parsedDiagnosis.nextStepInstruction || ''),
        },
        scaleAnchor as ScaleAnchorType,
        Boolean(hasWebXRDepth)
      );

      return res.json({
        escalatedToNeon: true,
        downgradeToBurst: false,
        decisionModel: 'gemini-decision-1',
        reasoningModel: 'gemini-4-neon',
        decisionScores,
        decisionUsage,
        route,
        ragMatches,
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
  // Frontend Serving: Vite Dev Middleware (AI Studio Port 3000) / Static dist/
  // ---------------------------------------------------------------------------
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[JackOfAllTrades] Express + PWA listening on http://0.0.0.0:${PORT}`);
  });
}

createApp().catch((err) => {
  console.error('[JackOfAllTrades] Fatal startup error:', err);
  process.exit(1);
});
