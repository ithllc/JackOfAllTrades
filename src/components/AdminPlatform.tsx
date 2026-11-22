/**
 * Jack of All Trades — Admin & Operations Platform
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Accessible via `/admin`, `?admin=1`, or by clicking the Jack of Spades logo
 * in the camera header. Unifies live system health, Cloud SQL status,
 * PostgreSQL Recursive CTE & pgvector Ontology management, Architecture &
 * AGPL-3.0 source explorer, and Production Operations Runbook.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Database,
  GitBranch,
  Layers,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Volume2,
} from 'lucide-react';
import { JACK_OF_SPADES_LOGO_URL } from './BrandMark';
import { ArchitectureBlueprint } from './ArchitectureBlueprint';
import { OntologyExplorer, type FlywheelMetrics } from './OntologyExplorer';
import { RunbookView } from './RunbookView';
import type {
  OntologyComponentNode,
  OntologyFeedbackRecord,
  OntologyHierarchyRow,
  OntologyRagMatch,
  ScaleAnchorType,
} from '../lib/routingLogic';

export type AdminTab = 'overview' | 'ontology' | 'architecture' | 'runbook';

interface HealthPayload {
  status: string;
  service: string;
  license: string;
  postgresConfigured: boolean;
  databaseTransport: string;
  sqlConnectionName: string;
  sqlPublicIp: string;
  sqlOutgoingIp: string;
  sqlPort: number;
  sqlSslEnabled: boolean;
  sqlTarget: string;
  geminiConfigured: boolean;
  timestamp: string;
}

interface DbStatusPayload {
  connected: boolean;
  configured: boolean;
  transport: string;
  connectionName: string;
  target?: string;
  sslEnabled?: boolean;
  message?: string;
  error?: string;
  details?: {
    database_name?: string;
    db_user?: string;
    pgvector_enabled?: boolean;
  } | null;
}

interface AdminPlatformProps {
  onOpenCamera: () => void;
  onReplayDemo: () => void;
}

const DEFAULT_FLYWHEEL: FlywheelMetrics = {
  deflectedReturns: 0,
  bountyPerDeflectionUsd: 30,
  grossBountyRevenueUsd: 0,
  totalComputeUsd: 0,
  marginMultiple: 0,
  totalCorrections: 0,
};

const API_ENDPOINTS = [
  {
    method: 'GET',
    path: '/healthz',
    service: 'Express + Cloud Run',
    purpose: 'Liveness probe, Gemini key status, and Cloud SQL transport summary',
  },
  {
    method: 'GET',
    path: '/api/db/status',
    service: 'Cloud SQL (PostgreSQL 16)',
    purpose: 'Live connection test and pgvector extension verification',
  },
  {
    method: 'POST',
    path: '/api/analyze-buffer',
    service: 'gemini-decision-1 → gemini-4-neon',
    purpose: 'Zero-token Decisions API gate escalating anomalies to Neon + RAG',
  },
  {
    method: 'POST',
    path: '/api/voice-assist',
    service: 'gemini-4-neon → gemini-3.8-flash-lite-tts',
    purpose: 'Multilingual two-way voice detection and same-language WAV synthesis',
  },
  {
    method: 'GET',
    path: '/api/demo-narration',
    service: 'gemini-3.8-flash-lite-tts (Cached)',
    purpose: 'Cached neural voiceover clips for the interactive onboarding demo',
  },
  {
    method: 'POST',
    path: '/api/generate-pip',
    service: 'gemini-omni-1.2-flash',
    purpose: 'On-the-fly Picture-in-Picture hand-motion video loop generation',
  },
  {
    method: 'GET',
    path: '/api/ontology/tree',
    service: 'PostgreSQL Recursive CTE',
    purpose: 'Hierarchical hardware assembly tree and flywheel metrics',
  },
  {
    method: 'POST',
    path: '/api/ontology/search',
    service: 'pgvector HNSW RAG',
    purpose: 'Similarity search with Break 2 Scale Anchor redaction enforcement',
  },
  {
    method: 'POST',
    path: '/api/ontology/feedback',
    service: 'gemini-embedding-2 + SQL',
    purpose: 'Updates component embeddings on user bounding-box corrections',
  },
  {
    method: 'GET',
    path: '/api/deliverables',
    service: 'AGPL-3.0 Disclosure',
    purpose: 'Serves schema.sql, server.js, App.jsx, Dockerfile, docs, and LICENSE',
  },
];

export const AdminPlatform: React.FC<AdminPlatformProps> = ({
  onOpenCamera,
  onReplayDemo,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [dbStatus, setDbStatus] = useState<DbStatusPayload | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Ontology state
  const [ontologySource, setOntologySource] = useState<string>('loading');
  const [tree, setTree] = useState<OntologyHierarchyRow[]>([]);
  const [nodes, setNodes] = useState<OntologyComponentNode[]>([]);
  const [feedbackLog, setFeedbackLog] = useState<OntologyFeedbackRecord[]>([]);
  const [flywheel, setFlywheel] = useState<FlywheelMetrics>(DEFAULT_FLYWHEEL);
  const [scaleAnchor, setScaleAnchor] = useState<ScaleAnchorType>('none');
  const [hasWebXRDepth, setHasWebXRDepth] = useState<boolean>(false);

  // Deliverables state (Architecture & Runbook)
  const [deliverables, setDeliverables] = useState<Record<string, string>>({});
  const [deliverablesLoading, setDeliverablesLoading] = useState<boolean>(true);

  // Voice self-test state
  const [voiceTestState, setVoiceTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [voiceTestNote, setVoiceTestNote] = useState<string>('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadSystemData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [healthRes, dbRes, treeRes] = await Promise.all([
        fetch('/healthz').then((r) => r.json()),
        fetch('/api/db/status').then((r) => r.json()),
        fetch('/api/ontology/tree').then((r) => r.json()),
      ]);
      setHealth(healthRes);
      setDbStatus(dbRes);
      setOntologySource(treeRes.source || 'in_memory_cte_parity');
      setTree(Array.isArray(treeRes.tree) ? treeRes.tree : []);
      setNodes(Array.isArray(treeRes.nodes) ? treeRes.nodes : []);
      setFeedbackLog(Array.isArray(treeRes.feedbackLog) ? treeRes.feedbackLog : []);
      if (treeRes.flywheel) setFlywheel(treeRes.flywheel);
    } catch {
      // Keep previous data on transient error
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadDeliverables = useCallback(async () => {
    setDeliverablesLoading(true);
    try {
      const data = await fetch('/api/deliverables').then((r) => r.json());
      if (data?.files) {
        setDeliverables(data.files);
      }
    } catch {
      // Leave empty if unavailable
    } finally {
      setDeliverablesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSystemData();
    void loadDeliverables();
  }, [loadSystemData, loadDeliverables]);

  const handleRunRagSearch = useCallback(
    async (queryVector: number[]): Promise<OntologyRagMatch[]> => {
      const resp = await fetch('/api/ontology/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queryVector,
          scaleAnchor,
          hasWebXRDepth,
          limit: 4,
        }),
      });
      const data = await resp.json();
      return Array.isArray(data.matches) ? data.matches : [];
    },
    [scaleAnchor, hasWebXRDepth]
  );

  const handleSubmitCorrection = useCallback(
    async (predictedId: number, correctedId: number, tag: string) => {
      const resp = await fetch('/api/ontology/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          predictedComponentId: predictedId,
          correctedComponentId: correctedId,
          tag,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.tree)) setTree(data.tree);
        if (Array.isArray(data.feedbackLog)) setFeedbackLog(data.feedbackLog);
        if (data.flywheel) setFlywheel(data.flywheel);
      }
    },
    []
  );

  const handleRecordDeflection = useCallback(async () => {
    const resp = await fetch('/api/ontology/deflection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ computeCostUsd: 1.45 }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.flywheel) setFlywheel(data.flywheel);
    }
  }, []);

  const handleTestDemoVoice = useCallback(async () => {
    setVoiceTestState('testing');
    setVoiceTestNote('Fetching cached Gemini TTS WAV...');
    try {
      const resp = await fetch('/api/demo-narration?cue=intro', {
        headers: { Accept: 'audio/wav' },
      });
      if (!resp.ok) {
        setVoiceTestState('error');
        setVoiceTestNote(`HTTP ${resp.status} — check GEMINI_API_KEY`);
        return;
      }
      const cacheState = resp.headers.get('x-demo-cache') || 'OK';
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play().catch(() => undefined);
      }
      setVoiceTestState('ok');
      setVoiceTestNote(
        `Played ${Math.round(blob.size / 1024)} KB WAV (Cache ${cacheState})`
      );
    } catch (err) {
      setVoiceTestState('error');
      setVoiceTestNote((err as Error).message || 'Voice test failed');
    }
  }, []);

  const handleLaunchQaTest = useCallback(
    (testCase: 1 | 2 | 3) => {
      if (testCase === 2) {
        setActiveTab('ontology');
      } else {
        onOpenCamera();
      }
    },
    [onOpenCamera]
  );

  const navTabs: Array<{ id: AdminTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'ontology', label: 'Ontology & RAG' },
    { id: 'architecture', label: 'Architecture' },
    { id: 'runbook', label: 'Runbook' },
  ];

  return (
    <div className="min-h-dvh w-full bg-[#F7F8FA] text-slate-900 overflow-y-auto">
      <audio ref={audioRef} playsInline className="hidden" aria-hidden="true" />

      {/* Strict 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3 sm:px-6 lg:px-8">
          {/* Zone 1: Brand Lockup */}
          <div className="flex items-center gap-2.5 shrink-0">
            <img
              src={JACK_OF_SPADES_LOGO_URL}
              alt="Jack of All Trades logo — Jack of Spades card holding a hammer"
              referrerPolicy="no-referrer"
              className="h-9 w-[27px] shrink-0 rounded-[4px] border border-slate-300 object-cover shadow-xs"
            />
            <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
              Jack of All Trades
            </span>
          </div>

          {/* Zone 2: 4 Clean Single-Line Nav Tabs */}
          <nav
            aria-label="Admin Platform Sections"
            className="hidden md:flex items-center gap-6 text-sm font-medium"
          >
            {navTabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`py-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                    active
                      ? 'border-slate-900 text-slate-950 font-semibold'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 Primary CTA */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={onOpenCamera}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to Camera
            </button>
          </div>
        </div>

        {/* Mobile Section Switcher */}
        <div className="flex md:hidden items-center gap-1 overflow-x-auto border-t border-slate-100 px-4 py-2">
          {navTabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={active ? 'page' : undefined}
                className={`min-h-[38px] rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content Container */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {/* Page Heading & Refresh Action */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-xs font-medium text-slate-500">
              Admin &amp; Operations Platform · AGPL-3.0-only
            </p>
            <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-950">
              {activeTab === 'overview' && 'System Overview & Management'}
              {activeTab === 'ontology' && 'PostgreSQL Ontology Graph & RAG'}
              {activeTab === 'architecture' && 'System Architecture & Source'}
              {activeTab === 'runbook' && 'Production Runbook & QA Matrix'}
            </h1>
          </div>

          <button
            type="button"
            onClick={() => void loadSystemData()}
            disabled={refreshing}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60 whitespace-nowrap cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {refreshing ? 'Refreshing...' : 'Refresh Live Status'}
          </button>
        </div>

        {/* TAB 1: SYSTEM OVERVIEW & MANAGEMENT */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* 4-Column Live Telemetry Strip */}
            <section aria-label="Live System Health" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-medium text-slate-500">Gemini 4 API Stack</p>
                <p className="mt-2 text-xl font-bold text-slate-900">
                  {health ? (health.geminiConfigured ? 'Connected' : 'Key Missing') : 'Checking...'}
                </p>
                <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                  Decisions Gate · Neon Vision/Voice · 3.8 TTS · Omni PiP
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-medium text-slate-500">Cloud SQL (PostgreSQL 16)</p>
                <p className="mt-2 text-xl font-bold text-slate-900">
                  {dbStatus
                    ? dbStatus.connected
                      ? 'Connected'
                      : dbStatus.configured
                        ? 'Parity Fallback'
                        : 'Not Configured'
                    : 'Checking...'}
                </p>
                <p className="mt-1.5 font-mono text-[11px] text-slate-600 truncate">
                  {health?.sqlTarget || 'InMemoryOntologyGraph parity'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-medium text-slate-500">Ontology Graph Nodes</p>
                <p className="mt-2 font-mono text-xl font-bold text-slate-900 tabular-nums">
                  {nodes.length} components
                </p>
                <p className="mt-1.5 text-xs text-slate-600">
                  {flywheel.totalCorrections} feedback updates · {ontologySource.replace(/_/g, ' ')}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-medium text-slate-500">B2B2C Return Deflections</p>
                <p className="mt-2 font-mono text-xl font-bold text-slate-900 tabular-nums">
                  ${flywheel.grossBountyRevenueUsd.toLocaleString()}
                </p>
                <p className="mt-1.5 text-xs text-slate-600 tabular-nums">
                  {flywheel.deflectedReturns} returns averted · {flywheel.marginMultiple}x margin
                </p>
              </div>
            </section>

            {/* Quick Management & Verification Controls */}
            <section
              aria-labelledby="quick-actions-heading"
              className="rounded-xl border border-slate-200 bg-white p-6"
            >
              <div className="border-b border-slate-100 pb-4">
                <h2 id="quick-actions-heading" className="text-lg font-semibold text-slate-900">
                  Management &amp; Verification Controls
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Launch user flows, test cached Gemini neural voice narration, or inspect live Cloud SQL and RAG state.
                </p>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <button
                  type="button"
                  onClick={onReplayDemo}
                  className="flex flex-col items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left hover:border-slate-300 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <RotateCcw className="h-4 w-4 text-slate-700" aria-hidden="true" />
                  <span className="text-sm font-semibold text-slate-900">
                    Replay Guided Demo
                  </span>
                  <span className="text-xs text-slate-600 leading-relaxed">
                    Reset onboarding and preview the narrated battery-latch walkthrough.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleTestDemoVoice()}
                  disabled={voiceTestState === 'testing'}
                  className="flex flex-col items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left hover:border-slate-300 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-60"
                >
                  <Volume2 className="h-4 w-4 text-amber-700" aria-hidden="true" />
                  <span className="text-sm font-semibold text-slate-900">
                    {voiceTestState === 'testing' ? 'Testing TTS Audio...' : 'Test Guided Voice TTS'}
                  </span>
                  <span className="text-xs text-slate-600 leading-relaxed">
                    {voiceTestNote || 'Play cached /api/demo-narration?cue=intro neural WAV.'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('ontology')}
                  className="flex flex-col items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left hover:border-slate-300 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <GitBranch className="h-4 w-4 text-slate-700" aria-hidden="true" />
                  <span className="text-sm font-semibold text-slate-900">
                    Manage Ontology &amp; RAG
                  </span>
                  <span className="text-xs text-slate-600 leading-relaxed">
                    Query Recursive CTEs, test Scale Guard, and apply M4/M6 corrections.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('architecture')}
                  className="flex flex-col items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left hover:border-slate-300 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <Layers className="h-4 w-4 text-slate-700" aria-hidden="true" />
                  <span className="text-sm font-semibold text-slate-900">
                    Inspect Architecture &amp; Code
                  </span>
                  <span className="text-xs text-slate-600 leading-relaxed">
                    Browse topology diagrams and download schema.sql, server.js, and Dockerfile.
                  </span>
                </button>
              </div>
            </section>

            {/* Cloud SQL Connection Details & Diagnostics */}
            <section
              aria-labelledby="cloudsql-details-heading"
              className="rounded-xl border border-slate-200 bg-white p-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <Database className="h-5 w-5 text-slate-700" aria-hidden="true" />
                  <h2 id="cloudsql-details-heading" className="text-lg font-semibold text-slate-900">
                    Cloud SQL &amp; Runtime Configuration
                  </h2>
                </div>
                <span className="font-mono text-xs text-slate-500">
                  Transport: {health?.databaseTransport || 'detecting'}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium text-slate-500">Instance Connection Name</dt>
                  <dd className="mt-1 font-mono text-xs text-slate-900 break-all">
                    {health?.sqlConnectionName || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Public IP / Port</dt>
                  <dd className="mt-1 font-mono text-xs text-slate-900 tabular-nums">
                    {health ? `${health.sqlPublicIp}:${health.sqlPort}` : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Outgoing IP · TLS</dt>
                  <dd className="mt-1 font-mono text-xs text-slate-900 tabular-nums">
                    {health
                      ? `${health.sqlOutgoingIp} · SSL ${health.sqlSslEnabled ? 'Enabled' : 'Disabled'}`
                      : '—'}
                  </dd>
                </div>
              </dl>

              {dbStatus && !dbStatus.connected && (dbStatus.error || dbStatus.message) && (
                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950 leading-relaxed">
                  <strong>Database Notice:</strong> {dbStatus.error || dbStatus.message} — The app automatically uses its in-memory Recursive CTE &amp; cosine RAG parity engine until Cloud SQL is reachable.
                </p>
              )}
            </section>

            {/* Backend API Directory */}
            <section
              aria-labelledby="api-directory-heading"
              className="rounded-xl border border-slate-200 bg-white overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
                <div className="flex items-center gap-2.5">
                  <Server className="h-5 w-5 text-slate-700" aria-hidden="true" />
                  <h2 id="api-directory-heading" className="text-lg font-semibold text-slate-900">
                    Active Backend Endpoints
                  </h2>
                </div>
                <span className="text-xs text-slate-500 tabular-nums">
                  {API_ENDPOINTS.length} routes
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-6 py-3 font-semibold">Method</th>
                      <th className="px-4 py-3 font-semibold">Route</th>
                      <th className="px-4 py-3 font-semibold">Backing Engine</th>
                      <th className="px-6 py-3 font-semibold">Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {API_ENDPOINTS.map((ep) => (
                      <tr key={`${ep.method}-${ep.path}`} className="hover:bg-slate-50/70">
                        <td className="px-6 py-3 font-mono font-semibold text-slate-900">
                          {ep.method}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-800 whitespace-nowrap">
                          {ep.path}
                        </td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                          {ep.service}
                        </td>
                        <td className="px-6 py-3 text-slate-600">{ep.purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: ONTOLOGY & RAG MANAGER */}
        {activeTab === 'ontology' && (
          <div className="space-y-6">
            {/* Scale Anchor Simulation Controls for Testing Break 2 Guard */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Scale Anchor Guard Tester (Break 2)
                </p>
                <p className="text-xs text-slate-600">
                  Toggle a physical scale anchor or WebXR depth to verify exact tool-size redaction in live RAG search.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    { id: 'none', label: 'No Anchor (Guard Active)' },
                    { id: 'us_quarter', label: 'US Quarter' },
                    { id: 'credit_card', label: 'Credit Card' },
                    { id: 'human_thumb', label: 'Human Thumb' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setScaleAnchor(opt.id);
                      if (opt.id === 'none') setHasWebXRDepth(false);
                    }}
                    className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      scaleAnchor === opt.id && !hasWebXRDepth
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setHasWebXRDepth((prev) => !prev)}
                  className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    hasWebXRDepth
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {hasWebXRDepth ? 'WebXR Depth: On' : 'WebXR Depth: Off'}
                </button>
              </div>
            </div>

            <OntologyExplorer
              sourceLabel={ontologySource}
              tree={tree}
              nodes={nodes}
              feedbackLog={feedbackLog}
              flywheel={flywheel}
              scaleAnchor={scaleAnchor}
              hasWebXRDepth={hasWebXRDepth}
              onRunRagSearch={handleRunRagSearch}
              onSubmitCorrection={handleSubmitCorrection}
              onRecordDeflection={handleRecordDeflection}
            />
          </div>
        )}

        {/* TAB 3: ARCHITECTURE & SOURCE EXPLORER */}
        {activeTab === 'architecture' && (
          <ArchitectureBlueprint
            deliverables={deliverables}
            loading={deliverablesLoading}
          />
        )}

        {/* TAB 4: OPERATIONS RUNBOOK & QA MATRIX */}
        {activeTab === 'runbook' && (
          <RunbookView
            runbookMarkdown={
              deliverables['docs/RUNBOOK.md'] ||
              (deliverablesLoading ? 'Loading RUNBOOK.md...' : 'Runbook unavailable.')
            }
            onLaunchQaTest={handleLaunchQaTest}
          />
        )}
      </div>

      {/* Quiet AGPL-3.0 Footer */}
      <footer className="mt-10 border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 text-xs text-slate-500 sm:px-6 lg:px-8">
          <span>Jack of All Trades · Open-Source AGPL-3.0-only</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveTab('architecture')}
              className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
            >
              <Play className="h-3 w-3" aria-hidden="true" />
              Corresponding Source
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('runbook')}
              className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
            >
              <BookOpen className="h-3 w-3" aria-hidden="true" />
              Operations Runbook
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
