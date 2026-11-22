// server.ts
import "dotenv/config";
import express from "express";
import http from "node:http";
import fs2 from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { GoogleGenAI, Type } from "@google/genai";

// src/lib/routingLogic.ts
var ANOMALY_CONFIDENCE_THRESHOLD = 0.78;
function evaluateDecisionsRouting(scores, threshold = ANOMALY_CONFIDENCE_THRESHOLD) {
  if (scores.visualNoiseExtreme >= threshold) {
    return {
      shouldEscalateToNeon: false,
      shouldDowngradeToBurst: true,
      dominantTrigger: "visual_noise_extreme",
      maxAnomalyConfidence: scores.visualNoiseExtreme,
      reason: "Decisions API detected extreme glare, water droplets, or motion blur. Downgrading to 3-shot burst photography."
    };
  }
  const candidates = [
    { key: "hazard_proximity", value: scores.hazardProximity },
    { key: "alignment_anomaly", value: scores.alignmentAnomaly },
    { key: "user_stalled", value: scores.userStalled }
  ];
  candidates.sort((a, b) => b.value - a.value);
  const top = candidates[0];
  if (top.value >= threshold) {
    return {
      shouldEscalateToNeon: true,
      shouldDowngradeToBurst: false,
      dominantTrigger: top.key,
      maxAnomalyConfidence: top.value,
      reason: `High-confidence anomaly (${top.key} = ${(top.value * 100).toFixed(1)}%). Waking gemini-4-neon with 15-second buffer + ontology RAG.`
    };
  }
  return {
    shouldEscalateToNeon: false,
    shouldDowngradeToBurst: false,
    dominantTrigger: "nominal",
    maxAnomalyConfidence: top.value,
    reason: "Nominal progress verified with zero output tokens. Holding gemini-4-neon asleep."
  };
}
function enforceScaleAnchorInvariant(advice, scaleAnchor, hasWebXRDepth) {
  const hasScaleReference = hasWebXRDepth || scaleAnchor !== "none";
  if (advice.requiresScaleAnchor && !hasScaleReference) {
    return {
      toolRequired: advice.toolRequired,
      toolSizeSpec: "Locked \u2014 Scale anchor required",
      scaleGuardBlocked: true,
      instructionText: "Place a standard reference object (US quarter coin, credit card, or your thumb) beside the part before selecting a specific tool size.",
      anchorPrompt: "Place a coin, credit card, or your thumb next to the component so scale can be calibrated safely."
    };
  }
  return {
    toolRequired: advice.toolRequired,
    toolSizeSpec: advice.toolSizeSpec ?? "Standard hand fit",
    scaleGuardBlocked: false,
    instructionText: advice.instructionText,
    anchorPrompt: null
  };
}
function cosineSimilarity(a, b) {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}
function buildFeatureVector(seedValues) {
  const norm = Math.sqrt(seedValues.reduce((acc, v) => acc + v * v, 0)) || 1;
  return seedValues.map((v) => Number((v / norm).toFixed(6)));
}
function createSeedOntologyNodes() {
  return [
    {
      id: 1,
      parentId: null,
      manualSku: "NFP-HINGE-110",
      brandName: "NordicFlatPack Furnishings",
      name: "Cabinet Door Assembly",
      partCode: "CAB-DOOR-01",
      componentClass: "assembly",
      measurementSystem: "metric",
      threadPitchMm: null,
      nominalDiameterMm: null,
      visualCueNotes: "Vertical melamine door panel with 35mm concealed cup bore.",
      failurePrecursorCue: "Door sagging > 3mm at top latch corner.",
      actionType: "inspect",
      toolRequired: "Spirit Level",
      toolSizeSpec: "Standard 300mm level",
      requiresScaleAnchor: false,
      rotationDirection: "linear",
      instructionText: "Confirm cabinet carcase is square before snapping hinge arms onto mounting plates.",
      pipMotionPrompt: "Close-up hand checking alignment of cabinet door edge against frame.",
      successRate: 0.96,
      correctionCount: 4,
      embedding: buildFeatureVector([0.92, 0.25, 0.1, 0.08, 0.12, 0.05, 0.14, 0.2])
    },
    {
      id: 2,
      parentId: 1,
      manualSku: "NFP-HINGE-110",
      brandName: "NordicFlatPack Furnishings",
      name: "110-Deg Concealed Hinge Arm",
      partCode: "HNG-ARM-110",
      componentClass: "subassembly",
      measurementSystem: "metric",
      threadPitchMm: null,
      nominalDiameterMm: 35,
      visualCueNotes: "Brushed steel articulated hinge arm with dual depth/lateral cam screws.",
      failurePrecursorCue: "Bracket angled > 12 degrees off mounting plate track (Tokyo->Chicago flywheel cue).",
      actionType: "align",
      toolRequired: "Phillips Screwdriver",
      toolSizeSpec: "#2 Phillips driver",
      requiresScaleAnchor: false,
      rotationDirection: "angled",
      instructionText: "Tilt the hinge bracket 15 degrees inward to hook the front pins, then press the rear heel until it snaps flush.",
      pipMotionPrompt: "Hands tilting brushed steel concealed cabinet hinge at 15-degree angle onto mounting plate until snap click.",
      successRate: 0.942,
      correctionCount: 19,
      embedding: buildFeatureVector([0.84, 0.52, 0.14, 0.05, 0.09, 0.11, 0.2, 0.18])
    },
    {
      id: 3,
      parentId: 2,
      manualSku: "NFP-HINGE-110",
      brandName: "NordicFlatPack Furnishings",
      name: "M4 Machine Screw (Hinge Plate)",
      partCode: "ISO-M4-12",
      componentClass: "fastener",
      measurementSystem: "metric",
      threadPitchMm: 0.7,
      nominalDiameterMm: 4,
      visualCueNotes: "Fine 0.7mm thread pitch; 4mm shank diameter; compact pan/socket head.",
      failurePrecursorCue: "Frequently misidentified as M6 screw at close macro range without scale anchor.",
      actionType: "tighten",
      toolRequired: "Hex / Phillips Driver",
      toolSizeSpec: "M4 driver (2.5mm hex / PH2)",
      requiresScaleAnchor: true,
      rotationDirection: "clockwise",
      instructionText: "Seat the M4 screw square to the mounting plate pilot hole and tighten clockwise to 1.8 Nm.",
      pipMotionPrompt: "Fingers aligning M4 screw into steel hinge plate and turning driver smoothly clockwise.",
      successRate: 0.915,
      correctionCount: 12,
      embedding: buildFeatureVector([0.16, 0.18, 0.82, 0.48, 0.12, 0.09, 0.08, 0.11])
    },
    {
      id: 4,
      parentId: null,
      manualSku: "ISO-METRIC-FAST",
      brandName: "Precision Fastener Standards",
      name: "M6 Hex Socket Cap Screw",
      partCode: "ISO-M6-20",
      componentClass: "fastener",
      measurementSystem: "metric",
      threadPitchMm: 1,
      nominalDiameterMm: 6,
      visualCueNotes: "Coarse 1.0mm thread pitch; 10mm cylindrical socket head; 5mm hex key recess.",
      failurePrecursorCue: "Stripped socket recess when driven with undersized 4mm hex key.",
      actionType: "tighten",
      toolRequired: "Metric Hex Key",
      toolSizeSpec: "5mm hex key (for M6 cap screw)",
      requiresScaleAnchor: true,
      rotationDirection: "clockwise",
      instructionText: "Verify 5mm hex key seats fully to the bottom of the M6 socket recess before applying clockwise torque.",
      pipMotionPrompt: "Hand inserting 5mm hex key straight into M6 socket head cap screw and rotating clockwise.",
      successRate: 0.892,
      correctionCount: 9,
      embedding: buildFeatureVector([0.14, 0.16, 0.86, 0.44, 0.1, 0.07, 0.06, 0.09])
    },
    {
      id: 5,
      parentId: null,
      manualSku: "ISO-METRIC-FAST",
      brandName: "Precision Fastener Standards",
      name: "M10 Metric Hex Bolt",
      partCode: "ISO-M10-150",
      componentClass: "fastener",
      measurementSystem: "metric",
      threadPitchMm: 1.5,
      nominalDiameterMm: 10,
      visualCueNotes: "Thread pitch 1.5mm; 10mm shank; metric 8.8 head marking.",
      failurePrecursorCue: "Confused with 3/8-inch imperial bolt; requires 10mm/17mm metric socket, not imperial.",
      actionType: "tighten",
      toolRequired: "Metric Socket Wrench",
      toolSizeSpec: '10mm metric socket (NOT 3/8" imperial)',
      requiresScaleAnchor: true,
      rotationDirection: "clockwise",
      instructionText: "Switch to a calibrated metric socket\u2014do not force an imperial 3/8-inch tool onto 1.5mm pitch metric hardware.",
      pipMotionPrompt: "Mechanic fitting metric socket onto hex bolt head and tightening clockwise in steady quarter turns.",
      successRate: 0.931,
      correctionCount: 15,
      embedding: buildFeatureVector([0.1, 0.14, 0.56, 0.78, 0.16, 0.08, 0.05, 0.07])
    },
    {
      id: 7,
      parentId: null,
      manualSku: "AFP-PTRAP-150",
      brandName: "AquaFlow Residential Plumbing",
      name: "Kitchen Sink P-Trap Assembly",
      partCode: "PTRAP-CH-150",
      componentClass: "assembly",
      measurementSystem: "imperial",
      threadPitchMm: null,
      nominalDiameterMm: 38.1,
      visualCueNotes: "Reflective chrome-plated brass J-bend under kitchen basin.",
      failurePrecursorCue: "Flashlight specular glare + water droplets degrade continuous video tracking.",
      actionType: "inspect",
      toolRequired: "Microfiber Cloth & Bucket",
      toolSizeSpec: 'Standard 1-1/2" drain union',
      requiresScaleAnchor: false,
      rotationDirection: "linear",
      instructionText: "Wipe lens and chrome nut dry, then verify the J-bend tailpiece sits vertically without shear stress.",
      pipMotionPrompt: "Hand wiping wet chrome P-trap pipe under sink with cloth to reveal compression nut threading.",
      successRate: 0.908,
      correctionCount: 11,
      embedding: buildFeatureVector([0.08, 0.11, 0.1, 0.12, 0.92, 0.34, 0.09, 0.05])
    },
    {
      id: 8,
      parentId: 7,
      manualSku: "AFP-PTRAP-150",
      brandName: "AquaFlow Residential Plumbing",
      name: "Chrome Slip-Joint Compression Nut",
      partCode: "NUT-SJ-150",
      componentClass: "fastener",
      measurementSystem: "imperial",
      threadPitchMm: null,
      nominalDiameterMm: 42,
      visualCueNotes: "Hexagonal chrome nut sealing nylon slip-joint washer.",
      failurePrecursorCue: "Cross-threading risk when forced under low visibility and active spray.",
      actionType: "tighten",
      toolRequired: "Slip-Joint Pliers",
      toolSizeSpec: '1-1/2" slip-joint jaw',
      requiresScaleAnchor: true,
      rotationDirection: "clockwise",
      instructionText: "Seat the beveled nylon washer bevel-down, hand-thread clockwise until seated, then finish with one quarter turn.",
      pipMotionPrompt: "Close-up hand threading chrome slip-joint nut clockwise by hand, then applying quarter turn with pliers.",
      successRate: 0.896,
      correctionCount: 14,
      embedding: buildFeatureVector([0.09, 0.1, 0.12, 0.15, 0.85, 0.5, 0.08, 0.06])
    },
    {
      id: 9,
      parentId: null,
      manualSku: "SAM-DW-IMP400",
      brandName: "Samsung Home Appliances",
      name: "Dishwasher Drain Impeller Assembly",
      partCode: "IMP-400-ASM",
      componentClass: "assembly",
      measurementSystem: "metric",
      threadPitchMm: null,
      nominalDiameterMm: null,
      visualCueNotes: "Lower sump impeller housing beneath removable coarse filter screen.",
      failurePrecursorCue: "Rhythmic acoustic cavitation grinding sound during drain pump cycle.",
      actionType: "inspect",
      toolRequired: "Inspection Flashlight",
      toolSizeSpec: "No socket required",
      requiresScaleAnchor: false,
      rotationDirection: "linear",
      instructionText: "Clear glass or seed debris around impeller vanes before re-seating the sump cover.",
      pipMotionPrompt: "Hand lifting dishwasher sump cover to inspect drain impeller vanes for trapped debris.",
      successRate: 0.948,
      correctionCount: 7,
      embedding: buildFeatureVector([0.07, 0.09, 0.08, 0.06, 0.14, 0.12, 0.91, 0.34])
    },
    {
      id: 10,
      parentId: 9,
      manualSku: "SAM-DW-IMP400",
      brandName: "Samsung Home Appliances",
      name: "Clockwise Snap-Lock Retaining Clip",
      partCode: "CLIP-CW-09",
      componentClass: "fastener",
      measurementSystem: "metric",
      threadPitchMm: null,
      nominalDiameterMm: 28,
      visualCueNotes: "Molded wear-pattern ramp on dark polymer clip clearly slants clockwise.",
      failurePrecursorCue: "Forcing retaining clip counter-clockwise snaps the plastic retention lug.",
      actionType: "rotate_clockwise",
      toolRequired: "Finger Grip",
      toolSizeSpec: "No wrench \u2014 manual 30-deg clockwise twist",
      requiresScaleAnchor: false,
      rotationDirection: "clockwise",
      instructionText: "Stop pushing counter-clockwise. Press gently and rotate the retaining clip 30 degrees CLOCKWISE to release.",
      pipMotionPrompt: "Close-up fingers pressing and turning dishwasher polymer retaining clip 30 degrees clockwise to unlock.",
      successRate: 0.964,
      correctionCount: 21,
      embedding: buildFeatureVector([0.06, 0.08, 0.09, 0.07, 0.12, 0.11, 0.84, 0.52])
    }
  ];
}
var InMemoryOntologyGraph = class {
  constructor(seedNodes = createSeedOntologyNodes()) {
    this.feedbackLog = [];
    this.deflectedCount = 42;
    this.totalComputeUsd = 58.4;
    this.nodes = new Map(seedNodes.map((n) => [n.id, { ...n, embedding: [...n.embedding] }]));
  }
  getAllNodes() {
    return Array.from(this.nodes.values()).sort((a, b) => a.id - b.id);
  }
  getNode(id) {
    return this.nodes.get(id);
  }
  /**
   * Mirrors `v_component_hierarchy` & `get_component_hierarchy(root_id)` Recursive CTE with cycle protection.
   */
  getHierarchyTree(rootId) {
    const result = [];
    const all = this.getAllNodes();
    const roots = rootId !== void 0 ? all.filter((n) => n.id === rootId) : all.filter((n) => n.parentId === null);
    const traverse = (node, depth, visited, path2) => {
      if (visited.has(node.id) || depth > 10) return;
      const nextVisited = new Set(visited);
      nextVisited.add(node.id);
      const breadcrumb = path2 ? `${path2} > ${node.name}` : node.name;
      result.push({
        id: node.id,
        parentId: node.parentId,
        name: node.name,
        componentClass: node.componentClass,
        depth,
        breadcrumbPath: breadcrumb,
        failurePrecursorCue: node.failurePrecursorCue,
        toolRequired: node.toolRequired,
        toolSizeSpec: node.toolSizeSpec,
        requiresScaleAnchor: node.requiresScaleAnchor,
        successRate: node.successRate,
        correctionCount: node.correctionCount
      });
      const children = all.filter((c) => c.parentId === node.id);
      for (const child of children) {
        traverse(child, depth + 1, nextVisited, breadcrumb);
      }
    };
    for (const r of roots) {
      traverse(r, 0, /* @__PURE__ */ new Set(), "");
    }
    return result;
  }
  /**
   * Mirrors `get_component_ancestry(target_id)` bottom-up Recursive CTE.
   */
  getAncestryBreadcrumb(targetId) {
    const chain = [];
    const visited = /* @__PURE__ */ new Set();
    let current = this.nodes.get(targetId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.unshift(current.name);
      current = current.parentId !== null ? this.nodes.get(current.parentId) : void 0;
    }
    return chain.join(" > ");
  }
  /**
   * Mirrors `rag_search_ontology_subgraph(...)`: pgvector cosine similarity + Recursive CTE ancestry + Break 2 guard.
   */
  searchRagSubgraph(queryEmbedding, scaleAnchor, hasWebXRDepth, limit = 4) {
    const scored = this.getAllNodes().map((node) => ({
      component: node,
      similarity: Number(cosineSimilarity(queryEmbedding, node.embedding).toFixed(4))
    })).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
    return scored.map(({ component, similarity }) => ({
      component,
      ancestryPath: this.getAncestryBreadcrumb(component.id),
      similarity,
      scaleGatedAdvice: enforceScaleAnchorInvariant(
        {
          toolRequired: component.toolRequired,
          toolSizeSpec: component.toolSizeSpec,
          requiresScaleAnchor: component.requiresScaleAnchor,
          instructionText: component.instructionText
        },
        scaleAnchor,
        hasWebXRDepth
      )
    }));
  }
  /**
   * Mirrors `apply_ontology_correction(...)` (Test Case 2: M4 vs M6 screw).
   * Updates the corrected component's visual_signature_embedding so subsequent RAG scans
   * immediately rank the corrected component #1 without retraining.
   */
  applyCorrection(params) {
    const target = this.nodes.get(params.correctedComponentId);
    if (!target) {
      throw new Error(`Component ID ${params.correctedComponentId} not found in ontology graph.`);
    }
    const predicted = this.nodes.get(params.predictedComponentId);
    target.embedding = buildFeatureVector(params.capturedEmbedding);
    target.correctionCount += 1;
    target.successRate = Math.min(0.995, Number((target.successRate + 4e-3).toFixed(4)));
    if (predicted && predicted.id !== target.id) {
      const nudged = predicted.embedding.map((v, idx) => {
        const q = target.embedding[idx] ?? 0;
        return Math.max(0.01, v - 0.15 * q);
      });
      predicted.embedding = buildFeatureVector(nudged);
    }
    const event = {
      id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      predictedComponentId: params.predictedComponentId,
      predictedName: predicted?.name ?? `Component #${params.predictedComponentId}`,
      correctedComponentId: target.id,
      correctedName: target.name,
      tag: params.tag,
      regionCode: params.regionCode ?? "US-CHI"
    };
    this.feedbackLog.unshift(event);
    if (this.feedbackLog.length > 30) {
      this.feedbackLog.pop();
    }
    return { updated: target, event };
  }
  recordDeflection(computeCostUsd = 1.45) {
    this.deflectedCount += 1;
    this.totalComputeUsd = Number((this.totalComputeUsd + computeCostUsd).toFixed(2));
    return this.getFlywheelMetrics();
  }
  getFeedbackLog() {
    return [...this.feedbackLog];
  }
  getFlywheelMetrics() {
    const bountyUsd = 30;
    const revenueUsd = this.deflectedCount * bountyUsd;
    const avgComputePerSession = this.deflectedCount > 0 ? this.totalComputeUsd / this.deflectedCount : 1.5;
    const marginMultiple = avgComputePerSession > 0 ? bountyUsd / avgComputePerSession : 20;
    return {
      deflectedReturns: this.deflectedCount,
      bountyPerDeflectionUsd: bountyUsd,
      grossBountyRevenueUsd: revenueUsd,
      totalComputeUsd: this.totalComputeUsd,
      marginMultiple: Number(marginMultiple.toFixed(1)),
      totalCorrections: this.getAllNodes().reduce((sum, n) => sum + n.correctionCount, 0)
    };
  }
};

// src/lib/dbConfig.ts
import fs from "node:fs";
var DEFAULT_SQL_PORT = 5432;
var DEFAULT_SQL_CONNECTION_NAME = "gemini4nyc26nyc-2273:us-east1:free-trial-first-project";
var DEFAULT_SQL_PUBLIC_IP = "34.74.102.222";
var DEFAULT_SQL_OUTGOING_IP = "34.73.184.213";
var LOCAL_HOSTS = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "::1"]);
var PLACEHOLDER_SECRETS = /* @__PURE__ */ new Set([
  "CHANGE_ME_IN_SECRET_MANAGER",
  "MY_SQL_PASSWORD",
  "REPLACE_ME"
]);
function parsePort(rawPort, fallback) {
  if (!rawPort) return fallback;
  const parsed = Number.parseInt(rawPort.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}
function resolveCloudSqlPoolConfig(env, options = {}) {
  const connectionName = (env.SQL_CONNECTION_NAME || env.SQL_Connection_Name || DEFAULT_SQL_CONNECTION_NAME).trim();
  const publicIp = (env.SQL_PUBLIC_IP || DEFAULT_SQL_PUBLIC_IP).trim();
  const outgoingIp = (env.SQL_OUTGOING_IP || env.SQL_Outgoing_IP || DEFAULT_SQL_OUTGOING_IP).trim();
  const port = parsePort(env.SQL_PORT || env.DB_PORT, DEFAULT_SQL_PORT);
  const database = (env.SQL_DB_NAME || env.DB_NAME || "").trim();
  const user = (env.SQL_USER || env.DB_USER || "").trim();
  const password = env.SQL_PASSWORD ?? env.DB_PASS;
  const explicitHost = (env.SQL_HOST || env.DB_HOST || "").trim();
  const socketPath = `/cloudsql/${connectionName}`;
  const checkSocketExists = options.socketExists ?? ((p) => fs.existsSync(p));
  const useUnixSocket = env.SQL_USE_UNIX_SOCKET?.trim().toLowerCase() === "true" || Boolean(env.K_SERVICE?.trim()) && checkSocketExists(socketPath);
  if (!database || !user || password && PLACEHOLDER_SECRETS.has(password.trim())) {
    return {
      poolConfig: null,
      transport: "unconfigured",
      connectionName,
      publicIp,
      outgoingIp,
      port,
      sslEnabled: false,
      hostSummary: useUnixSocket ? socketPath : `${publicIp}:${port}`
    };
  }
  let host;
  let transport;
  if (explicitHost) {
    if (explicitHost.startsWith("/cloudsql/")) {
      if (Boolean(env.K_SERVICE?.trim()) && !checkSocketExists(explicitHost)) {
        host = publicIp;
        transport = "public_ip_tcp";
      } else {
        host = explicitHost;
        transport = "cloud_sql_socket";
      }
    } else if (explicitHost.toLowerCase() === "postgres" && Boolean(env.K_SERVICE?.trim()) && publicIp) {
      host = publicIp;
      transport = "public_ip_tcp";
    } else if (explicitHost === publicIp) {
      host = explicitHost;
      transport = "public_ip_tcp";
    } else {
      host = explicitHost;
      transport = "custom_tcp";
    }
  } else if (useUnixSocket) {
    host = socketPath;
    transport = "cloud_sql_socket";
  } else {
    host = publicIp;
    transport = "public_ip_tcp";
  }
  if (transport === "cloud_sql_socket") {
    return {
      poolConfig: {
        host,
        database,
        user,
        password,
        max: 10,
        connectionTimeoutMillis: 5e3,
        idleTimeoutMillis: 3e4,
        ssl: false
      },
      transport,
      connectionName,
      publicIp,
      outgoingIp,
      port,
      sslEnabled: false,
      hostSummary: host
    };
  }
  const sslCa = (env.SQL_SSL_CA || env.DB_SSL_CA || "").trim();
  const sslFlag = (env.SQL_SSL ?? env.DB_SSL)?.trim().toLowerCase();
  const isLocalHost = LOCAL_HOSTS.has(host.toLowerCase());
  let ssl = false;
  if (sslCa) {
    ssl = { ca: sslCa, rejectUnauthorized: true };
  } else if (sslFlag === "false") {
    ssl = false;
  } else if (sslFlag === "true" || !isLocalHost) {
    ssl = { rejectUnauthorized: false };
  }
  return {
    poolConfig: {
      host,
      port,
      database,
      user,
      password,
      max: 10,
      connectionTimeoutMillis: 4e3,
      idleTimeoutMillis: 3e4,
      ssl
    },
    transport,
    connectionName,
    publicIp,
    outgoingIp,
    port,
    sslEnabled: Boolean(ssl),
    hostSummary: `${host}:${port}`
  };
}

// src/lib/audioUtils.ts
var EXPERT_MECHANIC_SYSTEM_PROMPT = "You are an expert mechanic. Detect the exact spoken language of the user's audio query and respond in that exact same language using the visual context provided. Keep your spoken response under 3 sentences. Be direct and actionable.";
var MAX_AUDIO_UPLOAD_BYTES = 10 * 1024 * 1024;
var SUPPORTED_AUDIO_MIME_TYPES = /* @__PURE__ */ new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/flac"
]);
var SHORT_LANGUAGE_DEFAULTS = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT",
  pt: "pt-BR",
  ja: "ja-JP",
  ko: "ko-KR",
  zh: "zh-CN",
  ar: "ar-EG",
  hi: "hi-IN",
  ru: "ru-RU",
  nl: "nl-NL",
  pl: "pl-PL",
  tr: "tr-TR",
  vi: "vi-VN",
  th: "th-TH",
  id: "id-ID",
  uk: "uk-UA",
  sv: "sv-SE"
};
function normalizeBcp47Language(rawCode, fallback = "en-US") {
  const safeFallback = /^[a-z]{2,3}-[A-Z]{2}$/.test(fallback) ? fallback : "en-US";
  if (!rawCode || typeof rawCode !== "string") return safeFallback;
  const cleaned = rawCode.trim().replace(/_/g, "-");
  if (!cleaned) return safeFallback;
  const lower = cleaned.toLowerCase();
  if (/^[a-z]{2}$/.test(lower)) {
    return SHORT_LANGUAGE_DEFAULTS[lower] ?? `${lower}-${lower.toUpperCase()}`;
  }
  const parts = cleaned.split("-").filter(Boolean);
  if (parts.length === 2 && /^[a-z]{2,3}$/i.test(parts[0]) && /^[a-z0-9]{2,4}$/i.test(parts[1])) {
    return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
  }
  if (parts.length === 3 && /^[a-z]{2,3}$/i.test(parts[0]) && /^[a-z]{4}$/i.test(parts[1]) && /^[a-z]{2}$/i.test(parts[2])) {
    return `${parts[0].toLowerCase()}-${parts[2].toUpperCase()}`;
  }
  return safeFallback;
}
function normalizeAudioMimeType(rawMime) {
  if (!rawMime || typeof rawMime !== "string") return "audio/webm";
  const base = rawMime.split(";")[0].trim().toLowerCase();
  if (base === "audio/x-wav") return "audio/wav";
  if (SUPPORTED_AUDIO_MIME_TYPES.has(base)) return base;
  return "audio/webm";
}
function stripAudioDataUrl(input, fallbackMime = "audio/webm") {
  const trimmed = String(input || "").trim();
  const match = trimmed.match(/^data:([^,]+);base64,(.+)$/i);
  if (match) {
    return {
      mimeType: normalizeAudioMimeType(match[1]),
      base64: match[2].replace(/\s+/g, "")
    };
  }
  return {
    mimeType: normalizeAudioMimeType(fallbackMime),
    base64: trimmed.replace(/\s+/g, "")
  };
}
function validateAudioPayload(base64, maxBytes = MAX_AUDIO_UPLOAD_BYTES) {
  const clean = String(base64 || "").replace(/\s+/g, "");
  if (clean.length < 16) {
    return {
      ok: false,
      byteLength: 0,
      error: "Recording was too short. Hold the button while speaking your question."
    };
  }
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const byteLength = Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
  if (byteLength > maxBytes) {
    return {
      ok: false,
      byteLength,
      error: "Audio clip is too long. Keep your explanation brief and try again."
    };
  }
  return { ok: true, byteLength };
}
function enforceThreeSentenceCap(rawText) {
  const cleaned = String(rawText || "").replace(/```[\s\S]*?```/g, " ").replace(/[*_#`>]+/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "Hold the camera steady with a bit more light and describe what feels stuck.";
  }
  const sentences = cleaned.match(/[^.!?。！？؟।]+[.!?。！？؟।]+|[^.!?。！？؟।]+$/g) ?? [cleaned];
  const capped = sentences.map((s) => s.trim()).filter(Boolean).slice(0, 3).join(" ");
  return capped || cleaned;
}

// src/lib/demoNarration.ts
var DEMO_NARRATION_CUES = {
  intro: {
    id: "intro",
    spokenText: "Welcome to Jack of All Trades. This is a quick interactive demo showing how visual repair guidance works. Tap the highlighted battery latch on screen to see step-by-step instructions.",
    caption: "Interactive demo \xB7 Tap the highlighted battery latch to begin.",
    activeStepNumber: null,
    visualPhase: "loop"
  },
  "step-1": {
    id: "step-1",
    spokenText: "Step one: Press down gently with your thumb on the ridged release latch near the top of the cover.",
    caption: "Step 1 of 3 \xB7 Press down on the ridged latch",
    activeStepNumber: 1,
    visualPhase: "press"
  },
  "step-2": {
    id: "step-2",
    spokenText: "Step two: Keep light pressure and slide the cover straight down toward the molded arrow until it clicks loose.",
    caption: "Step 2 of 3 \xB7 Slide the cover toward the arrow",
    activeStepNumber: 2,
    visualPhase: "slide"
  },
  "step-3": {
    id: "step-3",
    spokenText: "Step three: Lift the cover up to reveal the batteries. You are all set\u2014tap Got It, Open Camera whenever you are ready for a live repair.",
    caption: "Step 3 of 3 \xB7 Lift cover to reveal batteries \xB7 Ready for camera",
    activeStepNumber: 3,
    visualPhase: "open"
  }
};
function isValidDemoCueId(value) {
  return value === "intro" || value === "step-1" || value === "step-2" || value === "step-3";
}

// src/lib/scaleCalibration.ts
var REFERENCE_OBJECT_DIMENSIONS_MM = {
  us_quarter: 24.26,
  coin: 24,
  credit_card: 85.6,
  human_thumb: 20,
  ruler: null,
  webxr_depth: null,
  none: null
};
var SCALE_CALIBRATION_PROMPT_GUIDE = 'KNOWN REFERENCE DIMENSIONS FOR PIXEL-RATIO MEASUREMENT:\n- US Quarter ("us_quarter"): 24.26 mm diameter\n- Standard Coin ("coin"): ~24.0 mm diameter\n- Credit / Debit / ID Card ("credit_card"): 85.60 mm wide x 53.98 mm tall\n- Adult Human Thumb ("human_thumb"): ~20.0 mm nail/pad width\n- Ruler / Tape Measure ("ruler"): read markings directly\nWhen any reference object is clearly visible on the same depth plane next to the target part, measure the target part width/head diameter as a ratio of the reference object, compute estimatedPartSizeMm, write a 1-sentence scaleMeasurementNote proving the measurement (e.g., "Compared to the 24.26 mm quarter, the bolt head is ~40% as wide (~10 mm), matching a 10mm socket"), and return anchorBox as [ymin, xmin, ymax, xmax] in 0..1000 coordinates.';
var WHY_SCALE_MATTERS_SUMMARY = "Camera lenses distort close-up distance and magnification, so a tiny screw can look identical to a much larger bolt. Placing a known-size object like a quarter, credit card, or your thumb beside the part lets us measure real dimensions and avoid recommending the wrong tool size.";
var WHY_SCALE_MATTERS_SPOKEN = "No problem, you can continue without scaling. Just keep in mind that camera lenses distort close-up size, so without a quarter, credit card, or your thumb beside the part, tool sizes are approximate\u2014test the fit gently before turning.";
var SCALE_REQUEST_BANNER = "Hold a quarter, credit card, or your thumb right beside the part and try again so we can confirm exact size\u2014or choose Continue Without Scaling.";
var SCALE_REQUEST_SPOKEN = "Please place a quarter, credit card, or your thumb next to the part so I can calibrate scale and confirm the exact tool size\u2014or let me know if you prefer to continue without scaling.";
function normalizeDetectedScaleObject(raw) {
  if (!raw || typeof raw !== "string") return "none";
  const cleaned = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (cleaned === "none" || cleaned === "null" || cleaned === "unknown" || cleaned === "no_object" || cleaned === "not_found") {
    return "none";
  }
  if (cleaned.includes("webxr") || cleaned.includes("depth")) return "webxr_depth";
  if (cleaned.includes("quarter")) return "us_quarter";
  if (cleaned.includes("coin") || cleaned.includes("penny") || cleaned.includes("dime") || cleaned.includes("nickel") || cleaned.includes("euro")) {
    return "coin";
  }
  if (cleaned.includes("credit_card") || cleaned.includes("bank_card") || cleaned.includes("debit_card") || cleaned.includes("id_card") || cleaned === "card") {
    return "credit_card";
  }
  if (cleaned.includes("thumb") || cleaned.includes("finger") || cleaned.includes("hand")) {
    return "human_thumb";
  }
  if (cleaned.includes("ruler") || cleaned.includes("tape_measure") || cleaned.includes("caliper") || cleaned.includes("measuring")) {
    return "ruler";
  }
  return "none";
}
function formatScaleObjectLabel(obj) {
  switch (obj) {
    case "us_quarter":
      return "quarter coin (24.26 mm)";
    case "coin":
      return "coin (~24 mm)";
    case "credit_card":
      return "credit card (85.6 mm)";
    case "human_thumb":
      return "your thumb (~20 mm)";
    case "ruler":
      return "ruler";
    case "webxr_depth":
      return "depth sensor";
    default:
      return "reference object";
  }
}
function mapDetectedObjectToScaleAnchor(obj) {
  switch (obj) {
    case "us_quarter":
    case "coin":
      return "us_quarter";
    case "credit_card":
      return "credit_card";
    case "human_thumb":
    case "ruler":
      return "human_thumb";
    case "webxr_depth":
      return "webxr_depth";
    default:
      return "none";
  }
}
var DECLINE_SCALE_PATTERNS = [
  /\b(don'?t|do not|dont)\s+(want|need|have)\s+(to\s+)?(scale|calibrate|an?\s+object|a\s+quarter|a\s+card|a\s+coin)\b/i,
  /\b(skip|ignore|bypass|disable|no)\s+(the\s+)?(scal(e|ing)|calibrat(e|ion)|reference\s+object|scale\s+object)\b/i,
  /\b(continue|proceed|go\s+ahead|just\s+help|keep\s+going)\s+without\s+(scal(e|ing)|an?\s+object|a\s+quarter|a\s+card|calibrat(e|ion))\b/i,
  /\bwithout\s+(scal(e|ing)|using\s+an?\s+object|a\s+reference\s+object)\b/i,
  /\bno\s+quiero\s+(usar\s+)?(escala|escalar|un\s+objeto|moneda|tarjeta)\b/i,
  /\bsin\s+(escala|escalar|objeto\s+de\s+referencia)\b/i,
  /\b(sans|pas\s+d['’])\s*(échelle|objet\s+de\s+référence|calibrage)\b/i,
  /\b(ohne|nicht)\s+(skalier(en|ung)|maßstab|referenzobjekt)\b/i,
  /\b(sem|não\s+quero)\s+(escala|escalar|objeto\s+de\s+referência)\b/i
];
function detectScaleDeclineIntent(transcript) {
  if (!transcript || typeof transcript !== "string") return false;
  const text = transcript.trim();
  if (text.length < 4) return false;
  return DECLINE_SCALE_PATTERNS.some((pattern) => pattern.test(text));
}
function resolveScaleCalibration(input) {
  const normalizedDetected = normalizeDetectedScaleObject(input.detectedObject);
  const clientAnchor = input.clientScaleAnchor && input.clientScaleAnchor !== "none" ? normalizeDetectedScaleObject(input.clientScaleAnchor) : "none";
  const resolvedObject = input.hasWebXRDepth ? "webxr_depth" : normalizedDetected !== "none" ? normalizedDetected : clientAnchor;
  const confidence = typeof input.scaleConfidence === "number" && Number.isFinite(input.scaleConfidence) ? Math.max(0, Math.min(1, Number(input.scaleConfidence.toFixed(2)))) : resolvedObject !== "none" ? 0.9 : 0;
  const isVisuallyCalibrated = Boolean(input.hasWebXRDepth) || clientAnchor !== "none" || Boolean(input.scaleCalibrated) && normalizedDetected !== "none" && confidence >= 0.55;
  const whyScaleMatters = input.localizedWhyScaleMatters?.trim() || WHY_SCALE_MATTERS_SUMMARY;
  const estimatedPartSizeMm = typeof input.estimatedPartSizeMm === "number" && Number.isFinite(input.estimatedPartSizeMm) && input.estimatedPartSizeMm > 0 ? Math.round(input.estimatedPartSizeMm * 10) / 10 : null;
  const scaleMeasurementNote = typeof input.scaleMeasurementNote === "string" && input.scaleMeasurementNote.trim() ? input.scaleMeasurementNote.trim() : null;
  if (isVisuallyCalibrated && resolvedObject !== "none") {
    const label = formatScaleObjectLabel(resolvedObject);
    const refMm = REFERENCE_OBJECT_DIMENSIONS_MM[resolvedObject];
    const sizePhrase = estimatedPartSizeMm ? ` (~${estimatedPartSizeMm} mm part measured)` : "";
    const bannerText = scaleMeasurementNote || `We calibrated scale using the ${label} next to the part${sizePhrase}. Exact tool sizes are unlocked for this repair.`;
    return {
      status: "calibrated",
      detectedObject: resolvedObject,
      detectedObjectLabel: label,
      referenceDimensionMm: refMm,
      estimatedPartSizeMm,
      scaleMeasurementNote,
      anchorBox: input.anchorBox ?? null,
      confidence,
      confirmed: true,
      optedOut: false,
      userDeclinedInSpeech: false,
      bannerTitle: `Scale Confirmed (${label})`,
      bannerText,
      whyScaleMatters,
      spokenScaleNotice: `Scale confirmed using the ${label}${sizePhrase}.`
    };
  }
  const declinedInSpeech = Boolean(input.userDeclinedInSpeech) || detectScaleDeclineIntent(input.userTranscript);
  const optedOut = Boolean(input.explicitOptOut) || declinedInSpeech;
  if (optedOut) {
    return {
      status: "opted_out",
      detectedObject: "none",
      detectedObjectLabel: "none",
      referenceDimensionMm: null,
      estimatedPartSizeMm: null,
      scaleMeasurementNote: null,
      anchorBox: null,
      confidence: 0,
      confirmed: false,
      optedOut: true,
      userDeclinedInSpeech: declinedInSpeech,
      bannerTitle: "Continuing Without Scale Object",
      bannerText: whyScaleMatters,
      whyScaleMatters,
      spokenScaleNotice: WHY_SCALE_MATTERS_SPOKEN
    };
  }
  return {
    status: "needs_anchor",
    detectedObject: "none",
    detectedObjectLabel: "none",
    referenceDimensionMm: null,
    estimatedPartSizeMm: null,
    scaleMeasurementNote: null,
    anchorBox: null,
    confidence: 0,
    confirmed: false,
    optedOut: false,
    userDeclinedInSpeech: false,
    bannerTitle: "Place a Scale Object Next to the Part",
    bannerText: SCALE_REQUEST_BANNER,
    whyScaleMatters,
    spokenScaleNotice: SCALE_REQUEST_SPOKEN
  };
}

// src/lib/ontologyMapper.ts
var VALID_MOTION_CUES = /* @__PURE__ */ new Set([
  "rotate_cw",
  "rotate_ccw",
  "slide",
  "lift",
  "press",
  "align",
  "inspect"
]);
function normalizeBoxToPct(rawBox, fallback) {
  if (!Array.isArray(rawBox) || rawBox.length !== 4) {
    return fallback ?? null;
  }
  const nums = rawBox.map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n))) {
    return fallback ?? null;
  }
  const [rawYmin, rawXmin, rawYmax, rawXmax] = nums;
  const maxVal = Math.max(rawYmin, rawXmin, rawYmax, rawXmax);
  const scale = maxVal > 100 ? 10 : 1;
  const y1 = Math.max(4, Math.min(92, rawYmin / scale));
  const x1 = Math.max(4, Math.min(92, rawXmin / scale));
  const y2 = Math.max(y1 + 8, Math.min(96, rawYmax / scale));
  const x2 = Math.max(x1 + 8, Math.min(96, rawXmax / scale));
  const wPct = Math.max(12, Math.min(88, Math.round((x2 - x1) * 10) / 10));
  const hPct = Math.max(12, Math.min(84, Math.round((y2 - y1) * 10) / 10));
  const xPct = Math.max(4, Math.min(96 - wPct, Math.round(x1 * 10) / 10));
  const yPct = Math.max(8, Math.min(92 - hPct, Math.round(y1 * 10) / 10));
  return { xPct, yPct, wPct, hPct };
}
function normalizeMotionCue(raw) {
  if (typeof raw !== "string") return "inspect";
  const cleaned = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (VALID_MOTION_CUES.has(cleaned)) {
    return cleaned;
  }
  if (cleaned.includes("counter") || cleaned.includes("ccw") || cleaned.includes("left") || cleaned.includes("loosen")) {
    return "rotate_ccw";
  }
  if (cleaned.includes("clock") || cleaned.includes("cw") || cleaned.includes("tighten") || cleaned.includes("twist") || cleaned.includes("turn")) {
    return "rotate_cw";
  }
  if (cleaned.includes("slide") || cleaned.includes("pull") || cleaned.includes("linear")) {
    return "slide";
  }
  if (cleaned.includes("lift") || cleaned.includes("pry") || cleaned.includes("raise") || cleaned.includes("open")) {
    return "lift";
  }
  if (cleaned.includes("press") || cleaned.includes("push") || cleaned.includes("snap") || cleaned.includes("click")) {
    return "press";
  }
  if (cleaned.includes("align") || cleaned.includes("angle") || cleaned.includes("tilt") || cleaned.includes("seat")) {
    return "align";
  }
  return "inspect";
}
function mapPgHierarchyRow(row) {
  const id = Number(row.id ?? 0);
  const parentId = row.parent_id !== null && row.parent_id !== void 0 ? Number(row.parent_id) : row.parentId !== null && row.parentId !== void 0 ? Number(row.parentId) : null;
  return {
    id,
    parentId,
    name: String(row.name ?? "Unnamed Component"),
    componentClass: String(row.component_class ?? row.componentClass ?? "part"),
    depth: Number(row.depth ?? 0),
    breadcrumbPath: String(row.breadcrumb_path ?? row.breadcrumbPath ?? row.name ?? ""),
    failurePrecursorCue: String(row.failure_precursor_cue ?? row.failurePrecursorCue ?? ""),
    toolRequired: String(row.tool_required ?? row.toolRequired ?? "Standard hand tool"),
    toolSizeSpec: String(row.tool_size_spec ?? row.toolSizeSpec ?? "Standard size"),
    requiresScaleAnchor: Boolean(row.requires_scale_anchor ?? row.requiresScaleAnchor ?? false),
    successRate: Number(row.success_rate ?? row.successRate ?? 0.85),
    correctionCount: Number(row.correction_count ?? row.correctionCount ?? 0)
  };
}
function mapPgComponentNodeRow(row) {
  const measurementRaw = String(row.measurement_system ?? row.measurementSystem ?? "universal");
  const measurementSystem = measurementRaw === "metric" || measurementRaw === "imperial" ? measurementRaw : "universal";
  const rawClass = String(row.component_class ?? row.componentClass ?? "subassembly").toLowerCase();
  const componentClass = rawClass === "assembly" || rawClass === "fastener" || rawClass === "seal" || rawClass === "subassembly" ? rawClass : "subassembly";
  const rawRot = String(row.rotation_direction ?? row.rotationDirection ?? "linear").toLowerCase();
  const rotationDirection = rawRot === "clockwise" || rawRot === "counter_clockwise" || rawRot === "angled" || rawRot === "linear" ? rawRot : "linear";
  return {
    id: Number(row.id ?? 0),
    parentId: row.parent_id !== null && row.parent_id !== void 0 ? Number(row.parent_id) : null,
    manualSku: String(row.manual_sku ?? row.manualSku ?? "FIELD-LEARNED"),
    brandName: String(row.brand_name ?? row.brandName ?? "Community Ontology"),
    name: String(row.name ?? "Unnamed Component"),
    partCode: String(row.part_code ?? row.partCode ?? `PART-${row.id ?? 0}`),
    componentClass,
    measurementSystem,
    threadPitchMm: row.thread_pitch_mm !== null && row.thread_pitch_mm !== void 0 ? Number(row.thread_pitch_mm) : null,
    nominalDiameterMm: row.nominal_diameter_mm !== null && row.nominal_diameter_mm !== void 0 ? Number(row.nominal_diameter_mm) : null,
    visualCueNotes: String(row.visual_cue_notes ?? row.visualCueNotes ?? ""),
    failurePrecursorCue: String(row.failure_precursor_cue ?? row.failurePrecursorCue ?? ""),
    actionType: String(row.action_type ?? row.actionType ?? "inspect"),
    toolRequired: String(row.tool_required ?? row.toolRequired ?? "Standard hand tool"),
    toolSizeSpec: String(row.tool_size_spec ?? row.toolSizeSpec ?? "Standard size"),
    requiresScaleAnchor: Boolean(row.requires_scale_anchor ?? row.requiresScaleAnchor ?? false),
    rotationDirection,
    instructionText: String(row.instruction_text ?? row.instructionText ?? ""),
    pipMotionPrompt: String(row.pip_motion_prompt ?? row.pipMotionPrompt ?? ""),
    successRate: Number(row.success_rate ?? row.successRate ?? 0.85),
    correctionCount: Number(row.correction_count ?? row.correctionCount ?? 0),
    embedding: []
  };
}
function mapPgFeedbackRow(row) {
  const createdRaw = row.created_at ?? row.createdAt;
  const timestamp = createdRaw instanceof Date ? createdRaw.toISOString() : typeof createdRaw === "string" && createdRaw ? createdRaw : (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: String(row.id ?? ""),
    timestamp,
    predictedComponentId: row.predicted_component_id !== null && row.predicted_component_id !== void 0 ? Number(row.predicted_component_id) : 0,
    predictedName: String(row.predicted_name ?? row.predictedName ?? "Auto-Detected Part"),
    correctedComponentId: Number(row.corrected_component_id ?? row.correctedComponentId ?? 0),
    correctedName: String(row.corrected_name ?? row.correctedName ?? "Verified Component"),
    tag: String(row.user_correction_tag ?? row.tag ?? "user_correction"),
    regionCode: String(row.region_code ?? row.regionCode ?? "GLOBAL")
  };
}
function computeLiveFlywheelMetrics(agg) {
  const deflectedReturns = Math.max(0, Number(agg.deflectedReturns) || 0);
  const grossBountyRevenueUsd = Math.round((Number(agg.grossBountyRevenueUsd) || 0) * 100) / 100;
  const totalComputeUsd = Math.round((Number(agg.totalComputeUsd) || 0) * 1e4) / 1e4;
  const bountyPerDeflectionUsd = deflectedReturns > 0 ? Math.round(grossBountyRevenueUsd / deflectedReturns * 100) / 100 : 30;
  const marginMultiple = totalComputeUsd > 0 ? Math.round(grossBountyRevenueUsd / totalComputeUsd * 10) / 10 : deflectedReturns > 0 ? 20 : 0;
  return {
    deflectedReturns,
    bountyPerDeflectionUsd,
    grossBountyRevenueUsd,
    totalComputeUsd: Number(totalComputeUsd.toFixed(2)),
    marginMultiple,
    totalCorrections: Math.max(0, Number(agg.totalCorrections) || 0),
    totalSessions: agg.totalSessions !== void 0 ? Math.max(0, Number(agg.totalSessions) || 0) : void 0
  };
}

// src/lib/authScaffold.ts
var ROLE_WEIGHT = {
  anonymous: 0,
  end_user: 10,
  technician: 20,
  admin: 30,
  super_admin: 40
};
function hasRequiredRole(actualRole, minimumRole) {
  return ROLE_WEIGHT[actualRole] >= ROLE_WEIGHT[minimumRole];
}
function normalizeUserRole(raw) {
  const cleaned = (raw || "").trim().toLowerCase();
  if (cleaned === "end_user" || cleaned === "technician" || cleaned === "admin" || cleaned === "super_admin") {
    return cleaned;
  }
  return "anonymous";
}
function resolveAuthEnforcementMode(raw) {
  return (raw || "").trim().toLowerCase() === "enforced" ? "enforced" : "scaffold";
}
var ROUTE_ACCESS_POLICIES = [
  {
    method: "GET",
    path: "/api/health",
    audience: "public",
    minimumRole: "anonymous",
    description: "Cloud Run liveness & readiness probe"
  },
  {
    method: "GET",
    path: "/api/auth/session",
    audience: "public",
    minimumRole: "anonymous",
    description: "Inspect current verified session principal and enforcement mode"
  },
  {
    method: "POST",
    path: "/api/auth/login",
    audience: "public",
    minimumRole: "anonymous",
    description: "Authenticate an end user or admin operator and issue a Bearer token"
  },
  {
    method: "POST",
    path: "/api/auth/logout",
    audience: "public",
    minimumRole: "anonymous",
    description: "Revoke the active Bearer session token"
  },
  {
    method: "POST",
    path: "/api/analyze-buffer",
    audience: "end_user",
    minimumRole: "end_user",
    description: "Scan Problem visual diagnosis, scale calibration & AR steps"
  },
  {
    method: "POST",
    path: "/api/voice-assist",
    audience: "end_user",
    minimumRole: "end_user",
    description: "Hold to Explain multilingual voice diagnosis & WAV synthesis"
  },
  {
    method: "POST",
    path: "/api/generate-pip",
    audience: "end_user",
    minimumRole: "end_user",
    description: "On-demand per-step PiP hand-motion video clip generation"
  },
  {
    method: "POST",
    path: "/api/ontology/confirm-fix",
    audience: "end_user",
    minimumRole: "end_user",
    description: "Confirm repair success and credit the self-learning ontology flywheel"
  },
  {
    method: "POST",
    path: "/api/ontology/feedback",
    audience: "end_user",
    minimumRole: "end_user",
    description: "Submit part/size corrections to refine Cloud SQL pgvector embeddings"
  },
  {
    method: "GET",
    path: "/api/db/status",
    audience: "admin",
    minimumRole: "admin",
    description: "Cloud SQL PostgreSQL connectivity and pgvector extension diagnostics"
  },
  {
    method: "GET",
    path: "/api/ontology/tree",
    audience: "admin",
    minimumRole: "admin",
    description: "Admin Ontology hierarchy inspection and B2B2C flywheel metrics"
  },
  {
    method: "POST",
    path: "/api/ontology/search",
    audience: "admin",
    minimumRole: "admin",
    description: "Admin Scale Anchor Guard & pgvector RAG search console"
  },
  {
    method: "POST",
    path: "/api/ontology/deflection",
    audience: "admin",
    minimumRole: "admin",
    description: "Manual B2B2C return-deflection ledger entry (Admin only)"
  },
  {
    method: "GET",
    path: "/api/deliverables",
    audience: "admin",
    minimumRole: "admin",
    description: "Admin source & runbook inspector (AGPL-3.0 Corresponding Source)"
  },
  {
    method: "GET",
    path: "/api/billing/catalog",
    audience: "public",
    minimumRole: "anonymous",
    description: "Server-authoritative pay-as-you-go credit packs and action credit weights"
  },
  {
    method: "GET",
    path: "/api/billing/wallet",
    audience: "end_user",
    minimumRole: "end_user",
    description: "Inspect caller credit balance and recent credit ledger entries"
  },
  {
    method: "POST",
    path: "/api/billing/checkout-session",
    audience: "end_user",
    minimumRole: "end_user",
    description: "Create a server-priced Stripe Hosted Checkout session for a credit pack or plan"
  },
  {
    method: "POST",
    path: "/api/billing/webhook",
    audience: "public",
    minimumRole: "anonymous",
    description: "Stripe-Signature HMAC-verified webhook for idempotent credit fulfillment"
  },
  {
    method: "GET",
    path: "/api/billing/overview",
    audience: "admin",
    minimumRole: "admin",
    description: "Admin Stripe integration status, unit-economics table & B2B2C proof readiness"
  }
];

// src/lib/serverAuth.ts
import crypto from "node:crypto";
var DEFAULT_TOKEN_TTL_SEC = 60 * 60 * 8;
var PROCESS_FALLBACK_SECRET = crypto.randomBytes(32).toString("hex");
function resolveSessionSigningSecret(env = process.env) {
  const configured = env.AUTH_SESSION_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return configured;
  }
  return PROCESS_FALLBACK_SECRET;
}
function verifyPasswordScrypt(password, storedHash) {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, "hex");
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
function signSessionToken(input, secret = resolveSessionSigningSecret()) {
  const nowSec = Math.floor(Date.now() / 1e3);
  const ttl = Math.max(60, input.ttlSeconds ?? DEFAULT_TOKEN_TTL_SEC);
  const principal = {
    userId: input.userId,
    email: input.email,
    displayName: input.displayName,
    role: normalizeUserRole(input.role),
    provider: input.provider,
    issuedAt: nowSec,
    expiresAt: nowSec + ttl
  };
  const payloadEncoded = Buffer.from(JSON.stringify(principal), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payloadEncoded).digest("base64url");
  return {
    token: `${payloadEncoded}.${signature}`,
    principal
  };
}
function verifySessionToken(token, secret = resolveSessionSigningSecret(), nowSec = Math.floor(Date.now() / 1e3)) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadEncoded, providedSig] = parts;
  if (!payloadEncoded || !providedSig) return null;
  const expectedSig = crypto.createHmac("sha256", secret).update(payloadEncoded).digest("base64url");
  const providedBuf = Buffer.from(providedSig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payloadEncoded, "base64url").toString("utf8"));
    if (typeof parsed.userId !== "string" || typeof parsed.email !== "string" || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= nowSec) {
      return null;
    }
    return {
      userId: parsed.userId,
      email: parsed.email,
      displayName: typeof parsed.displayName === "string" ? parsed.displayName : parsed.email,
      role: normalizeUserRole(parsed.role),
      provider: parsed.provider === "oidc_google" || parsed.provider === "firebase_auth" ? parsed.provider : "email_password_scrypt",
      issuedAt: typeof parsed.issuedAt === "number" ? parsed.issuedAt : nowSec,
      expiresAt: parsed.expiresAt
    };
  } catch {
    return null;
  }
}
function extractBearerToken(authHeader) {
  if (!authHeader || typeof authHeader !== "string") return null;
  const match = authHeader.match(/^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i);
  return match ? match[1] : null;
}
var revokedTokenHashes = /* @__PURE__ */ new Set();
function revokeSessionToken(token) {
  if (!token) return;
  const digest = crypto.createHash("sha256").update(token).digest("hex");
  revokedTokenHashes.add(digest);
}
function isTokenRevoked(token) {
  if (!token) return false;
  const digest = crypto.createHash("sha256").update(token).digest("hex");
  return revokedTokenHashes.has(digest);
}
function createRequireAuthMiddleware(minimumRole, options) {
  return (req, res, next) => {
    const mode = options?.enforcementMode ?? resolveAuthEnforcementMode(process.env.AUTH_ENFORCEMENT_MODE);
    const secret = options?.secret ?? resolveSessionSigningSecret();
    const bearer = extractBearerToken(req.headers.authorization);
    const principal = bearer && !isTokenRevoked(bearer) ? verifySessionToken(bearer, secret) : null;
    req.authPrincipal = principal;
    if (mode === "scaffold" || minimumRole === "anonymous") {
      return next();
    }
    if (!principal) {
      return res.status(401).json({
        error: "Authentication required. Provide a valid Authorization: Bearer token.",
        code: "AUTH_REQUIRED",
        requiredRole: minimumRole
      });
    }
    if (!hasRequiredRole(principal.role, minimumRole)) {
      return res.status(403).json({
        error: `Insufficient permissions. This endpoint requires "${minimumRole}" access.`,
        code: "FORBIDDEN_ROLE",
        requiredRole: minimumRole,
        actualRole: principal.role
      });
    }
    return next();
  };
}

// src/lib/billingScaffold.ts
var DEFAULT_STARTER_CREDITS = 2;
var BILLING_CREDIT_PACKS = [
  {
    id: "starter_10",
    name: "Starter Repair Pack",
    billingType: "one_time_credits",
    priceCents: 499,
    currency: "usd",
    creditsGranted: 10,
    estimatedCogsCents: 65,
    description: "Pay-as-you-go pack for 1\u20132 weekend repairs (up to 10 scans/voice checks or 5 PiP motion clips). Credits never expire.",
    stripePriceEnvVar: "STRIPE_PRICE_STARTER_10"
  },
  {
    id: "homeowner_30",
    name: "Homeowner Toolkit Pack",
    billingType: "one_time_credits",
    priceCents: 1299,
    currency: "usd",
    creditsGranted: 30,
    estimatedCogsCents: 195,
    badge: "Best Value",
    description: "Ideal for multi-room projects, appliances, and furniture assembly. No recurring subscription.",
    stripePriceEnvVar: "STRIPE_PRICE_HOMEOWNER_30"
  },
  {
    id: "pro_pack_100",
    name: "Handyman 100-Credit Pack",
    billingType: "one_time_credits",
    priceCents: 2999,
    currency: "usd",
    creditsGranted: 100,
    estimatedCogsCents: 650,
    description: "High-volume prepaid pack for frequent DIYers, landlords, and field technicians.",
    stripePriceEnvVar: "STRIPE_PRICE_PRO_100"
  },
  {
    id: "pro_unlimited_monthly",
    name: "Pro Technician Monthly",
    billingType: "subscription_monthly",
    priceCents: 1999,
    currency: "usd",
    creditsGranted: 120,
    estimatedCogsCents: 780,
    description: "Optional monthly allowance (120 fair-use credits/mo) tailored for daily service pros.",
    stripePriceEnvVar: "STRIPE_PRICE_PRO_MONTHLY"
  }
];
var ACTION_CREDIT_RULES = [
  {
    action: "demo_narration",
    label: "Interactive Onboarding Demo",
    creditsRequired: 0,
    estimatedCogsUsd: 0,
    rationale: "Cached WAV narration + local canvas \u2014 zero inference burn."
  },
  {
    action: "scan_problem",
    label: "Scan Problem (Vision + AR + TTS)",
    creditsRequired: 1,
    estimatedCogsUsd: 0.06,
    rationale: "Zero-token gemini-decision-1 gate -> gemini-4-neon + RAG + 3.8 TTS."
  },
  {
    action: "voice_assist",
    label: "Hold to Explain (Voice + Vision + TTS)",
    creditsRequired: 1,
    estimatedCogsUsd: 0.07,
    rationale: "Multimodal audio + frame reasoning in user language + RIFF WAV reply."
  },
  {
    action: "generate_pip",
    label: "Show Step Motion (6s PiP Video Clip)",
    creditsRequired: 2,
    estimatedCogsUsd: 0.18,
    rationale: "On-demand gemini-omni-1.2-flash 720p video clip, cached per step."
  }
];
function resolveBillingEnforcementMode(raw) {
  return (raw || "").trim().toLowerCase() === "enforced" ? "enforced" : "scaffold";
}
function getBillingPackById(packId) {
  if (!packId || typeof packId !== "string") return void 0;
  const cleaned = packId.trim();
  return BILLING_CREDIT_PACKS.find((pack) => pack.id === cleaned);
}

// src/lib/serverStripe.ts
import crypto2 from "node:crypto";
var PLACEHOLDER_TOKENS = [
  "CHANGE_ME",
  "YOUR_STRIPE",
  "MY_STRIPE",
  "sk_test_placeholder",
  "whsec_placeholder"
];
function isRealConfiguredSecret(value) {
  const trimmed = (value || "").trim();
  if (trimmed.length < 16) return false;
  return !PLACEHOLDER_TOKENS.some(
    (token) => trimmed.toUpperCase().includes(token.toUpperCase())
  );
}
function getStripeConfigStatus(env = process.env) {
  const secretKey = (env.STRIPE_SECRET_KEY || "").trim();
  const configured = isRealConfiguredSecret(secretKey) && secretKey.startsWith("sk_");
  const webhookSecretConfigured = isRealConfiguredSecret(env.STRIPE_WEBHOOK_SECRET);
  const publishableKey = (env.STRIPE_PUBLISHABLE_KEY || "").trim();
  const publishableKeyConfigured = isRealConfiguredSecret(publishableKey) && publishableKey.startsWith("pk_");
  let keyMode = "unconfigured";
  if (configured) {
    keyMode = secretKey.startsWith("sk_live_") ? "live" : "test";
  }
  return {
    configured,
    webhookSecretConfigured,
    publishableKeyConfigured,
    keyMode,
    enforcementMode: resolveBillingEnforcementMode(env.BILLING_ENFORCEMENT_MODE)
  };
}
function resolveSafeCheckoutOrigin(options) {
  const candidates = [options.appUrl];
  for (const raw of candidates) {
    if (!raw || typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.includes("MY_APP_URL")) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return parsed.origin;
      }
    } catch {
    }
  }
  const host = (options.requestHost || "").trim();
  if (host && /^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(host)) {
    const safeProto = options.protocol === "https" ? "https" : "http";
    return `${safeProto}://${host}`;
  }
  return "http://localhost:3000";
}
function verifyStripeWebhookSignature(rawBody, signatureHeader, webhookSecret, options) {
  if (!webhookSecret || !isRealConfiguredSecret(webhookSecret)) {
    return { valid: false, reason: "webhook_secret_not_configured" };
  }
  if (!signatureHeader || typeof signatureHeader !== "string") {
    return { valid: false, reason: "missing_signature_header" };
  }
  const parts = signatureHeader.split(",").map((part) => part.trim());
  let timestampSec = null;
  const v1Signatures = [];
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key === "t") {
      const parsed = Number(val);
      if (Number.isInteger(parsed) && parsed > 0) {
        timestampSec = parsed;
      }
    } else if (key === "v1" && /^[a-fA-F0-9]{64}$/.test(val)) {
      v1Signatures.push(val.toLowerCase());
    }
  }
  if (timestampSec === null || v1Signatures.length === 0) {
    return { valid: false, reason: "malformed_signature_header" };
  }
  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1e3);
  const toleranceSec = options?.toleranceSec ?? 300;
  if (Math.abs(nowSec - timestampSec) > toleranceSec) {
    return { valid: false, reason: "timestamp_outside_tolerance", timestampSec };
  }
  const payloadStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const expectedHex = crypto2.createHmac("sha256", webhookSecret).update(`${timestampSec}.${payloadStr}`, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expectedHex, "hex");
  const matched = v1Signatures.some((sigHex) => {
    const sigBuf = Buffer.from(sigHex, "hex");
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto2.timingSafeEqual(sigBuf, expectedBuf);
  });
  if (!matched) {
    return { valid: false, reason: "signature_mismatch", timestampSec };
  }
  return { valid: true, timestampSec };
}
async function createStripeCheckoutSessionViaApi(input) {
  const pack = getBillingPackById(input.packId);
  if (!pack) {
    return {
      ok: false,
      code: "INVALID_PACK",
      error: "Unknown billing pack requested."
    };
  }
  const env = input.env ?? process.env;
  const status = getStripeConfigStatus(env);
  if (!status.configured) {
    return {
      ok: false,
      code: "STRIPE_SCAFFOLD_PENDING",
      pack,
      error: "Stripe checkout is scaffolded and ready. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in server environment secrets to launch live payments."
    };
  }
  const secretKey = (env.STRIPE_SECRET_KEY || "").trim();
  const configuredPriceId = (env[pack.stripePriceEnvVar] || "").trim();
  const params = new URLSearchParams();
  params.set(
    "mode",
    pack.billingType === "subscription_monthly" ? "subscription" : "payment"
  );
  params.set(
    "success_url",
    `${input.origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`
  );
  params.set("cancel_url", `${input.origin}/?billing=canceled`);
  params.set("client_reference_id", input.userId);
  params.set("metadata[user_id]", input.userId);
  params.set("metadata[pack_id]", pack.id);
  params.set("metadata[credits_granted]", String(pack.creditsGranted));
  params.set("metadata[billing_type]", pack.billingType);
  if (input.userEmail) {
    params.set("customer_email", input.userEmail);
  }
  if (configuredPriceId.startsWith("price_")) {
    params.set("line_items[0][price]", configuredPriceId);
    params.set("line_items[0][quantity]", "1");
  } else {
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", pack.currency);
    params.set("line_items[0][price_data][unit_amount]", String(pack.priceCents));
    params.set("line_items[0][price_data][product_data][name]", pack.name);
    params.set("line_items[0][price_data][product_data][description]", pack.description);
    if (pack.billingType === "subscription_monthly") {
      params.set("line_items[0][price_data][recurring][interval]", "month");
    }
  }
  try {
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id || !data.url) {
      return {
        ok: false,
        code: "STRIPE_API_ERROR",
        pack,
        error: data.error?.message || `Stripe Checkout API returned HTTP ${response.status}.`
      };
    }
    return {
      ok: true,
      code: "CHECKOUT_CREATED",
      sessionId: data.id,
      checkoutUrl: data.url,
      pack
    };
  } catch (err) {
    return {
      ok: false,
      code: "STRIPE_API_ERROR",
      pack,
      error: err.message || "Could not reach Stripe API."
    };
  }
}

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var PORT = Number(process.env.PORT || 3e3);
var kService = process.env.K_SERVICE || "";
var isProduction = process.env.NODE_ENV === "production" || Boolean(kService) && !kService.startsWith("ais-dev-");
var cloudSqlConfig = resolveCloudSqlPoolConfig({
  ...process.env,
  SQL_SSL: "true"
});
var pgPool = null;
if (cloudSqlConfig.poolConfig) {
  pgPool = new Pool(cloudSqlConfig.poolConfig);
  pgPool.on("error", (err) => {
    console.error("[PostgreSQL Pool Error]", err.message);
  });
}
var localOntology = new InMemoryOntologyGraph();
var signalingRooms = /* @__PURE__ */ new Map();
function getGeminiClients() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  const decisionsAi = new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
  const interactionsAi = new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
  return { decisionsAi, interactionsAi };
}
function stripDataUrlPrefix(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], base64: match[2] };
  }
  return { mimeType: "image/jpeg", base64: dataUrl };
}
function extractErrorDetails(err) {
  const anyErr = err;
  const status = typeof anyErr?.status === "number" && anyErr.status >= 400 && anyErr.status < 600 ? anyErr.status : typeof anyErr?.code === "number" && anyErr.code >= 400 && anyErr.code < 600 ? anyErr.code : 502;
  const rawMessage = anyErr?.message || "Gemini API request failed.";
  return { status, message: rawMessage };
}
async function createApp() {
  const app = express();
  app.use(
    express.json({
      limit: "25mb",
      verify: (req, _res, buf) => {
        if (req.originalUrl?.startsWith("/api/billing/webhook")) {
          req.rawBody = Buffer.from(buf);
        }
      }
    })
  );
  const requireEndUser = createRequireAuthMiddleware("end_user");
  const requireAdmin = createRequireAuthMiddleware("admin");
  app.get(["/api/health", "/healthz"], (_req, res) => {
    const stripeStatus = getStripeConfigStatus();
    res.json({
      status: "ok",
      service: "jackofalltrades",
      license: "AGPL-3.0-only",
      authEnforcementMode: resolveAuthEnforcementMode(process.env.AUTH_ENFORCEMENT_MODE),
      billingEnforcementMode: stripeStatus.enforcementMode,
      stripeConfigured: stripeStatus.configured,
      postgresConfigured: Boolean(pgPool),
      databaseTransport: cloudSqlConfig.transport,
      sqlConnectionName: cloudSqlConfig.connectionName,
      sqlPublicIp: cloudSqlConfig.publicIp,
      sqlOutgoingIp: cloudSqlConfig.outgoingIp,
      sqlPort: cloudSqlConfig.port,
      sqlSslEnabled: cloudSqlConfig.sslEnabled,
      sqlTarget: cloudSqlConfig.hostSummary,
      geminiConfigured: Boolean(getGeminiClients()),
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.get("/api/auth/config", (_req, res) => {
    res.json({
      enforcementMode: resolveAuthEnforcementMode(process.env.AUTH_ENFORCEMENT_MODE),
      supportedRoles: ["end_user", "technician", "admin", "super_admin"],
      supportedProviders: ["email_password_scrypt", "oidc_google", "firebase_auth"],
      routePolicies: ROUTE_ACCESS_POLICIES
    });
  });
  app.get("/api/auth/session", (req, res) => {
    const enforcementMode = resolveAuthEnforcementMode(process.env.AUTH_ENFORCEMENT_MODE);
    const bearer = extractBearerToken(req.headers.authorization);
    const principal = bearer && !isTokenRevoked(bearer) ? verifySessionToken(bearer) : null;
    res.json({
      authenticated: Boolean(principal),
      enforcementMode,
      principal,
      supportedProviders: ["email_password_scrypt", "oidc_google", "firebase_auth"]
    });
  });
  app.post("/api/auth/login", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const enforcementMode = resolveAuthEnforcementMode(process.env.AUTH_ENFORCEMENT_MODE);
    if (!email || !password || email.length > 254 || password.length > 256) {
      return res.status(400).json({
        error: "Please enter a valid email address and password.",
        code: "INVALID_CREDENTIALS_INPUT"
      });
    }
    if (!pgPool) {
      return res.status(501).json({
        error: "Authentication login is scaffolded and ready. Connect Cloud SQL and seed app_users (or enable an OIDC/Firebase provider) to activate sign-in.",
        code: "AUTH_SCAFFOLD_PENDING",
        enforcementMode
      });
    }
    try {
      const { rows } = await pgPool.query(
        `SELECT id, email, display_name, role, auth_provider, password_hash, is_active
           FROM app_users
          WHERE LOWER(email) = LOWER($1)
          LIMIT 1`,
        [email]
      );
      const user = rows[0];
      if (!user || !user.is_active || typeof user.password_hash !== "string" || !verifyPasswordScrypt(password, user.password_hash)) {
        return res.status(401).json({
          error: "Invalid email or password.",
          code: "INVALID_CREDENTIALS"
        });
      }
      const role = normalizeUserRole(user.role);
      const { token, principal } = signSessionToken({
        userId: String(user.id),
        email: String(user.email),
        displayName: String(user.display_name || user.email),
        role,
        provider: user.auth_provider === "oidc_google" || user.auth_provider === "firebase_auth" ? user.auth_provider : "email_password_scrypt"
      });
      await pgPool.query("UPDATE app_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1", [
        user.id
      ]).catch(() => void 0);
      return res.json({
        token,
        principal,
        enforcementMode
      });
    } catch (err) {
      const pgCode = err?.code;
      if (pgCode === "42P01") {
        return res.status(501).json({
          error: "Auth tables are not yet applied in Cloud SQL. Run schema.sql (Section 8) to enable account sign-in.",
          code: "AUTH_SCHEMA_PENDING",
          enforcementMode
        });
      }
      return res.status(503).json({
        error: "Authentication service is temporarily unavailable.",
        code: "AUTH_SERVICE_UNAVAILABLE"
      });
    }
  });
  app.post("/api/auth/logout", (req, res) => {
    const bearer = extractBearerToken(req.headers.authorization);
    if (bearer) {
      revokeSessionToken(bearer);
    }
    res.json({ status: "signed_out" });
  });
  app.get("/api/billing/catalog", (_req, res) => {
    const stripe = getStripeConfigStatus();
    res.json({
      enforcementMode: stripe.enforcementMode,
      stripeConfigured: stripe.configured,
      starterCreditsGranted: DEFAULT_STARTER_CREDITS,
      packs: BILLING_CREDIT_PACKS,
      actionCosts: ACTION_CREDIT_RULES
    });
  });
  app.get("/api/billing/config", (_req, res) => {
    const stripe = getStripeConfigStatus();
    res.json({
      ...stripe,
      webhookPath: "/api/billing/webhook",
      checkoutPath: "/api/billing/checkout-session",
      starterCreditsGranted: DEFAULT_STARTER_CREDITS
    });
  });
  app.get("/api/billing/overview", requireAdmin, (_req, res) => {
    const stripe = getStripeConfigStatus();
    res.json({
      stripe,
      starterCreditsGranted: DEFAULT_STARTER_CREDITS,
      packs: BILLING_CREDIT_PACKS,
      actionCosts: ACTION_CREDIT_RULES,
      webhookPath: "/api/billing/webhook",
      b2b2cAttributionChannels: [
        {
          channel: "brand_qr_box",
          label: "Signed QR on Box / Assembly Manual",
          proofStrength: "Direct 1:1 SKU Attribution",
          description: "Customer scans brand-signed QR code; unlocks brand-sponsored free repair pass and logs verified completion."
        },
        {
          channel: "support_portal_redirect",
          label: "Support / Return Portal Deflection Link",
          proofStrength: "Auditable Ticket & Return Aversion",
          description: 'Embedded above "Start a Return" or IVR support; tracks sessions resolved without a subsequent ticket or RMA.'
        },
        {
          channel: "barcode_sku_scan",
          label: "Rating-Plate / UPC Barcode Identification",
          proofStrength: "Aggregated Brand ROI Proof",
          description: "Links organic repairs to exact OEM model numbers to generate anonymized deflection reports for brand sales."
        },
        {
          channel: "organic_camera",
          label: "Before/After Visual Proof Certificate",
          proofStrength: "Tamper-Evident SHA-256 Receipt",
          description: "Optional post-fix confirmation snapshot verified by Gemini and hashed into brand_deflection_proofs."
        }
      ]
    });
  });
  app.get("/api/billing/wallet", requireEndUser, async (req, res) => {
    const enforcementMode = resolveBillingEnforcementMode(process.env.BILLING_ENFORCEMENT_MODE);
    const userId = req.authPrincipal?.userId;
    if (!userId || !pgPool) {
      return res.json({
        userId: userId ?? "guest_scaffold",
        creditBalance: DEFAULT_STARTER_CREDITS,
        starterCreditsGranted: DEFAULT_STARTER_CREDITS,
        subscriptionStatus: "none",
        enforcementMode,
        sponsoredBrandPassActive: false,
        ledger: []
      });
    }
    try {
      const walletRes = await pgPool.query(
        `SELECT user_id, credit_balance, starter_credits_granted, subscription_status
           FROM user_credit_wallets
          WHERE user_id = $1
          LIMIT 1`,
        [userId]
      );
      const ledgerRes = await pgPool.query(
        `SELECT id, delta_credits, reason, amount_cents, created_at
           FROM credit_ledger_entries
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 20`,
        [userId]
      );
      const row = walletRes.rows[0];
      return res.json({
        userId,
        creditBalance: row ? Number(row.credit_balance) : DEFAULT_STARTER_CREDITS,
        starterCreditsGranted: row ? Number(row.starter_credits_granted) : DEFAULT_STARTER_CREDITS,
        subscriptionStatus: row?.subscription_status ?? "none",
        enforcementMode,
        sponsoredBrandPassActive: false,
        ledger: ledgerRes.rows
      });
    } catch {
      return res.json({
        userId,
        creditBalance: DEFAULT_STARTER_CREDITS,
        starterCreditsGranted: DEFAULT_STARTER_CREDITS,
        subscriptionStatus: "none",
        enforcementMode,
        sponsoredBrandPassActive: false,
        ledger: []
      });
    }
  });
  app.post("/api/billing/checkout-session", requireEndUser, async (req, res) => {
    const packId = typeof req.body?.packId === "string" ? req.body.packId.trim() : "";
    const pack = getBillingPackById(packId);
    if (!pack) {
      return res.status(400).json({
        error: "Invalid or unknown credit pack selected.",
        code: "INVALID_PACK",
        availablePacks: BILLING_CREDIT_PACKS.map((p) => p.id)
      });
    }
    const origin = resolveSafeCheckoutOrigin({
      appUrl: process.env.APP_URL,
      requestHost: req.get("host"),
      protocol: req.protocol
    });
    const result = await createStripeCheckoutSessionViaApi({
      packId: pack.id,
      userId: req.authPrincipal?.userId ?? "scaffold_preview_user",
      userEmail: req.authPrincipal?.email ?? null,
      origin
    });
    if (result.code === "STRIPE_SCAFFOLD_PENDING") {
      return res.status(501).json({
        error: result.error,
        code: result.code,
        pack: result.pack
      });
    }
    if (!result.ok) {
      return res.status(502).json({
        error: result.error || "Could not create Stripe Checkout session.",
        code: result.code
      });
    }
    return res.json({
      sessionId: result.sessionId,
      checkoutUrl: result.checkoutUrl,
      pack: result.pack
    });
  });
  app.post("/api/billing/webhook", async (req, res) => {
    const rawBody = req.rawBody;
    const signatureHeader = req.get("stripe-signature");
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!rawBody || rawBody.length === 0) {
      return res.status(400).json({
        error: "Raw webhook request body is required for Stripe signature verification.",
        code: "MISSING_RAW_BODY"
      });
    }
    const verification = verifyStripeWebhookSignature(rawBody, signatureHeader, webhookSecret);
    if (!verification.valid) {
      return res.status(400).json({
        error: "Invalid Stripe webhook signature.",
        code: "INVALID_WEBHOOK_SIGNATURE",
        reason: verification.reason
      });
    }
    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Malformed Stripe webhook JSON payload." });
    }
    const eventId = typeof event.id === "string" ? event.id : "";
    const eventType = typeof event.type === "string" ? event.type : "";
    if (!eventId || !eventType) {
      return res.status(400).json({ error: "Stripe event id and type are required." });
    }
    if (eventType === "checkout.session.completed" && pgPool) {
      const sessionObj = event.data?.object;
      const meta = sessionObj?.metadata ?? {};
      const userId = typeof meta.user_id === "string" ? meta.user_id : "";
      const pack = getBillingPackById(meta.pack_id);
      if (userId && pack) {
        const client = await pgPool.connect();
        try {
          await client.query("BEGIN");
          const inserted = await client.query(
            `INSERT INTO stripe_webhook_events (stripe_event_id, event_type, payload_summary)
             VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (stripe_event_id) DO NOTHING
             RETURNING stripe_event_id`,
            [eventId, eventType, JSON.stringify({ packId: pack.id, credits: pack.creditsGranted })]
          );
          if (inserted.rows.length > 0) {
            await client.query(
              `INSERT INTO user_credit_wallets (user_id, stripe_customer_id, credit_balance, subscription_status, stripe_subscription_id)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (user_id) DO UPDATE
                 SET credit_balance = user_credit_wallets.credit_balance + EXCLUDED.credit_balance,
                     stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, user_credit_wallets.stripe_customer_id),
                     subscription_status = CASE
                       WHEN EXCLUDED.subscription_status = 'active' THEN 'active'
                       ELSE user_credit_wallets.subscription_status
                     END,
                     stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, user_credit_wallets.stripe_subscription_id),
                     updated_at = NOW()`,
              [
                userId,
                sessionObj?.customer ?? null,
                pack.creditsGranted,
                pack.billingType === "subscription_monthly" ? "active" : "none",
                sessionObj?.subscription ?? null
              ]
            );
            await client.query(
              `INSERT INTO credit_ledger_entries (
                 user_id, delta_credits, reason, amount_cents, stripe_checkout_session_id, stripe_event_id
               ) VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (stripe_event_id) DO NOTHING`,
              [
                userId,
                pack.creditsGranted,
                pack.billingType === "subscription_monthly" ? "stripe_subscription_cycle" : "stripe_pack_purchase",
                typeof sessionObj?.amount_total === "number" ? sessionObj.amount_total : pack.priceCents,
                sessionObj?.id ?? null,
                eventId
              ]
            );
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => void 0);
          console.error("[Stripe Webhook DB Error]", err.message);
          return res.status(500).json({ error: "Failed to persist Stripe credit fulfillment." });
        } finally {
          client.release();
        }
      }
    }
    return res.json({ received: true, eventId, eventType });
  });
  app.get("/api/db/status", requireAdmin, async (req, res) => {
    if (!pgPool) {
      return res.json({
        connected: false,
        configured: false,
        transport: cloudSqlConfig.transport,
        connectionName: cloudSqlConfig.connectionName,
        publicIp: cloudSqlConfig.publicIp,
        outgoingIp: cloudSqlConfig.outgoingIp,
        port: cloudSqlConfig.port,
        message: "Set DB_NAME/DB_USER/DB_PASS (or SQL_DB_NAME/SQL_USER/SQL_PASSWORD) in runtime secrets to enable live Cloud SQL queries. Falling back to InMemoryOntologyGraph."
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
        details: rows[0] ?? null
      });
    } catch (err) {
      const statusCode = req.query.strict === "1" ? 503 : 200;
      return res.status(statusCode).json({
        connected: false,
        configured: true,
        fallbackActive: true,
        transport: cloudSqlConfig.transport,
        connectionName: cloudSqlConfig.connectionName,
        target: cloudSqlConfig.hostSummary,
        sslEnabled: cloudSqlConfig.sslEnabled,
        error: err.message
      });
    }
  });
  app.get("/api/deliverables", requireAdmin, async (_req, res) => {
    const deliverablePaths = {
      "schema.sql": path.join(__dirname, "schema.sql"),
      "server.ts": path.join(__dirname, "server.ts"),
      "server.js": path.join(__dirname, "server.js"),
      "App.jsx": path.join(__dirname, "App.jsx"),
      Dockerfile: path.join(__dirname, "Dockerfile"),
      "docs/ARCHITECTURE.md": path.join(__dirname, "docs", "ARCHITECTURE.md"),
      "docs/RUNBOOK.md": path.join(__dirname, "docs", "RUNBOOK.md"),
      LICENSE: path.join(__dirname, "LICENSE")
    };
    try {
      const files = {};
      for (const [label, filePath] of Object.entries(deliverablePaths)) {
        try {
          files[label] = await fs2.readFile(filePath, "utf8");
        } catch {
          files[label] = `// File ${label} not found on disk.`;
        }
      }
      res.json({ license: "AGPL-3.0-only", files });
    } catch {
      res.status(500).json({ error: "Failed to load AGPL-3.0 source deliverables." });
    }
  });
  app.post("/api/webrtc/signal", (req, res) => {
    const { roomId, type, payload } = req.body ?? {};
    if (!roomId || typeof roomId !== "string") {
      return res.status(400).json({ error: "roomId is required for WebRTC signaling." });
    }
    const room = signalingRooms.get(roomId) ?? { candidates: [], updatedAt: Date.now() };
    room.updatedAt = Date.now();
    if (type === "offer") room.offer = payload;
    else if (type === "answer") room.answer = payload;
    else if (type === "ice-candidate" && payload) room.candidates.push(payload);
    else return res.status(400).json({ error: "Unsupported signaling payload type." });
    signalingRooms.set(roomId, room);
    return res.json({ roomId, status: "relayed", candidateCount: room.candidates.length });
  });
  app.get("/api/webrtc/signal/:roomId", (req, res) => {
    const room = signalingRooms.get(req.params.roomId);
    if (!room) {
      return res.status(404).json({ error: "Signaling room not found." });
    }
    return res.json({ roomId: req.params.roomId, ...room });
  });
  async function loadLiveOntologySnapshot(rootId) {
    if (!pgPool) return null;
    const treeQuery = rootId ? "SELECT * FROM get_component_hierarchy($1)" : "SELECT * FROM v_component_hierarchy ORDER BY depth ASC, id ASC";
    const [treeRes, nodesRes, feedbackRes, flywheelRes] = await Promise.all([
      pgPool.query(treeQuery, rootId ? [rootId] : []),
      pgPool.query(
        `SELECT DISTINCT ON (c.id)
                c.id, c.parent_id, c.name, c.part_code, c.component_class,
                c.measurement_system, c.thread_pitch_mm, c.nominal_diameter_mm,
                c.visual_cue_notes, c.failure_precursor_cue, c.correction_count,
                ra.tool_required, ra.tool_size_spec, ra.requires_scale_anchor,
                ra.instruction_text, ra.pip_motion_prompt, ra.success_rate
           FROM components c
           LEFT JOIN repair_actions ra ON ra.component_id = c.id
          ORDER BY c.id ASC, ra.success_rate DESC NULLS LAST`
      ),
      pgPool.query(
        `SELECT e.id, e.created_at, e.predicted_component_id,
                p.name AS predicted_name,
                e.corrected_component_id,
                c.name AS corrected_name,
                e.user_correction_tag, e.region_code
           FROM ontology_feedback_events e
           LEFT JOIN components p ON p.id = e.predicted_component_id
           LEFT JOIN components c ON c.id = e.corrected_component_id
          ORDER BY e.created_at DESC
          LIMIT 25`
      ),
      pgPool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM deflection_bounties) AS deflected_returns,
           (SELECT COALESCE(SUM(bounty_usd), 0)::float FROM deflection_bounties) AS gross_bounty_usd,
           (SELECT COALESCE(SUM(compute_cost_usd), 0)::float FROM deflection_bounties) AS bounty_compute_usd,
           (SELECT COALESCE(SUM(estimated_compute_usd), 0)::float FROM diagnostic_sessions) AS session_compute_usd,
           (SELECT COUNT(*)::int FROM diagnostic_sessions) AS total_sessions,
           (SELECT COUNT(*)::int FROM ontology_feedback_events) AS total_feedback_events,
           (SELECT COALESCE(SUM(correction_count), 0)::int FROM components) AS total_component_corrections`
      )
    ]);
    const agg = flywheelRes.rows[0] ?? {};
    const totalCompute = Math.max(
      Number(agg.bounty_compute_usd || 0),
      Number(agg.session_compute_usd || 0)
    );
    const totalCorrections = Math.max(
      Number(agg.total_feedback_events || 0),
      Number(agg.total_component_corrections || 0)
    );
    return {
      source: "postgresql_pgvector",
      tree: treeRes.rows.map((r) => mapPgHierarchyRow(r)),
      nodes: nodesRes.rows.map((r) => mapPgComponentNodeRow(r)),
      feedbackLog: feedbackRes.rows.map((r) => mapPgFeedbackRow(r)),
      flywheel: computeLiveFlywheelMetrics({
        deflectedReturns: Number(agg.deflected_returns || 0),
        grossBountyRevenueUsd: Number(agg.gross_bounty_usd || 0),
        totalComputeUsd: totalCompute,
        totalCorrections,
        totalSessions: Number(agg.total_sessions || 0)
      })
    };
  }
  async function recordLiveDiagnosisToCloudSql(params) {
    if (!pgPool) return { sessionId: null, componentId: null };
    const safeAnchor = params.scaleAnchor === "us_quarter" || params.scaleAnchor === "credit_card" || params.scaleAnchor === "human_thumb" || params.scaleAnchor === "webxr_depth" ? params.scaleAnchor : "none";
    const safeIngest = params.ingestMode === "burst_photo_3x" ? "burst_photo_3x" : "webrtc_video";
    let sessionId = null;
    let componentId = null;
    try {
      const sessionRes = await pgPool.query(
        `INSERT INTO diagnostic_sessions
           (ingest_mode, has_webxr_depth, scale_anchor_type, decision_calls_count, neon_calls_count, estimated_compute_usd, outcome)
         VALUES ($1, $2, $3, 1, 1, 0.0450, 'active')
         RETURNING id`,
        [safeIngest, Boolean(params.hasWebXRDepth), safeAnchor]
      );
      sessionId = sessionRes.rows[0]?.id ?? null;
      let vectorLiteral = null;
      if (params.clients && params.frameDataUrl && params.frameDataUrl.length > 32) {
        try {
          const { mimeType, base64 } = stripDataUrlPrefix(params.frameDataUrl);
          const embRes = await params.clients.interactionsAi.models.embedContent({
            model: "gemini-embedding-2",
            contents: [
              `Physical hardware component: ${params.componentName}. ${params.diagnosisSummary}`,
              { inlineData: { data: base64, mimeType } }
            ]
          });
          const vec = embRes.embeddings?.[0]?.values?.slice(0, 768);
          if (Array.isArray(vec) && vec.length === 768) {
            vectorLiteral = `[${vec.join(",")}]`;
          }
        } catch {
        }
      }
      const cleanName = params.componentName.trim().slice(0, 240);
      if (cleanName && cleanName.toLowerCase() !== "highlighted area" && cleanName.toLowerCase() !== "visual repair guidance") {
        const existing = await pgPool.query(
          `SELECT id, visual_signature_embedding IS NOT NULL AS has_emb
             FROM components
            WHERE LOWER(name) = LOWER($1)
            LIMIT 1`,
          [cleanName]
        );
        if (existing.rows.length > 0) {
          componentId = Number(existing.rows[0].id);
          if (vectorLiteral && !existing.rows[0].has_emb) {
            await pgPool.query(
              `UPDATE components
                  SET visual_signature_embedding = $1::vector,
                      updated_at = NOW()
                WHERE id = $2`,
              [vectorLiteral, componentId]
            );
          }
        } else {
          const inserted = await pgPool.query(
            `INSERT INTO components
               (name, part_code, component_class, measurement_system, nominal_diameter_mm, visual_cue_notes, failure_precursor_cue, visual_signature_embedding)
             VALUES ($1, $2, 'part', 'universal', $3, $4, $5, $6::vector)
             RETURNING id`,
            [
              cleanName,
              `USER-${Date.now().toString(36).toUpperCase().slice(-6)}`,
              params.estimatedPartSizeMm && params.estimatedPartSizeMm > 0 ? params.estimatedPartSizeMm : null,
              params.diagnosisSummary.slice(0, 400),
              "Learned from live end-user camera scan",
              vectorLiteral
            ]
          );
          componentId = Number(inserted.rows[0]?.id ?? 0) || null;
          if (componentId) {
            const rotDir = params.motionCue === "rotate_cw" ? "clockwise" : params.motionCue === "rotate_ccw" ? "counter_clockwise" : params.motionCue === "slide" || params.motionCue === "lift" || params.motionCue === "press" ? "linear" : params.motionCue === "align" ? "angled" : "none";
            await pgPool.query(
              `INSERT INTO repair_actions
                 (component_id, action_type, tool_required, tool_size_spec, requires_scale_anchor, rotation_direction, instruction_text, pip_motion_prompt, success_rate, execution_count)
               VALUES ($1, 'repair', $2, $3, $4, $5, $6, $7, 0.8500, 1)`,
              [
                componentId,
                params.toolRequired.slice(0, 96) || "Hand Inspection",
                params.toolSizeSpec ? params.toolSizeSpec.slice(0, 78) : null,
                Boolean(params.requiresScaleAnchor),
                rotDir,
                params.nextStepInstruction.slice(0, 600),
                params.pipMotionPrompt ? params.pipMotionPrompt.slice(0, 500) : null
              ]
            );
          }
        }
      }
    } catch (err) {
      console.warn("[Self-Learning Cloud SQL write skipped]", err.message);
    }
    return { sessionId, componentId };
  }
  app.get("/api/ontology/tree", requireAdmin, async (req, res) => {
    const rootId = req.query.rootId ? Number(req.query.rootId) : void 0;
    if (pgPool) {
      try {
        const snapshot = await loadLiveOntologySnapshot(rootId);
        if (snapshot) {
          return res.json(snapshot);
        }
      } catch (err) {
        console.error("[Ontology DB Fallback]", err.message);
      }
    }
    return res.json({
      source: "in_memory_cte_parity",
      tree: localOntology.getHierarchyTree(rootId),
      nodes: localOntology.getAllNodes(),
      feedbackLog: localOntology.getFeedbackLog(),
      flywheel: localOntology.getFlywheelMetrics()
    });
  });
  app.post("/api/ontology/search", requireAdmin, async (req, res) => {
    const {
      queryVector,
      scaleAnchor = "none",
      hasWebXRDepth = false,
      limit = 4
    } = req.body ?? {};
    const hasScaleAnchor = Boolean(hasWebXRDepth) || scaleAnchor !== "none";
    const maxRows = Number(limit) || 4;
    if (pgPool && Array.isArray(queryVector) && queryVector.length === 768) {
      try {
        const vectorLiteral = `[${queryVector.map(Number).join(",")}]`;
        const { rows } = await pgPool.query(
          "SELECT * FROM rag_search_ontology_subgraph($1::vector, $2, $3, $4)",
          [vectorLiteral, hasScaleAnchor, 0.55, maxRows]
        );
        return res.json({
          source: "postgresql_pgvector",
          hasScaleAnchor,
          matches: rows
        });
      } catch (err) {
        console.error("[PostgreSQL rag_search_ontology_subgraph fallback]", err.message);
      }
    }
    const vector = Array.isArray(queryVector) && queryVector.length > 0 ? buildFeatureVector(queryVector.map(Number)) : buildFeatureVector([0.14, 0.16, 0.87, 0.43, 0.1, 0.07, 0.06, 0.09]);
    const matches = localOntology.searchRagSubgraph(
      vector,
      scaleAnchor,
      Boolean(hasWebXRDepth),
      maxRows
    );
    return res.json({
      source: "in_memory_cte_parity",
      hasScaleAnchor,
      matches
    });
  });
  app.post("/api/ontology/feedback", requireEndUser, async (req, res) => {
    const {
      sessionId = null,
      predictedComponentId,
      correctedComponentId,
      correctedName,
      tag,
      capturedVector,
      frameDataUrl,
      regionCode = "US-CHI"
    } = req.body ?? {};
    if (!correctedComponentId && !correctedName || !tag) {
      return res.status(400).json({
        error: "correctedComponentId (or correctedName) and tag are required to update the ontology graph."
      });
    }
    let embeddingModelUsed = null;
    const clients = getGeminiClients();
    let fullEmbedding768 = null;
    if (clients) {
      try {
        const contents = [
          `Hardware component user correction: ${String(correctedName || tag)} (${String(tag)})`
        ];
        if (typeof frameDataUrl === "string" && frameDataUrl.length > 32) {
          const { mimeType, base64 } = stripDataUrlPrefix(frameDataUrl);
          contents.push({ inlineData: { data: base64, mimeType } });
        }
        const embResult = await clients.interactionsAi.models.embedContent({
          model: "gemini-embedding-2",
          contents
        });
        const values = embResult.embeddings?.[0]?.values;
        if (Array.isArray(values) && values.length > 0) {
          fullEmbedding768 = values.slice(0, 768);
          embeddingModelUsed = "gemini-embedding-2";
        }
      } catch (err) {
        console.warn("[gemini-embedding-2 warning]", err.message);
      }
    }
    const compactVector = Array.isArray(capturedVector) && capturedVector.length > 0 ? capturedVector.map(Number) : fullEmbedding768 ? fullEmbedding768.slice(0, 8) : [0.14, 0.16, 0.87, 0.43, 0.1, 0.07, 0.06, 0.09];
    let targetComponentId = correctedComponentId ? Number(correctedComponentId) : 0;
    let persistedToSql = false;
    if (pgPool) {
      try {
        if (!targetComponentId && typeof correctedName === "string" && correctedName.trim()) {
          const cleanNewName = correctedName.trim().slice(0, 240);
          const existing = await pgPool.query(
            "SELECT id FROM components WHERE LOWER(name) = LOWER($1) LIMIT 1",
            [cleanNewName]
          );
          if (existing.rows.length > 0) {
            targetComponentId = Number(existing.rows[0].id);
          } else {
            const ins = await pgPool.query(
              `INSERT INTO components (name, part_code, component_class, measurement_system, visual_cue_notes, failure_precursor_cue)
               VALUES ($1, $2, 'part', 'universal', $3, 'Created via live end-user correction')
               RETURNING id`,
              [
                cleanNewName,
                `CORR-${Date.now().toString(36).toUpperCase().slice(-6)}`,
                `User correction: ${String(tag).slice(0, 120)}`
              ]
            );
            targetComponentId = Number(ins.rows[0]?.id ?? 0);
            if (targetComponentId) {
              await pgPool.query(
                `INSERT INTO repair_actions (component_id, action_type, tool_required, requires_scale_anchor, instruction_text, success_rate)
                 VALUES ($1, 'inspect', 'Verify fit before turning', TRUE, $2, 0.9000)`,
                [targetComponentId, `User verified part as ${cleanNewName} (${String(tag).slice(0, 80)}).`]
              );
            }
          }
        }
        if (targetComponentId) {
          const vectorLiteral = fullEmbedding768 && fullEmbedding768.length === 768 ? `[${fullEmbedding768.join(",")}]` : null;
          if (vectorLiteral) {
            await pgPool.query(
              "SELECT * FROM apply_ontology_correction($1, $2, $3, $4, $5::vector, $6)",
              [
                sessionId || null,
                predictedComponentId ? Number(predictedComponentId) : null,
                targetComponentId,
                String(tag).slice(0, 80),
                vectorLiteral,
                String(regionCode).slice(0, 32)
              ]
            );
          } else {
            await pgPool.query(
              `UPDATE components SET correction_count = correction_count + 1, updated_at = NOW() WHERE id = $1`,
              [targetComponentId]
            );
            await pgPool.query(
              `INSERT INTO ontology_feedback_events (session_id, predicted_component_id, corrected_component_id, user_correction_tag, region_code)
               VALUES ($1, $2, $3, $4, $5)`,
              [
                sessionId || null,
                predictedComponentId ? Number(predictedComponentId) : null,
                targetComponentId,
                String(tag).slice(0, 80),
                String(regionCode).slice(0, 32)
              ]
            );
          }
          persistedToSql = true;
        }
      } catch (err) {
        console.error("[PostgreSQL apply_ontology_correction failed]", err.message);
      }
    }
    if (persistedToSql && pgPool) {
      try {
        const snapshot = await loadLiveOntologySnapshot();
        if (snapshot) {
          return res.json({
            ...snapshot,
            status: "updated",
            source: "postgresql_pgvector",
            embeddingModelUsed: embeddingModelUsed ?? "metadata_only",
            correctedComponentId: targetComponentId
          });
        }
      } catch {
      }
    }
    try {
      const localTargetId = targetComponentId || Number(predictedComponentId) || 3;
      const { updated, event } = localOntology.applyCorrection({
        predictedComponentId: Number(predictedComponentId || localTargetId),
        correctedComponentId: localTargetId,
        capturedEmbedding: compactVector,
        tag: String(tag).slice(0, 80),
        regionCode: String(regionCode).slice(0, 32)
      });
      return res.json({
        status: "updated",
        source: persistedToSql ? "postgresql_pgvector" : "in_memory_cte_parity",
        embeddingModelUsed: embeddingModelUsed ?? "compact_signature_fallback",
        updatedComponent: updated,
        feedbackEvent: event,
        tree: localOntology.getHierarchyTree(),
        feedbackLog: localOntology.getFeedbackLog(),
        flywheel: localOntology.getFlywheelMetrics()
      });
    } catch (err) {
      return res.json({
        status: "updated",
        source: persistedToSql ? "postgresql_pgvector" : "in_memory_cte_parity",
        embeddingModelUsed: embeddingModelUsed ?? "metadata_only",
        message: "Correction recorded."
      });
    }
  });
  app.post("/api/ontology/confirm-fix", requireEndUser, async (req, res) => {
    const { sessionId = null, componentId = null, computeCostUsd = 0.08 } = req.body ?? {};
    const safeCost = Number.isFinite(Number(computeCostUsd)) && Number(computeCostUsd) > 0 ? Number(computeCostUsd) : 0.08;
    let persistedToSql = false;
    if (pgPool) {
      try {
        let resolvedSessionId = typeof sessionId === "string" && sessionId.length > 10 ? sessionId : null;
        if (resolvedSessionId) {
          await pgPool.query(
            `UPDATE diagnostic_sessions
                SET outcome = 'resolved_deflected',
                    completed_at = NOW()
              WHERE id = $1`,
            [resolvedSessionId]
          );
        } else {
          const ins = await pgPool.query(
            `INSERT INTO diagnostic_sessions (outcome, estimated_compute_usd, completed_at)
             VALUES ('resolved_deflected', $1, NOW())
             RETURNING id`,
            [safeCost]
          );
          resolvedSessionId = ins.rows[0]?.id ?? null;
        }
        if (resolvedSessionId) {
          await pgPool.query(
            `INSERT INTO deflection_bounties (session_id, brand_id, bounty_usd, compute_cost_usd)
             VALUES ($1, 1, 30.00, $2)
             ON CONFLICT (session_id) DO NOTHING`,
            [resolvedSessionId, safeCost]
          );
        }
        if (componentId && Number.isFinite(Number(componentId))) {
          await pgPool.query(
            `UPDATE repair_actions
                SET execution_count = execution_count + 1,
                    success_rate = LEAST(0.9999, ROUND(((success_rate * GREATEST(execution_count, 1) + 1.0) / (GREATEST(execution_count, 1) + 1.0))::numeric, 4)),
                    updated_at = NOW()
              WHERE component_id = $1`,
            [Number(componentId)]
          );
        }
        persistedToSql = true;
      } catch (err) {
        console.error("[PostgreSQL confirm-fix warning]", err.message);
      }
    }
    const flywheel = localOntology.recordDeflection(safeCost);
    return res.json({
      status: "confirmed",
      source: persistedToSql ? "postgresql_pgvector" : "in_memory_cte_parity",
      flywheel
    });
  });
  app.post("/api/ontology/deflection", requireAdmin, async (req, res) => {
    const computeCostUsd = Number(req.body?.computeCostUsd ?? 1.45);
    const safeCost = Number.isFinite(computeCostUsd) && computeCostUsd > 0 ? computeCostUsd : 1.45;
    let persistedToSql = false;
    if (pgPool) {
      try {
        const sessionRes = await pgPool.query(
          `INSERT INTO diagnostic_sessions (outcome, estimated_compute_usd, completed_at)
           VALUES ('resolved_deflected', $1, NOW())
           RETURNING id`,
          [safeCost]
        );
        const sessionId = sessionRes.rows[0]?.id;
        if (sessionId) {
          await pgPool.query(
            `INSERT INTO deflection_bounties (session_id, brand_id, bounty_usd, compute_cost_usd)
             VALUES ($1, 1, 30.00, $2)`,
            [sessionId, safeCost]
          );
          persistedToSql = true;
        }
        const snapshot = await loadLiveOntologySnapshot();
        if (snapshot) {
          return res.json({
            status: "recorded",
            source: "postgresql_pgvector",
            flywheel: snapshot.flywheel
          });
        }
      } catch (err) {
        console.error("[PostgreSQL deflection_bounties fallback]", err.message);
      }
    }
    const flywheel = localOntology.recordDeflection(safeCost);
    return res.json({
      status: "recorded",
      source: persistedToSql ? "postgresql_pgvector" : "in_memory_cte_parity",
      flywheel
    });
  });
  app.post("/api/analyze-buffer", requireEndUser, async (req, res) => {
    const {
      frames = [],
      ingestMode = "webrtc_15fps",
      scaleAnchor = "none",
      hasWebXRDepth = false,
      scaleOptOut = false,
      preferredLanguage = "en-US",
      stillDurationMs = 0,
      scenarioHint = "",
      userQuestion = "",
      queryVector
    } = req.body ?? {};
    if (!Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({
        error: "A 15-second frame buffer or 3-shot burst payload with at least 1 frame is required."
      });
    }
    const clients = getGeminiClients();
    if (!clients) {
      return res.status(503).json({
        error: "GEMINI_API_KEY is not configured on the server. Configure a valid Gemini 4 API key in Secrets to invoke gemini-decision-1 and gemini-4-neon.",
        code: "API_KEY_MISSING"
      });
    }
    const incomingFrames = frames;
    const step = Math.max(1, Math.floor(incomingFrames.length / 6));
    const sampledFrames = incomingFrames.filter((_f, idx) => idx % step === 0).slice(0, 6);
    const multimodalInput = [
      {
        type: "text",
        text: `JackOfAllTrades 15-second visual buffer (${sampledFrames.length} chronological frames, ingestMode=${ingestMode}, handStillMs=${Math.round(Number(stillDurationMs))}, scaleAnchor=${scaleAnchor}, webXRDepth=${Boolean(hasWebXRDepth)}). ` + (scenarioHint ? `Workshop context: ${String(scenarioHint)}. ` : "") + (userQuestion ? `User voice query: "${String(userQuestion)}".
` : "\n")
      }
    ];
    for (const frame of sampledFrames) {
      const { mimeType, base64 } = stripDataUrlPrefix(frame.dataUrl);
      multimodalInput.push({
        type: "image",
        data: base64,
        mime_type: mimeType,
        resolution: ingestMode === "burst_photo_3x" ? "medium" : "low"
      });
    }
    let decisionScores;
    let decisionUsage = { total_input_tokens: 0, total_output_tokens: 0 };
    try {
      const decisionResponse = await clients.decisionsAi.decisions.create({
        model: "gemini-decision-1",
        input: multimodalInput,
        questions: {
          user_stalled: {
            type: "noul",
            instructions: "Has the user hesitated, stalled, or kept hands stationary on an unresolved physical assembly/repair step?",
            criteria: {
              true_description: "Hands are stalled, confused, or waiting for the next physical step.",
              false_description: "User is smoothly and confidently progressing through assembly."
            }
          },
          hazard_proximity: {
            type: "noul",
            instructions: "Are the user hands or tool near a mechanical hazard, active leak, or forcing a clip/fastener in a damaging direction?",
            criteria: {
              true_description: "Clear risk of snapping a clip, stripping a fastener, water spray, or hand injury.",
              false_description: "Safe hand placement and controlled tool orientation."
            }
          },
          alignment_anomaly: {
            type: "noul",
            instructions: "Is there a visible physical misalignment, wrong fastener/tool mismatch, or crooked bracket/nut in the frame?",
            criteria: {
              true_description: "Visible crooked hinge, mismatched screw/bolt size, cross-threading, or wrong rotation direction.",
              false_description: "All visible components are properly aligned and matched."
            }
          },
          visual_noise_extreme: {
            type: "noul",
            instructions: "Is the image buffer severely degraded by water droplets on the lens, harsh chrome flashlight glare, or extreme motion blur?",
            criteria: {
              true_description: "Cannot reliably read threads or component geometry due to glare, water, or blur.",
              false_description: "Component geometry is legible enough for visual inspection."
            }
          },
          camera_focused: {
            type: "noul",
            instructions: "Is the primary physical component sharply focused?"
          },
          object_in_frame: {
            type: "noul",
            instructions: "Is the target physical object completely inside the camera frame?"
          }
        }
      });
      const answers = decisionResponse.answers;
      if (!answers) {
        return res.status(400).json({
          error: "gemini-decision-1 returned no answers (content may have been filtered).",
          promptFeedback: decisionResponse.prompt_feedback ?? null
        });
      }
      const readNoul = (key) => {
        const a = answers[key];
        return a?.type === "noul" ? Number(a.noul.toFixed(4)) : 0.01;
      };
      decisionScores = {
        userStalled: readNoul("user_stalled"),
        hazardProximity: readNoul("hazard_proximity"),
        alignmentAnomaly: readNoul("alignment_anomaly"),
        visualNoiseExtreme: readNoul("visual_noise_extreme"),
        cameraFocused: readNoul("camera_focused"),
        objectInFrame: readNoul("object_in_frame")
      };
      const usageAny = decisionResponse.usage;
      decisionUsage = {
        total_input_tokens: usageAny?.total_input_tokens ?? 0,
        total_output_tokens: usageAny?.total_output_tokens ?? 0
      };
    } catch (err) {
      const { status, message } = extractErrorDetails(err);
      return res.status(status).json({
        error: `Gemini Decisions API (gemini-decision-1) failed: ${message}`,
        stage: "gemini-decision-1"
      });
    }
    const route = evaluateDecisionsRouting(decisionScores, ANOMALY_CONFIDENCE_THRESHOLD);
    const ragMatches = localOntology.searchRagSubgraph(
      Array.isArray(queryVector) && queryVector.length > 0 ? buildFeatureVector(queryVector.map(Number)) : buildFeatureVector([0.14, 0.16, 0.87, 0.43, 0.1, 0.07, 0.06, 0.09]),
      scaleAnchor,
      Boolean(hasWebXRDepth),
      3
    );
    if (route.shouldDowngradeToBurst) {
      return res.json({
        escalatedToNeon: false,
        downgradeToBurst: true,
        decisionModel: "gemini-decision-1",
        decisionScores,
        decisionUsage,
        route,
        voiceInstruction: "I can't see the threading clearly. Wipe the lens and hold still for three high-contrast burst photos.",
        ragMatches
      });
    }
    const hasExplicitQuestion = typeof userQuestion === "string" && userQuestion.trim().length > 0;
    if (!route.shouldEscalateToNeon && !hasExplicitQuestion) {
      return res.json({
        escalatedToNeon: false,
        downgradeToBurst: false,
        decisionModel: "gemini-decision-1",
        decisionScores,
        decisionUsage,
        route,
        ragMatches
      });
    }
    const clientHasScale = Boolean(hasWebXRDepth) || scaleAnchor !== "none";
    const responseLang = normalizeBcp47Language(
      typeof preferredLanguage === "string" ? preferredLanguage : void 0,
      "en-US"
    );
    const ragContextText = ragMatches.map(
      (m, i) => `${i + 1}. [ID ${m.component.id}] ${m.component.name} (${m.ancestryPath}) | Similarity=${m.similarity} | Pitch=${m.component.threadPitchMm ?? "N/A"}mm | Precursor=${m.component.failurePrecursorCue} | Tool=${m.scaleGatedAdvice.toolRequired} (${m.scaleGatedAdvice.toolSizeSpec}) | Step=${m.scaleGatedAdvice.instructionText}`
    ).join("\n");
    try {
      const neonInteraction = await clients.interactionsAi.interactions.create({
        model: "gemini-4-neon",
        system_instruction: "You are Jack of All Trades, a precision physical repair and assembly diagnostic engine. Analyze the visual frames alongside the Ontology RAG matches and produce plain-English, actionable multi-step instructions.\nCRITICAL SCALE CALIBRATION RULE (Break 2 \u2014 Scale Hallucination Guard):\n" + SCALE_CALIBRATION_PROMPT_GUIDE + '\n1. Inspect the image(s) carefully for any known-size physical reference object placed beside the part: a US quarter / coin ("us_quarter" or "coin"), a credit/debit/ID card ("credit_card"), a human thumb/finger ("human_thumb"), or a ruler/tape measure ("ruler"). If none is clearly visible beside the part, set detectedScaleObject="none" and scaleCalibrated=false.\n2. ONLY set scaleCalibrated=true if a reference object is clearly visible right next to the part on the same depth plane (or WebXR depth is active: ' + String(clientHasScale) + ').\n3. If scaleCalibrated=true, explicitly state the measured millimeter comparison in scaleMeasurementNote AND confirm in voiceCoachingLine which object calibrated scale along with the exact tool size.\n4. If scaleCalibrated=false, you are STRICTLY BARRED from recommending a specific numeric tool size (e.g., 10mm, M4, 3/8"). Set requiresScaleAnchor=true and toolSizeSpec="". ' + (scaleOptOut ? "The user chose to continue without scaling: briefly note why a reference object helps avoid wrong tool sizes, and still give safe actionable multi-step repair steps." : "Ask the user in voiceCoachingLine to place a quarter, credit card, or their thumb next to the part so we can calibrate exact tool size\u2014or let them know they can continue without scaling.") + "\n5. SPATIAL AR OVERLAY & PER-STEP PiP VIDEO RULE:\n   - Return targetBox as [ymin, xmin, ymax, xmax] (0..1000 image coordinates) tightly around the part to repair.\n   - If a scale anchor object is visible, return anchorBox as [ymin, xmin, ymax, xmax] (0..1000) around the coin/card/thumb.\n   - Break complex repairs into 2 to 5 clear sequential steps[]. For EACH step, specify motionCue (rotate_cw, rotate_ccw, slide, lift, press, align, inspect), targetBox, and a dedicated pipMotionPrompt showing close-up hands performing THAT step\u2019s physical repair motion.\n   - NEVER write a pipMotionPrompt about placing a coin, card, or thumb\u2014PiP videos must ALWAYS demonstrate the actual mechanical repair hand motion.\nReturn concise JSON only.",
        input: [
          ...multimodalInput,
          {
            type: "text",
            text: `
Decisions API trigger: ${route.dominantTrigger} (confidence=${route.maxAnomalyConfidence}).
scaleOptOut=${Boolean(scaleOptOut)}, clientScaleAnchor=${scaleAnchor}, webXRDepth=${Boolean(hasWebXRDepth)}.
Ontology RAG Subgraph:
${ragContextText}
Return the detected scale object, millimeter comparison (if calibrated), targetBox, anchorBox, component diagnosis, 2-5 sequential repair steps[] each with its own motionCue and repair pipMotionPrompt, tool required, and a concise spoken voiceCoachingLine (under 3 sentences).`
          }
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
              description: "One of: us_quarter, coin, credit_card, human_thumb, ruler, webxr_depth, or none."
            },
            scaleCalibrated: {
              type: Type.BOOLEAN,
              description: "True ONLY if a known-size reference object is clearly visible beside the target part and scale was properly calibrated."
            },
            scaleConfidence: {
              type: Type.NUMBER,
              description: "Confidence from 0.0 to 1.0 in the detected scale reference object."
            },
            estimatedPartSizeMm: {
              type: Type.NUMBER,
              description: "Estimated target part width or diameter in millimeters when scaleCalibrated=true (0 if uncalibrated)."
            },
            scaleMeasurementNote: {
              type: Type.STRING,
              description: "1-sentence explanation comparing the part size to the visible reference object (empty if uncalibrated)."
            },
            targetBox: {
              type: Type.ARRAY,
              items: { type: Type.NUMBER },
              description: "Bounding box [ymin, xmin, ymax, xmax] in 0..1000 image coordinates around the part to fix."
            },
            anchorBox: {
              type: Type.ARRAY,
              items: { type: Type.NUMBER },
              description: "Bounding box [ymin, xmin, ymax, xmax] in 0..1000 coordinates around the detected scale anchor object (empty array if none)."
            },
            motionCue: {
              type: Type.STRING,
              description: "Primary AR motion cue: rotate_cw, rotate_ccw, slide, lift, press, align, or inspect."
            },
            steps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  detail: { type: Type.STRING },
                  motionCue: { type: Type.STRING },
                  targetBox: {
                    type: Type.ARRAY,
                    items: { type: Type.NUMBER }
                  },
                  pipMotionPrompt: {
                    type: Type.STRING,
                    description: "Close-up hand-motion prompt showing the physical repair action for THIS step (never coin placement)."
                  },
                  toolNeeded: { type: Type.STRING }
                },
                required: ["title", "detail", "motionCue", "pipMotionPrompt"]
              }
            },
            rotationDirection: { type: Type.STRING },
            pipMotionPrompt: { type: Type.STRING },
            voiceCoachingLine: { type: Type.STRING }
          },
          required: [
            "componentName",
            "diagnosisSummary",
            "nextStepInstruction",
            "toolRequired",
            "requiresScaleAnchor",
            "detectedScaleObject",
            "scaleCalibrated",
            "targetBox",
            "motionCue",
            "steps",
            "pipMotionPrompt",
            "voiceCoachingLine"
          ]
        },
        generation_config: {
          thinking_level: "medium"
        }
      });
      const rawText = neonInteraction.output_text ?? "";
      let parsedDiagnosis = {};
      try {
        parsedDiagnosis = JSON.parse(rawText);
      } catch {
        const match = rawText.match(/\{[\s\S]*\}/);
        parsedDiagnosis = match ? JSON.parse(match[0]) : { diagnosisSummary: rawText };
      }
      const resolvedAnchorBox = normalizeBoxToPct(parsedDiagnosis.anchorBox);
      const scaleCalibration = resolveScaleCalibration({
        detectedObject: typeof parsedDiagnosis.detectedScaleObject === "string" ? parsedDiagnosis.detectedScaleObject : "none",
        scaleCalibrated: Boolean(parsedDiagnosis.scaleCalibrated),
        scaleConfidence: typeof parsedDiagnosis.scaleConfidence === "number" ? parsedDiagnosis.scaleConfidence : void 0,
        estimatedPartSizeMm: typeof parsedDiagnosis.estimatedPartSizeMm === "number" ? parsedDiagnosis.estimatedPartSizeMm : null,
        scaleMeasurementNote: typeof parsedDiagnosis.scaleMeasurementNote === "string" ? parsedDiagnosis.scaleMeasurementNote : null,
        anchorBox: resolvedAnchorBox,
        explicitOptOut: Boolean(scaleOptOut),
        hasWebXRDepth: Boolean(hasWebXRDepth),
        clientScaleAnchor: scaleAnchor
      });
      const effectiveAnchor = mapDetectedObjectToScaleAnchor(scaleCalibration.detectedObject);
      const scaleGated = enforceScaleAnchorInvariant(
        {
          toolRequired: String(parsedDiagnosis.toolRequired || "Hand Inspection"),
          toolSizeSpec: scaleCalibration.confirmed && parsedDiagnosis.toolSizeSpec ? String(parsedDiagnosis.toolSizeSpec) : null,
          requiresScaleAnchor: !scaleCalibration.confirmed,
          instructionText: String(parsedDiagnosis.nextStepInstruction || "")
        },
        effectiveAnchor,
        Boolean(hasWebXRDepth)
      );
      const primaryFrameDataUrl = sampledFrames[sampledFrames.length - 1]?.dataUrl ?? null;
      const learned = await recordLiveDiagnosisToCloudSql({
        componentName: String(parsedDiagnosis.componentName || "Highlighted Area"),
        diagnosisSummary: String(parsedDiagnosis.diagnosisSummary || ""),
        nextStepInstruction: scaleGated.instructionText,
        toolRequired: scaleGated.toolRequired,
        toolSizeSpec: scaleGated.toolSizeSpec,
        requiresScaleAnchor: !scaleCalibration.confirmed,
        pipMotionPrompt: typeof parsedDiagnosis.pipMotionPrompt === "string" ? parsedDiagnosis.pipMotionPrompt : void 0,
        motionCue: normalizeMotionCue(parsedDiagnosis.motionCue || parsedDiagnosis.rotationDirection),
        estimatedPartSizeMm: scaleCalibration.estimatedPartSizeMm,
        scaleAnchor: effectiveAnchor,
        hasWebXRDepth: Boolean(hasWebXRDepth),
        ingestMode: ingestMode === "burst_photo_3x" ? "burst_photo_3x" : "webrtc_video",
        frameDataUrl: primaryFrameDataUrl,
        clients
      });
      const baseCoaching = String(
        parsedDiagnosis.voiceCoachingLine || parsedDiagnosis.nextStepInstruction || ""
      ).trim();
      let spokenText = baseCoaching;
      if (scaleCalibration.status === "calibrated") {
        const alreadyMentionsScale = /scale|calibrat|quarter|coin|card|thumb|ruler/i.test(baseCoaching);
        spokenText = alreadyMentionsScale ? baseCoaching : `${scaleCalibration.spokenScaleNotice} ${baseCoaching}`.trim();
      } else if (scaleCalibration.status === "opted_out") {
        spokenText = `${scaleCalibration.spokenScaleNotice} ${baseCoaching}`.trim();
      } else {
        const alreadyAsksAnchor = /quarter|credit card|thumb|scale/i.test(baseCoaching);
        spokenText = alreadyAsksAnchor ? baseCoaching : `${baseCoaching} ${scaleCalibration.spokenScaleNotice}`.trim();
      }
      let audioBase64 = null;
      let audioMimeType = null;
      if (spokenText.length > 0) {
        try {
          const ttsRes = await clients.interactionsAi.interactions.create({
            model: "gemini-3.8-flash-lite-tts",
            input: [
              {
                type: "text",
                text: spokenText,
                annotations: [
                  {
                    type: "speech_metadata",
                    style: "Calm, clear, helpful expert mechanic speaking concisely"
                  }
                ]
              }
            ],
            store: false,
            response_format: { type: "audio" },
            generation_config: {
              speech_config: [{ language: responseLang, voice: "Kore" }]
            }
          });
          if (ttsRes.output_audio?.data) {
            audioBase64 = ttsRes.output_audio.data;
            audioMimeType = ttsRes.output_audio.mime_type || "audio/wav";
          }
        } catch (ttsErr) {
          console.warn("[Scan TTS fallback]", ttsErr.message);
        }
      }
      return res.json({
        escalatedToNeon: true,
        downgradeToBurst: false,
        decisionModel: "gemini-decision-1",
        reasoningModel: "gemini-4-neon",
        decisionScores,
        decisionUsage,
        route,
        ragMatches,
        scaleCalibration,
        spokenText,
        audioBase64,
        audioMimeType,
        sessionId: learned.sessionId,
        componentId: learned.componentId,
        diagnosis: {
          ...parsedDiagnosis,
          toolRequired: scaleGated.toolRequired,
          toolSizeSpec: scaleGated.toolSizeSpec,
          scaleGuardBlocked: scaleGated.scaleGuardBlocked,
          nextStepInstruction: scaleGated.instructionText,
          anchorPrompt: scaleGated.anchorPrompt
        }
      });
    } catch (err) {
      const { status, message } = extractErrorDetails(err);
      return res.status(status).json({
        error: `Gemini 4 Neon (gemini-4-neon) failed: ${message}`,
        stage: "gemini-4-neon",
        decisionScores,
        route
      });
    }
  });
  app.post("/api/generate-pip", requireEndUser, async (req, res) => {
    const { prompt, referenceFrameDataUrl, duration = "6s" } = req.body ?? {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "A motion guidance prompt is required." });
    }
    const clients = getGeminiClients();
    if (!clients) {
      return res.status(503).json({
        error: "GEMINI_API_KEY is not configured on the server. Configure a billing-enabled Gemini 4 API key to generate PiP video loops via gemini-omni-1.2-flash.",
        code: "API_KEY_MISSING"
      });
    }
    try {
      const inputParts = [];
      if (typeof referenceFrameDataUrl === "string" && referenceFrameDataUrl.length > 32) {
        const { mimeType, base64 } = stripDataUrlPrefix(referenceFrameDataUrl);
        inputParts.push({ type: "image", mime_type: mimeType, data: base64 });
      }
      inputParts.push({
        type: "text",
        text: `Clean instructional workbench close-up showing exact hand mechanics for repair guidance: ${prompt}`
      });
      const interaction = await clients.interactionsAi.interactions.create(
        {
          model: "gemini-omni-1.2-flash",
          input: inputParts,
          background: false,
          store: false,
          stream: false,
          response_format: {
            type: "video",
            aspect_ratio: "16:9",
            duration: duration === "10s" ? "10s" : "6s",
            resolution: "720p"
          }
        },
        { timeout: 3e5 }
      );
      const videoPart = interaction.output_video;
      if (!videoPart || !videoPart.data && !videoPart.uri) {
        return res.status(502).json({
          error: "gemini-omni-1.2-flash returned no video payload."
        });
      }
      return res.json({
        model: "gemini-omni-1.2-flash",
        mimeType: videoPart.mime_type || "video/mp4",
        videoDataUrl: videoPart.data ? `data:${videoPart.mime_type || "video/mp4"};base64,${videoPart.data}` : null,
        videoUri: videoPart.uri || null
      });
    } catch (err) {
      const { status, message } = extractErrorDetails(err);
      return res.status(status).json({
        error: `Gemini Omni Flash (gemini-omni-1.2-flash) PiP generation failed: ${message}`,
        stage: "gemini-omni-1.2-flash"
      });
    }
  });
  app.post("/api/voice-assist", requireEndUser, async (req, res) => {
    const {
      frames = [],
      audio,
      audioDataUrl,
      audioBase64,
      audioMimeType = "audio/webm",
      preferredLanguage,
      scaleAnchor = "none",
      hasWebXRDepth = false,
      scaleOptOut = false,
      format
    } = req.body ?? {};
    const rawAudioInput = typeof audio === "string" ? audio : typeof audio?.data === "string" ? audio.data : typeof audioDataUrl === "string" ? audioDataUrl : typeof audioBase64 === "string" ? audioBase64 : "";
    const rawMime = typeof audio === "object" && audio?.mimeType || (typeof audioMimeType === "string" ? audioMimeType : "audio/webm");
    const fallbackLanguage = normalizeBcp47Language(
      typeof preferredLanguage === "string" ? preferredLanguage : void 0,
      "en-US"
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
        error: "GEMINI_API_KEY is not configured on the server. Configure a valid Gemini 4 API key in Secrets.",
        code: "API_KEY_MISSING"
      });
    }
    const incomingFrames = Array.isArray(frames) ? frames : [];
    const stride = Math.max(1, Math.floor(incomingFrames.length / 4));
    const sampledFrames = incomingFrames.filter((_f, i) => i % stride === 0).slice(0, 4);
    const multimodalParts = [];
    for (const frame of sampledFrames) {
      if (typeof frame?.dataUrl !== "string" || frame.dataUrl.length < 32) continue;
      const { mimeType, base64 } = stripDataUrlPrefix(frame.dataUrl);
      multimodalParts.push({
        type: "image",
        data: base64,
        mime_type: mimeType,
        resolution: "medium"
      });
    }
    multimodalParts.push({
      type: "audio",
      data: cleanAudioBase64,
      mime_type: cleanAudioMime
    });
    multimodalParts.push({
      type: "text",
      text: '1. Listen carefully to the attached audio clip. Set speechDetected=true ONLY if intelligible human speech is actually audible; set speechDetected=false if the clip is silent or contains only noise.\n2. If speechDetected=true, write the exact verbatim words heard in userTranscript (in the original spoken language) and set detectedLanguageCode to the matching BCP-47 tag (e.g., "es-ES", "es-MX", "fr-FR", "ja-JP", "de-DE", "pt-BR", "zh-CN", "ar-EG", "hi-IN", "en-US").\n3. If speechDetected=false, set userTranscript="", set detectedLanguageCode="' + fallbackLanguage + '", do NOT invent a repair problem, and write a brief polite prompt in "' + fallbackLanguage + '" asking the user to hold the button and speak closer to the microphone.\n4. SCALE ANCHOR CHECK (MANDATORY):\n' + SCALE_CALIBRATION_PROMPT_GUIDE + "\nInspect the attached camera frame(s) for a known-size reference object placed beside the part: us_quarter, coin, credit_card, human_thumb, or ruler. Set detectedScaleObject and set scaleCalibrated=true ONLY if clearly visible right beside the target part on the same depth plane.\n5. SCALE OPT-OUT CHECK: Set userDeclinedScale=true if the user says they do not want to scale, want to skip scaling, or do not have a scale object (client scaleOptOut=" + String(Boolean(scaleOptOut)) + ").\n6. Write ALL user-facing text (spokenResponse, componentName, diagnosisSummary, nextStepInstruction, steps, scaleMeasurementNote, and whyScaleMattersLocalized) STRICTLY in detectedLanguageCode \u2014 never switch languages.\n7. In spokenResponse (3 short sentences max, no markdown):\n   - If scaleCalibrated=true: explicitly confirm you calibrated scale using the detected object (and estimated size), then give the direct mechanic fix (exact tool size allowed).\n   - If scaleCalibrated=false AND (userDeclinedScale=true OR scaleOptOut=true): acknowledge continuing without scaling, include a 1-sentence summary of why a reference object matters (camera lenses distort close-up size so tool sizes are approximate), and give the safe repair step without claiming exact numeric tool sizes.\n   - If scaleCalibrated=false AND NOT opted out: give safe preliminary guidance (NO specific numeric tool sizes) AND ask the user to hold a quarter, credit card, or their thumb next to the part so you can confirm exact scale\u2014or say if they prefer to continue without scaling.\n8. SPATIAL AR OVERLAY & MULTI-STEP PiP VIDEO RULE:\n   - Return targetBox [ymin, xmin, ymax, xmax] (0..1000) tightly around the part to repair, and anchorBox [ymin, xmin, ymax, xmax] around the scale object if visible.\n   - Break the fix into 2 to 5 clear sequential steps[]. For EACH step include motionCue (rotate_cw, rotate_ccw, slide, lift, press, align, inspect), targetBox, and a dedicated pipMotionPrompt showing close-up hands performing THAT step\u2019s physical repair action.\n   - NEVER make pipMotionPrompt about placing a coin/card/thumb\u2014PiP videos must ALWAYS show the actual physical repair motion."
    });
    let spokenText = "";
    let detectedLanguageCode = fallbackLanguage;
    let detectedLanguageName = "Auto";
    let speechDetected = true;
    let userTranscript = "";
    let scaleCalibration = null;
    let structuredDiagnosis = null;
    let learnedSessionId = null;
    let learnedComponentId = null;
    try {
      const reasoning = await clients.interactionsAi.interactions.create({
        model: "gemini-4-neon",
        system_instruction: EXPERT_MECHANIC_SYSTEM_PROMPT,
        input: multimodalParts,
        store: false,
        generation_config: {
          thinking_level: "low"
        },
        response_format: {
          type: Type.OBJECT,
          properties: {
            speechDetected: {
              type: Type.BOOLEAN,
              description: "True only if intelligible human speech is present in the audio clip; false if silent or unintelligible noise."
            },
            userTranscript: {
              type: Type.STRING,
              description: "Verbatim transcription of the user speech in its original spoken language (empty string if speechDetected is false)."
            },
            detectedLanguageCode: {
              type: Type.STRING,
              description: "BCP-47 locale tag matching userTranscript (e.g., es-ES, fr-FR, ja-JP, pt-BR, en-US), or the fallback locale if speechDetected is false."
            },
            detectedLanguageName: {
              type: Type.STRING,
              description: "Human-readable name of the detected language (e.g., Spanish, French, Japanese, English)."
            },
            detectedScaleObject: {
              type: Type.STRING,
              description: "Detected scale object beside the part: us_quarter, coin, credit_card, human_thumb, ruler, webxr_depth, or none."
            },
            scaleCalibrated: {
              type: Type.BOOLEAN,
              description: "True ONLY if a known-size reference object is clearly visible right next to the part and scale was properly calibrated."
            },
            scaleConfidence: {
              type: Type.NUMBER,
              description: "Confidence 0.0 to 1.0 in the detected scale reference object."
            },
            estimatedPartSizeMm: {
              type: Type.NUMBER,
              description: "Estimated target part width/diameter in mm when calibrated (0 if uncalibrated)."
            },
            scaleMeasurementNote: {
              type: Type.STRING,
              description: "1-sentence measurement comparison against the reference object in detectedLanguageCode."
            },
            targetBox: {
              type: Type.ARRAY,
              items: { type: Type.NUMBER },
              description: "Bounding box [ymin, xmin, ymax, xmax] in 0..1000 coordinates around the part to fix."
            },
            anchorBox: {
              type: Type.ARRAY,
              items: { type: Type.NUMBER },
              description: "Bounding box [ymin, xmin, ymax, xmax] in 0..1000 coordinates around the scale object (empty if none)."
            },
            motionCue: {
              type: Type.STRING,
              description: "Primary AR motion cue: rotate_cw, rotate_ccw, slide, lift, press, align, or inspect."
            },
            userDeclinedScale: {
              type: Type.BOOLEAN,
              description: "True if the user explicitly asked to skip scaling or continue without using a reference object."
            },
            whyScaleMattersLocalized: {
              type: Type.STRING,
              description: "A short 1-2 sentence explanation in detectedLanguageCode explaining why placing a quarter, credit card, or thumb beside the part matters for accurate tool sizing."
            },
            spokenResponse: {
              type: Type.STRING,
              description: "Direct, actionable mechanic guidance written strictly in detectedLanguageCode, under 3 sentences, including scale confirmation, anchor prompt, or opt-out explanation as appropriate."
            },
            componentName: {
              type: Type.STRING,
              description: "Short plain-language name of the visible part/assembly in detectedLanguageCode."
            },
            diagnosisSummary: {
              type: Type.STRING,
              description: "Concise 1-2 sentence summary of the visual issue and fix in detectedLanguageCode."
            },
            nextStepInstruction: {
              type: Type.STRING,
              description: "Primary actionable repair step in detectedLanguageCode."
            },
            toolRequired: {
              type: Type.STRING,
              description: "Tool category needed (e.g., Phillips screwdriver, Hex key, No tools needed)."
            },
            toolSizeSpec: {
              type: Type.STRING,
              description: "Exact numeric size ONLY if scaleCalibrated=true; otherwise empty string."
            },
            steps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  detail: { type: Type.STRING },
                  motionCue: { type: Type.STRING },
                  targetBox: {
                    type: Type.ARRAY,
                    items: { type: Type.NUMBER }
                  },
                  pipMotionPrompt: {
                    type: Type.STRING,
                    description: "Close-up hand-motion prompt showing the physical repair action for THIS step (never coin placement)."
                  },
                  toolNeeded: { type: Type.STRING }
                },
                required: ["title", "detail", "motionCue", "pipMotionPrompt"]
              }
            },
            pipMotionPrompt: {
              type: Type.STRING,
              description: "Short visual hand-motion prompt for optional PiP demonstration of the repair."
            }
          },
          required: [
            "speechDetected",
            "userTranscript",
            "detectedLanguageCode",
            "detectedLanguageName",
            "detectedScaleObject",
            "scaleCalibrated",
            "userDeclinedScale",
            "whyScaleMattersLocalized",
            "spokenResponse",
            "componentName",
            "diagnosisSummary",
            "nextStepInstruction",
            "toolRequired",
            "targetBox",
            "motionCue",
            "steps"
          ]
        }
      });
      const rawOutput = reasoning.output_text || "";
      try {
        const parsed = JSON.parse(rawOutput);
        speechDetected = parsed.speechDetected !== false;
        userTranscript = parsed.userTranscript?.trim() || "";
        const rawCode = speechDetected ? parsed.detectedLanguageCode : fallbackLanguage;
        detectedLanguageCode = normalizeBcp47Language(rawCode, fallbackLanguage);
        detectedLanguageName = parsed.detectedLanguageName?.trim() || detectedLanguageCode;
        spokenText = enforceThreeSentenceCap(parsed.spokenResponse || rawOutput);
        const resolvedAnchorBox = normalizeBoxToPct(parsed.anchorBox);
        scaleCalibration = resolveScaleCalibration({
          detectedObject: parsed.detectedScaleObject,
          scaleCalibrated: Boolean(parsed.scaleCalibrated),
          scaleConfidence: parsed.scaleConfidence,
          estimatedPartSizeMm: typeof parsed.estimatedPartSizeMm === "number" ? parsed.estimatedPartSizeMm : null,
          scaleMeasurementNote: parsed.scaleMeasurementNote ?? null,
          anchorBox: resolvedAnchorBox,
          explicitOptOut: Boolean(scaleOptOut),
          userDeclinedInSpeech: Boolean(parsed.userDeclinedScale),
          userTranscript,
          hasWebXRDepth: Boolean(hasWebXRDepth),
          clientScaleAnchor: scaleAnchor,
          localizedWhyScaleMatters: parsed.whyScaleMattersLocalized
        });
        const effectiveAnchor = mapDetectedObjectToScaleAnchor(scaleCalibration.detectedObject);
        const scaleGated = enforceScaleAnchorInvariant(
          {
            toolRequired: parsed.toolRequired?.trim() || "Hand Inspection",
            toolSizeSpec: scaleCalibration.confirmed && parsed.toolSizeSpec?.trim() ? parsed.toolSizeSpec.trim() : null,
            requiresScaleAnchor: !scaleCalibration.confirmed,
            instructionText: parsed.nextStepInstruction?.trim() || spokenText
          },
          effectiveAnchor,
          Boolean(hasWebXRDepth)
        );
        if (speechDetected) {
          const primaryMotion = normalizeMotionCue(parsed.motionCue || parsed.nextStepInstruction);
          structuredDiagnosis = {
            componentName: parsed.componentName?.trim() || "Visual Repair Guidance",
            diagnosisSummary: parsed.diagnosisSummary?.trim() || spokenText,
            nextStepInstruction: scaleGated.instructionText,
            toolRequired: scaleGated.toolRequired,
            toolSizeSpec: scaleGated.toolSizeSpec,
            scaleGuardBlocked: scaleGated.scaleGuardBlocked,
            anchorPrompt: scaleGated.anchorPrompt,
            targetBox: parsed.targetBox,
            anchorBox: parsed.anchorBox,
            motionCue: primaryMotion,
            pipMotionPrompt: parsed.pipMotionPrompt?.trim() || void 0,
            steps: Array.isArray(parsed.steps) ? parsed.steps : []
          };
          const primaryFrame = sampledFrames[sampledFrames.length - 1]?.dataUrl ?? null;
          const learned = await recordLiveDiagnosisToCloudSql({
            componentName: String(structuredDiagnosis.componentName),
            diagnosisSummary: String(structuredDiagnosis.diagnosisSummary),
            nextStepInstruction: scaleGated.instructionText,
            toolRequired: scaleGated.toolRequired,
            toolSizeSpec: scaleGated.toolSizeSpec,
            requiresScaleAnchor: !scaleCalibration.confirmed,
            pipMotionPrompt: parsed.pipMotionPrompt?.trim() || void 0,
            motionCue: primaryMotion,
            estimatedPartSizeMm: scaleCalibration.estimatedPartSizeMm,
            scaleAnchor: effectiveAnchor,
            hasWebXRDepth: Boolean(hasWebXRDepth),
            ingestMode: "webrtc_video",
            frameDataUrl: primaryFrame,
            clients
          });
          learnedSessionId = learned.sessionId;
          learnedComponentId = learned.componentId;
        }
      } catch {
        spokenText = enforceThreeSentenceCap(rawOutput);
      }
    } catch (err) {
      const { status, message } = extractErrorDetails(err);
      return res.status(status).json({
        error: `Multimodal voice analysis failed: ${message}`,
        stage: "gemini-4-neon"
      });
    }
    try {
      const ttsInteraction = await clients.interactionsAi.interactions.create({
        model: "gemini-3.8-flash-lite-tts",
        input: [
          {
            type: "text",
            text: spokenText,
            annotations: [
              {
                type: "speech_metadata",
                style: `Calm, confident, direct expert mechanic speaking naturally in ${detectedLanguageName}`
              }
            ]
          }
        ],
        store: false,
        response_format: { type: "audio" },
        generation_config: {
          speech_config: [
            {
              language: detectedLanguageCode,
              voice: "Kore"
            }
          ]
        }
      });
      const outputAudio = ttsInteraction.output_audio;
      if (!outputAudio?.data) {
        return res.status(502).json({
          error: "Gemini speech synthesis returned no audio payload.",
          spokenText,
          detectedLanguageCode,
          detectedLanguageName,
          diagnosis: structuredDiagnosis,
          scaleCalibration,
          sessionId: learnedSessionId,
          componentId: learnedComponentId
        });
      }
      const wavMime = outputAudio.mime_type || "audio/wav";
      const wantsBinary = format === "binary" || typeof req.headers.accept === "string" && req.headers.accept.includes("audio/");
      if (wantsBinary) {
        const wavBuffer = Buffer.from(outputAudio.data, "base64");
        res.setHeader("Content-Type", wavMime);
        res.setHeader("Content-Length", String(wavBuffer.length));
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-MakerLens-Transcript", encodeURIComponent(spokenText));
        res.setHeader("X-MakerLens-Language", detectedLanguageCode);
        res.setHeader("X-MakerLens-Language-Name", encodeURIComponent(detectedLanguageName));
        if (scaleCalibration) {
          res.setHeader("X-MakerLens-Scale-Status", scaleCalibration.status);
          res.setHeader("X-MakerLens-Scale-Object", scaleCalibration.detectedObject);
        }
        res.setHeader("X-MakerLens-Vision-Model", "gemini-4-neon");
        res.setHeader("X-MakerLens-Speech-Model", "gemini-3.8-flash-lite-tts");
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
        sessionId: learnedSessionId,
        componentId: learnedComponentId,
        visionModel: "gemini-4-neon",
        speechModel: "gemini-3.8-flash-lite-tts"
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
        stage: "gemini-3.8-flash-lite-tts"
      });
    }
  });
  const spokenNoticeCache = /* @__PURE__ */ new Map();
  app.post("/api/speak-notice", requireEndUser, async (req, res) => {
    const rawText = typeof req.body?.text === "string" && req.body.text.trim().length > 0 ? req.body.text.trim().slice(0, 480) : WHY_SCALE_MATTERS_SPOKEN;
    const lang = normalizeBcp47Language(
      typeof req.body?.language === "string" ? req.body.language : void 0,
      "en-US"
    );
    const cacheKey = `${lang}:${rawText}`;
    const cached = spokenNoticeCache.get(cacheKey);
    if (cached) {
      res.setHeader("Content-Type", cached.mimeType);
      res.setHeader("Content-Length", String(cached.wavBuffer.length));
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.status(200).send(cached.wavBuffer);
    }
    const clients = getGeminiClients();
    if (!clients) {
      return res.status(503).json({
        error: "GEMINI_API_KEY is not configured.",
        fallbackText: rawText
      });
    }
    try {
      const ttsInteraction = await clients.interactionsAi.interactions.create({
        model: "gemini-3.8-flash-lite-tts",
        input: [
          {
            type: "text",
            text: rawText,
            annotations: [
              {
                type: "speech_metadata",
                style: "Warm, clear, reassuring repair assistant speaking concisely"
              }
            ]
          }
        ],
        store: false,
        response_format: { type: "audio" },
        generation_config: {
          speech_config: [{ language: lang, voice: "Kore" }]
        }
      });
      const outputAudio = ttsInteraction.output_audio;
      if (!outputAudio?.data) {
        return res.status(502).json({ error: "No audio payload returned.", fallbackText: rawText });
      }
      const wavBuffer = Buffer.from(outputAudio.data, "base64");
      const mimeType = outputAudio.mime_type || "audio/wav";
      if (spokenNoticeCache.size < 32) {
        spokenNoticeCache.set(cacheKey, { wavBuffer, mimeType });
      }
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", String(wavBuffer.length));
      return res.status(200).send(wavBuffer);
    } catch (err) {
      const { status, message } = extractErrorDetails(err);
      return res.status(status).json({ error: message, fallbackText: rawText });
    }
  });
  const demoNarrationCache = /* @__PURE__ */ new Map();
  app.get("/api/demo-narration", async (req, res) => {
    const rawCue = typeof req.query.cue === "string" ? req.query.cue.trim() : "intro";
    if (!isValidDemoCueId(rawCue)) {
      return res.status(400).json({ error: "Invalid demo narration cue." });
    }
    const cue = DEMO_NARRATION_CUES[rawCue];
    const cached = demoNarrationCache.get(rawCue);
    if (cached) {
      res.setHeader("Content-Type", cached.mimeType);
      res.setHeader("Content-Length", String(cached.wavBuffer.length));
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-Demo-Cue", rawCue);
      res.setHeader("X-Demo-Cache", "HIT");
      return res.status(200).send(cached.wavBuffer);
    }
    const clients = getGeminiClients();
    if (!clients) {
      return res.status(503).json({
        error: "GEMINI_API_KEY is not configured on the server.",
        fallbackText: cue.spokenText
      });
    }
    try {
      const tts = await clients.interactionsAi.interactions.create({
        model: "gemini-3.8-flash-lite-tts",
        input: [
          {
            type: "text",
            text: cue.spokenText,
            annotations: [
              {
                type: "speech_metadata",
                style: "Warm, reassuring, natural product guide speaking clearly at a conversational pace"
              }
            ]
          }
        ],
        store: false,
        response_format: { type: "audio" },
        generation_config: {
          speech_config: [{ language: "en-US", voice: "Kore" }]
        }
      });
      const outputAudio = tts.output_audio;
      if (!outputAudio?.data) {
        return res.status(502).json({
          error: "Demo narration TTS returned no audio.",
          fallbackText: cue.spokenText
        });
      }
      const wavBuffer = Buffer.from(outputAudio.data, "base64");
      const mimeType = outputAudio.mime_type || "audio/wav";
      demoNarrationCache.set(rawCue, { wavBuffer, mimeType });
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", String(wavBuffer.length));
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-Demo-Cue", rawCue);
      res.setHeader("X-Demo-Cache", "MISS");
      return res.status(200).send(wavBuffer);
    } catch (err) {
      const { status, message } = extractErrorDetails(err);
      return res.status(status).json({
        error: `Demo narration synthesis failed: ${message}`,
        fallbackText: cue.spokenText
      });
    }
  });
  const httpServer = http.createServer(app);
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const disableHmr = process.env.DISABLE_HMR === "true" || Boolean(process.env.K_SERVICE);
    if (disableHmr) {
      const NOOP_VITE_CLIENT_ESM = [
        "const sheetsMap = new Map();",
        "export function updateStyle(id, content) {",
        "  let style = sheetsMap.get(id);",
        "  if (!style) {",
        '    style = document.createElement("style");',
        '    style.setAttribute("type", "text/css");',
        '    style.setAttribute("data-vite-dev-id", id);',
        "    style.textContent = content;",
        "    document.head.appendChild(style);",
        "    sheetsMap.set(id, style);",
        "  } else {",
        "    style.textContent = content;",
        "  }",
        "}",
        "export function removeStyle(id) {",
        "  const style = sheetsMap.get(id);",
        "  if (style) {",
        "    document.head.removeChild(style);",
        "    sheetsMap.delete(id);",
        "  }",
        "}",
        "export function injectQuery(url, queryToInject) {",
        '  if (!url || (!url.startsWith(".") && !url.startsWith("/"))) return url;',
        '  const [pathname, search] = url.split("?");',
        '  return `${pathname}?${queryToInject}${search ? "&" + search : ""}`;',
        "}",
        "export function createHotContext() {",
        "  return {",
        "    data: {},",
        "    accept() {},",
        "    acceptExports() {},",
        "    dispose() {},",
        "    prune() {},",
        "    decline() {},",
        "    invalidate() {},",
        "    on() {},",
        "    off() {},",
        "    send() {},",
        "  };",
        "}",
        "export class ErrorOverlay extends HTMLElement {}"
      ].join("\n");
      app.get("/@vite/client", (_req, res) => {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.send(NOOP_VITE_CLIENT_ESM);
      });
    }
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : { server: httpServer },
        ws: disableHmr ? false : void 0
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[JackOfAllTrades] Express + PWA listening on http://0.0.0.0:${PORT}`);
  });
}
createApp().catch((err) => {
  console.error("[JackOfAllTrades] Fatal startup error:", err);
  process.exit(1);
});
