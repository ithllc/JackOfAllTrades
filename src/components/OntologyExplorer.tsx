/**
 * JackOfAllTrades — PostgreSQL Recursive CTE & pgvector Ontology Explorer
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Visualizes ADR 001 (Recursive CTE tree traversal + pgvector RAG search),
 * PRD §2 (Test Case 2 M4 vs M6 correction feedback loop), Break 2 (Scale Anchor
 * tool-size redaction), and PRD §3 ($30 B2B2C Return Deflection Flywheel).
 */

import React, { useState } from 'react';
import { CheckCircle2, ChevronRight, DollarSign, GitBranch, Search, ShieldAlert } from 'lucide-react';
import type {
  OntologyComponentNode,
  OntologyFeedbackRecord,
  OntologyHierarchyRow,
  OntologyRagMatch,
  ScaleAnchorType,
} from '../lib/routingLogic';

export interface FlywheelMetrics {
  deflectedReturns: number;
  bountyPerDeflectionUsd: number;
  grossBountyRevenueUsd: number;
  totalComputeUsd: number;
  marginMultiple: number;
  totalCorrections: number;
}

interface OntologyExplorerProps {
  sourceLabel: string;
  tree: OntologyHierarchyRow[];
  nodes: OntologyComponentNode[];
  feedbackLog: OntologyFeedbackRecord[];
  flywheel: FlywheelMetrics;
  scaleAnchor: ScaleAnchorType;
  hasWebXRDepth: boolean;
  onRunRagSearch: (queryVector: number[]) => Promise<OntologyRagMatch[]>;
  onSubmitCorrection: (predictedId: number, correctedId: number, tag: string) => Promise<void>;
  onRecordDeflection: () => Promise<void>;
}

const TEST_CASE_2_VECTOR = [0.14, 0.16, 0.87, 0.43, 0.10, 0.07, 0.06, 0.09];

export const OntologyExplorer: React.FC<OntologyExplorerProps> = ({
  sourceLabel,
  tree,
  nodes,
  feedbackLog,
  flywheel,
  scaleAnchor,
  hasWebXRDepth,
  onRunRagSearch,
  onSubmitCorrection,
  onRecordDeflection,
}) => {
  const [ragMatches, setRagMatches] = useState<OntologyRagMatch[]>([]);
  const [ragLoading, setRagLoading] = useState(false);
  const [selectedPredictedId, setSelectedPredictedId] = useState<number>(4); // M6
  const [selectedCorrectedId, setSelectedCorrectedId] = useState<number>(3); // M4
  const [correctionTag, setCorrectionTag] = useState<string>('M4_not_M6');
  const [submitting, setSubmitting] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  const handleRunTestScan = async () => {
    setRagLoading(true);
    try {
      const results = await onRunRagSearch(TEST_CASE_2_VECTOR);
      setRagMatches(results);
    } finally {
      setRagLoading(false);
    }
  };

  const handleApplyCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedbackNotice(null);
    try {
      await onSubmitCorrection(selectedPredictedId, selectedCorrectedId, correctionTag.trim() || 'user_correction');
      const updatedResults = await onRunRagSearch(TEST_CASE_2_VECTOR);
      setRagMatches(updatedResults);
      setFeedbackNotice(
        'Ontology embedding centroid updated. Re-ran vector RAG scan immediately — top match reflects the correction.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Row: B2B2C Revenue & Data Flywheel Metrics (PRD §3) */}
      <section aria-labelledby="flywheel-heading">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 id="flywheel-heading" className="text-xl font-semibold text-slate-900">
              Physical Interaction Ontology &amp; B2B2C Flywheel
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              PostgreSQL Recursive CTE hierarchy · pgvector 768-dim RAG · Storage mode:{' '}
              <span className="font-mono text-slate-800">{sourceLabel}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onRecordDeflection()}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap"
          >
            <DollarSign className="h-3.5 w-3.5" aria-hidden="true" />
            Log Deflected Return (+$30 Bounty)
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Deflected Returns</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {flywheel.deflectedReturns}
            </p>
            <p className="mt-1 text-xs text-slate-500">$30 brand bounty / session</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Gross Bounty Revenue</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              ${flywheel.grossBountyRevenueUsd.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              vs ${flywheel.totalComputeUsd.toFixed(2)} Gemini + Cloud Run
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Compute Margin Multiple</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
              {flywheel.marginMultiple}x
            </p>
            <p className="mt-1 text-xs text-slate-500">Target ≥ 3.0x return deflection</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Fleet Graph Corrections</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {flywheel.totalCorrections}
            </p>
            <p className="mt-1 text-xs text-slate-500">Zero-epoch instant RAG updates</p>
          </div>
        </div>
      </section>

      {/* Main Split: Recursive CTE Tree (Left) + Test Case 2 Vector RAG Lab (Right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Recursive CTE Component Hierarchy */}
        <section
          aria-labelledby="cte-tree-heading"
          className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-slate-600" aria-hidden="true" />
              <h3 id="cte-tree-heading" className="text-base font-semibold text-slate-900">
                Recursive CTE Component Hierarchy
              </h3>
            </div>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {tree.length} nodes · v_component_hierarchy
            </span>
          </div>

          <div className="mt-3 divide-y divide-slate-100">
            {tree.map((row) => (
              <div
                key={row.id}
                style={{ paddingLeft: `${row.depth * 22}px` }}
                className="py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {row.depth > 0 && (
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                    )}
                    <span className="text-sm font-semibold text-slate-900">{row.name}</span>
                    <span className="font-mono text-xs text-slate-500">#{row.id}</span>
                  </div>
                  <div className="font-mono text-xs text-slate-600 tabular-nums">
                    {(row.successRate * 100).toFixed(1)}% success · {row.correctionCount} updates
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  {row.componentClass} · Tool: <span className="font-medium text-slate-800">{row.toolRequired}</span>
                  {' · '}
                  {row.requiresScaleAnchor && !hasWebXRDepth && scaleAnchor === 'none' ? (
                    <span className="text-amber-700">Size gated (needs scale anchor)</span>
                  ) : (
                    <span className="font-mono text-slate-700">{row.toolSizeSpec}</span>
                  )}
                </p>
                {row.failurePrecursorCue && (
                  <p className="mt-1 text-xs text-slate-500">
                    Failure precursor: {row.failurePrecursorCue}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Test Case 2: Interactive Vector RAG & Correction Feedback Loop */}
        <section
          aria-labelledby="rag-lab-heading"
          className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5"
        >
          <div className="border-b border-slate-100 pb-3">
            <h3 id="rag-lab-heading" className="text-base font-semibold text-slate-900">
              Test Case 2: Vector RAG &amp; Feedback Updater
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Query the cosine similarity index for an ambiguous fastener scan, apply a touchscreen
              correction (e.g., M6 → M4), and verify the next scan resolves to M4 immediately.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-xs text-slate-600">
              Scale anchor:{' '}
              <strong className="text-slate-900">
                {hasWebXRDepth ? 'WebXR Depth' : scaleAnchor}
              </strong>
            </span>
            <button
              type="button"
              onClick={() => void handleRunTestScan()}
              disabled={ragLoading}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              {ragLoading ? 'Querying pgvector...' : 'Run Fastener RAG Scan'}
            </button>
          </div>

          {ragMatches.length > 0 && (
            <div className="space-y-2.5" data-testid="rag-results">
              {ragMatches.map((m, idx) => (
                <div
                  key={m.component.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">
                      {idx + 1}. {m.component.name}
                    </span>
                    <span className="font-mono font-medium text-blue-700 tabular-nums">
                      cos {(m.similarity * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="mt-1 text-slate-500">{m.ancestryPath}</p>
                  <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px]">
                    {m.scaleGatedAdvice.scaleGuardBlocked ? (
                      <>
                        <ShieldAlert className="h-3.5 w-3.5 text-amber-600 shrink-0" aria-hidden="true" />
                        <span className="text-amber-800">{m.scaleGatedAdvice.toolSizeSpec}</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
                        <span className="text-emerald-800">{m.scaleGatedAdvice.toolSizeSpec}</span>
                      </>
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Correction Form */}
          <form onSubmit={(e) => void handleApplyCorrection(e)} className="space-y-3 border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-slate-900">Submit Component Correction</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="predicted-comp" className="block text-xs text-slate-600">
                  AI Predicted
                </label>
                <select
                  id="predicted-comp"
                  value={selectedPredictedId}
                  onChange={(e) => setSelectedPredictedId(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900"
                >
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      #{n.id} {n.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="corrected-comp" className="block text-xs text-slate-600">
                  User Corrected To
                </label>
                <select
                  id="corrected-comp"
                  value={selectedCorrectedId}
                  onChange={(e) => setSelectedCorrectedId(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900"
                >
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      #{n.id} {n.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="correction-tag" className="block text-xs text-slate-600">
                Correction Tag
              </label>
              <input
                id="correction-tag"
                type="text"
                value={correctionTag}
                onChange={(e) => setCorrectionTag(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="min-h-[42px] w-full rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
            >
              {submitting ? 'Updating pgvector Centroid...' : 'Update Ontology Graph & Re-Scan'}
            </button>

            {feedbackNotice && (
              <p role="status" className="text-xs leading-relaxed text-emerald-800">
                {feedbackNotice}
              </p>
            )}
          </form>

          {/* Recent Feedback Events */}
          {feedbackLog.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold text-slate-900">Recent Fleet Updates</p>
              <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
                {feedbackLog.slice(0, 4).map((ev) => (
                  <li key={ev.id} className="font-mono text-[11px]">
                    {ev.predictedName} → <strong className="text-slate-900">{ev.correctedName}</strong> ({ev.tag} · {ev.regionCode})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
