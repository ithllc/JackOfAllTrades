/**
 * JackOfAllTrades — Production Operations Runbook & QA Verification Matrix
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 */

import React from 'react';
import { ArrowUpRight, CheckCircle2, ShieldCheck, Terminal } from 'lucide-react';

interface RunbookViewProps {
  runbookMarkdown: string;
  onLaunchQaTest: (testCase: 1 | 2 | 3) => void;
}

export const RunbookView: React.FC<RunbookViewProps> = ({
  runbookMarkdown,
  onLaunchQaTest,
}) => {
  return (
    <div className="space-y-8">
      {/* Interactive QA Test Cases Launcher (PRD Technical Doc §3) */}
      <section aria-labelledby="qa-matrix-heading" className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="border-b border-slate-100 pb-4">
          <h2 id="qa-matrix-heading" className="text-xl font-semibold text-slate-900">
            Quality Assurance Verification Matrix (Test Cases 1–3)
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Jump straight into Live Bench preconfigured to exercise each acceptance scenario from the Technical Implementation Document.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="font-mono text-xs font-medium text-amber-700">Test Case 1</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-900">Adaptive 3G Degradation</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                Simulates 3G / high latency (&gt;350ms RTT) and chrome glare. Drops continuous video and switches to 3-shot high-contrast burst capture with voice prompt.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onLaunchQaTest(1)}
              className="mt-4 inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 hover:bg-slate-100"
            >
              Launch Test Case 1
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="font-mono text-xs font-medium text-blue-700">Test Case 2</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-900">Ontology M4/M6 Feedback Loop</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                Loads the M4 screw misidentified as M6. Tap the bounding box, correct to M4, and verify immediate RAG retrieval update.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onLaunchQaTest(2)}
              className="mt-4 inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 hover:bg-slate-100"
            >
              Launch Test Case 2
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="font-mono text-xs font-medium text-emerald-700">Test Case 3</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-900">Decisions API → Neon Routing</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                Holds hands stationary for 3+ seconds to trigger the Wasm hesitation gate, sending the 15-second ring buffer to gemini-decision-1.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onLaunchQaTest(3)}
              className="mt-4 inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 hover:bg-slate-100"
            >
              Launch Test Case 3
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      {/* Cloud Run & Cloud SQL Deployment Commands */}
      <section aria-labelledby="deploy-runbook-heading" className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-8">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Terminal className="h-4 w-4 text-slate-700" aria-hidden="true" />
            <h3 id="deploy-runbook-heading" className="text-base font-semibold text-slate-900">
              Operations Runbook (docs/RUNBOOK.md)
            </h3>
          </div>
          <pre className="mt-4 max-h-[520px] overflow-auto rounded-lg bg-[#0D1117] p-4 font-mono text-xs leading-relaxed text-slate-200 whitespace-pre-wrap">
            {runbookMarkdown || 'Loading docs/RUNBOOK.md...'}
          </pre>
        </div>

        <aside className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <ShieldCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            <h3 className="text-base font-semibold text-slate-900">AGPL-3.0 &amp; Safety Invariants</h3>
          </div>
          <ul className="space-y-3 text-xs leading-relaxed text-slate-600">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
              <span>
                <strong className="text-slate-900">AGPL-3.0 Section 13:</strong> Full Corresponding Source is exposed via <code className="text-slate-800">/api/deliverables</code> and the Architecture tab for every hosted Cloud Run revision.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
              <span>
                <strong className="text-slate-900">Server-Side Key Isolation:</strong> <code className="text-slate-800">GEMINI_API_KEY</code> is strictly consumed inside Express on Cloud Run and never shipped to browser bundles.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
              <span>
                <strong className="text-slate-900">Break 1 Thermal Ceiling:</strong> Client-side Wasm stillness gating suppresses continuous heavy-model video uploads until ≥3.0s hesitation.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
              <span>
                <strong className="text-slate-900">Break 2 Scale Anchor Gate:</strong> Exact metric/imperial tool specs are redacted both in SQL (<code className="text-slate-800">rag_search_ontology_subgraph</code>) and Express unless WebXR depth or a coin/card/thumb anchor is verified.
              </span>
            </li>
          </ul>
        </aside>
      </section>
    </div>
  );
};
