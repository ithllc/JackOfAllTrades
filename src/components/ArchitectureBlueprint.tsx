/**
 * JackOfAllTrades — Interactive Architecture Topology & AGPL-3.0 Deliverable Explorer
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Displays the visual system architecture diagram (matching docs/ARCHITECTURE.md MermaidJS)
 * and lets engineers inspect, copy, or download the exact generated foundational files:
 * schema.sql, server.ts, server.js, App.jsx, Dockerfile, docs/ARCHITECTURE.md, docs/RUNBOOK.md, and LICENSE.
 */

import React, { useState } from 'react';
import { Check, Copy, Download, FileCode2, RefreshCw } from 'lucide-react';

interface ArchitectureBlueprintProps {
  deliverables: Record<string, string>;
  loading: boolean;
  onRetry?: () => void;
}

const FILE_TABS = [
  { key: 'schema.sql', label: 'schema.sql' },
  { key: 'server.ts', label: 'server.ts (Source)' },
  { key: 'server.js', label: 'server.js (Bundle)' },
  { key: 'App.jsx', label: 'App.jsx' },
  { key: 'Dockerfile', label: 'Dockerfile' },
  { key: 'docs/ARCHITECTURE.md', label: 'ARCHITECTURE.md' },
  { key: 'docs/RUNBOOK.md', label: 'RUNBOOK.md' },
  { key: 'LICENSE', label: 'LICENSE (AGPL-3.0)' },
];

async function copyTextSafe(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback inside sandboxed iframes
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export const ArchitectureBlueprint: React.FC<ArchitectureBlueprintProps> = ({
  deliverables,
  loading,
  onRetry,
}) => {
  const [activeFile, setActiveFile] = useState<string>('schema.sql');
  const [copied, setCopied] = useState(false);

  const rawContent = deliverables[activeFile] || '';
  const hasContent = rawContent.trim().length > 0;
  const displayContent = hasContent
    ? rawContent
    : loading
      ? `Loading ${activeFile}...`
      : `Source file "${activeFile}" was not returned by /api/deliverables. Click Reload Files or redeploy the unified server.js container.`;

  const handleCopy = async () => {
    if (!hasContent) return;
    const ok = await copyTextSafe(rawContent);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleDownload = () => {
    if (!hasContent) return;
    const blob = new Blob([rawContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.split('/').pop() || 'file.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-8">
      {/* Visual System Architecture Diagram */}
      <section aria-labelledby="arch-topology-heading" className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-4">
          <div>
            <h2 id="arch-topology-heading" className="text-xl font-semibold text-slate-900">
              System Architecture &amp; Self-Learning Repair Pipeline
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              ADR 001 (PostgreSQL Recursive CTE + pgvector) · ADR 002 (Cloud Run Unified server.js) · ADR 005–007 (Multi-Step AR + Per-Step PiP + Live Flywheel)
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500">AGPL-3.0-only</span>
        </div>

        {/* Crisp Architectural SVG Pipeline */}
        <div className="mt-5 overflow-x-auto">
          <svg
            viewBox="0 0 1080 310"
            className="w-full min-w-[760px] h-auto"
            role="img"
            aria-label="JackOfAllTrades end-to-end architecture diagram from PWA camera, Scale Ratio AR Overlay, and Multi-Step Per-Step PiP through Cloud Run unified Express server to Gemini 4 and Cloud SQL PostgreSQL pgvector"
          >
            {/* Column 1: PWA Client */}
            <rect x="16" y="20" width="230" height="270" rx="10" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1.5" />
            <text x="32" y="46" fill="#0F172A" fontSize="13" fontWeight="700" fontFamily="Plus Jakarta Sans, sans-serif">
              1. Universal PWA Client
            </text>
            <rect x="32" y="64" width="198" height="46" rx="6" fill="#FFFFFF" stroke="#E2E8F0" />
            <text x="44" y="84" fill="#0F172A" fontSize="11.5" fontWeight="600">Scan + Hold-to-Explain</text>
            <text x="44" y="100" fill="#475569" fontSize="10.5" fontFamily="JetBrains Mono, monospace">Camera + Push-to-Talk WAV</text>

            <rect x="32" y="122" width="198" height="46" rx="6" fill="#FFFBEB" stroke="#FCD34D" />
            <text x="44" y="142" fill="#92400E" fontSize="11.5" fontWeight="600">Scale Ratio Anchor Guard</text>
            <text x="44" y="158" fill="#B45309" fontSize="9.5" fontFamily="JetBrains Mono, monospace">24.26mm Coin · Card · Thumb</text>

            <rect x="32" y="180" width="198" height="46" rx="6" fill="#FFFFFF" stroke="#E2E8F0" />
            <text x="44" y="200" fill="#0F172A" fontSize="11.5" fontWeight="600">Spatial AR Repair Overlay</text>
            <text x="44" y="216" fill="#475569" fontSize="10.5" fontFamily="JetBrains Mono, monospace">Reticle + SVG Motion Cues</text>

            <rect x="32" y="236" width="198" height="40" rx="6" fill="#0D1117" />
            <text x="44" y="260" fill="#F8FAFC" fontSize="11" fontWeight="600">Per-Step PiP Cache + Fix/Edit</text>

            {/* Arrow 1 -> 2 */}
            <path d="M246 145 L292 145" stroke="#64748B" strokeWidth="2" markerEnd="url(#arrow)" />
            <text x="269" y="134" textAnchor="middle" fill="#475569" fontSize="10" fontFamily="JetBrains Mono, monospace">JSON</text>

            {/* Column 2: Cloud Run Express */}
            <rect x="296" y="20" width="224" height="270" rx="10" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1.5" />
            <text x="312" y="46" fill="#0F172A" fontSize="13" fontWeight="700" fontFamily="Plus Jakarta Sans, sans-serif">
              2. Cloud Run (Unified)
            </text>
            <rect x="312" y="64" width="192" height="58" rx="6" fill="#FFFFFF" stroke="#E2E8F0" />
            <text x="324" y="83" fill="#0F172A" fontSize="11.5" fontWeight="600">/api/analyze-buffer</text>
            <text x="324" y="98" fill="#0F172A" fontSize="11.5" fontWeight="600">/api/voice-assist</text>
            <text x="324" y="113" fill="#475569" fontSize="10" fontFamily="JetBrains Mono, monospace">Unified Scale + Multi-Step</text>

            <rect x="312" y="134" width="192" height="46" rx="6" fill="#FFFFFF" stroke="#E2E8F0" />
            <text x="324" y="154" fill="#0F172A" fontSize="11.5" fontWeight="600">/api/generate-pip</text>
            <text x="324" y="170" fill="#475569" fontSize="10.5" fontFamily="JetBrains Mono, monospace">On-demand Step N clip (6s)</text>

            <rect x="312" y="192" width="192" height="46" rx="6" fill="#ECFDF5" stroke="#6EE7B7" />
            <text x="324" y="211" fill="#065F46" fontSize="11.5" fontWeight="600">/api/ontology/confirm-fix</text>
            <text x="324" y="227" fill="#047857" fontSize="10.5" fontFamily="JetBrains Mono, monospace">+ /feedback + /tree (SQL)</text>

            <rect x="312" y="246" width="192" height="30" rx="6" fill="#F1F5F9" stroke="#CBD5E1" />
            <text x="324" y="265" fill="#334155" fontSize="9.5" fontFamily="JetBrains Mono, monospace">/api/health · /deliverables</text>

            {/* Arrow 2 -> 3 */}
            <path d="M520 94 L566 84" stroke="#D97706" strokeWidth="2" markerEnd="url(#arrow-amber)" />
            <path d="M520 158 L566 158" stroke="#1D4ED8" strokeWidth="2" markerEnd="url(#arrow-blue)" />
            <path d="M520 214 L566 232" stroke="#64748B" strokeWidth="2" markerEnd="url(#arrow)" />

            {/* Column 3: Gemini 4 Stack */}
            <rect x="570" y="20" width="234" height="270" rx="10" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1.5" />
            <text x="586" y="46" fill="#0F172A" fontSize="13" fontWeight="700" fontFamily="Plus Jakarta Sans, sans-serif">
              3. Gemini 4 Model Stack
            </text>
            <rect x="586" y="62" width="202" height="58" rx="6" fill="#FFFBEB" stroke="#F59E0B" />
            <text x="598" y="82" fill="#92400E" fontSize="11.5" fontWeight="700">The Router: gemini-decision-1</text>
            <text x="598" y="98" fill="#B45309" fontSize="10.5" fontFamily="JetBrains Mono, monospace">v1beta Decisions · 0 tokens</text>
            <text x="598" y="112" fill="#B45309" fontSize="10.5" fontFamily="JetBrains Mono, monospace">stalled / hazard / noise</text>

            <rect x="586" y="132" width="202" height="58" rx="6" fill="#EFF6FF" stroke="#3B82F6" />
            <text x="598" y="152" fill="#1E3A8A" fontSize="11.5" fontWeight="700">The Brain: gemini-4-neon</text>
            <text x="598" y="168" fill="#1D4ED8" fontSize="10.5" fontFamily="JetBrains Mono, monospace">targetBox + anchorBox (mm)</text>
            <text x="598" y="182" fill="#1D4ED8" fontSize="10.5" fontFamily="JetBrains Mono, monospace">Multi-step + Ontology RAG</text>

            <rect x="586" y="202" width="202" height="72" rx="6" fill="#FFFFFF" stroke="#CBD5E1" />
            <text x="598" y="220" fill="#0F172A" fontSize="11.5" fontWeight="700">Video, Voice &amp; Vectors</text>
            <text x="598" y="236" fill="#334155" fontSize="10" fontFamily="JetBrains Mono, monospace">gemini-omni-1.2-flash (PiP)</text>
            <text x="598" y="250" fill="#334155" fontSize="10" fontFamily="JetBrains Mono, monospace">gemini-3.8-flash-lite-tts</text>
            <text x="598" y="264" fill="#334155" fontSize="10" fontFamily="JetBrains Mono, monospace">gemini-embedding-2 (768d)</text>

            {/* Arrow 3 -> 4 */}
            <path d="M804 160 L844 160" stroke="#1D4ED8" strokeWidth="2" markerEnd="url(#arrow-blue)" />

            {/* Column 4: Cloud SQL PostgreSQL */}
            <rect x="848" y="20" width="216" height="270" rx="10" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1.5" />
            <text x="864" y="46" fill="#0F172A" fontSize="13" fontWeight="700" fontFamily="Plus Jakarta Sans, sans-serif">
              4. Cloud SQL PostgreSQL
            </text>
            <rect x="864" y="64" width="184" height="62" rx="6" fill="#FFFFFF" stroke="#E2E8F0" />
            <text x="876" y="84" fill="#0F172A" fontSize="11.5" fontWeight="600">components + pgvector</text>
            <text x="876" y="100" fill="#475569" fontSize="10.5" fontFamily="JetBrains Mono, monospace">WITH RECURSIVE CTE</text>
            <text x="876" y="114" fill="#475569" fontSize="10.5" fontFamily="JetBrains Mono, monospace">Auto-learned parts &lt;=&gt;</text>

            <rect x="864" y="138" width="184" height="58" rx="6" fill="#FFFFFF" stroke="#E2E8F0" />
            <text x="876" y="158" fill="#0F172A" fontSize="11.5" fontWeight="600">diagnostic_sessions</text>
            <text x="876" y="174" fill="#475569" fontSize="10.5" fontFamily="JetBrains Mono, monospace">Every Scan + Voice logged</text>
            <text x="876" y="188" fill="#475569" fontSize="10.5" fontFamily="JetBrains Mono, monospace">success_rate live updates</text>

            <rect x="864" y="208" width="184" height="66" rx="6" fill="#ECFDF5" stroke="#6EE7B7" />
            <text x="876" y="228" fill="#065F46" fontSize="11.5" fontWeight="600">deflection_bounties</text>
            <text x="876" y="244" fill="#047857" fontSize="10.5" fontFamily="JetBrains Mono, monospace">$30 confirmed-fix ledger</text>
            <text x="876" y="260" fill="#047857" fontSize="10.5" fontFamily="JetBrains Mono, monospace">3x+ margin over compute</text>

            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#64748B" />
              </marker>
              <marker id="arrow-amber" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#D97706" />
              </marker>
              <marker id="arrow-blue" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#1D4ED8" />
              </marker>
            </defs>
          </svg>
        </div>
      </section>

      {/* Foundational Codebase Deliverable Inspector */}
      <section aria-labelledby="code-deliverables-heading" className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <FileCode2 className="h-4 w-4 text-slate-600" aria-hidden="true" />
            <h3 id="code-deliverables-heading" className="text-sm font-semibold text-slate-900">
              Foundational Codebase Deliverables (AGPL-3.0 Corresponding Source)
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {!hasContent && !loading && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Reload Files
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!hasContent}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy File'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!hasContent}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Download
            </button>
          </div>
        </div>

        {/* File Selector Tabs */}
        <div
          role="tablist"
          aria-label="Codebase files"
          className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2"
        >
          {FILE_TABS.map((tab) => {
            const isSelected = activeFile === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => {
                  setActiveFile(tab.key);
                  setCopied(false);
                }}
                className={`min-h-[36px] rounded-md px-3 py-1.5 font-mono text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-slate-900 text-white font-medium'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <pre
          data-testid="deliverable-code-viewer"
          className="max-h-[540px] overflow-auto bg-[#0D1117] p-5 font-mono text-xs leading-relaxed text-slate-200"
        >
          <code>{displayContent}</code>
        </pre>
      </section>
    </div>
  );
};
