/**
 * JackOfAllTrades — Production Operations Runbook & QA Verification Matrix
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 */

import React, { useState } from 'react';
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

interface RunbookViewProps {
  runbookMarkdown: string;
  loading?: boolean;
  onRetry?: () => void;
  onLaunchQaTest: (testCase: 1 | 2 | 3) => void;
}

async function copyRunbookSafe(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for sandboxed iframes
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

export const RunbookView: React.FC<RunbookViewProps> = ({
  runbookMarkdown,
  loading = false,
  onRetry,
  onLaunchQaTest,
}) => {
  const [copied, setCopied] = useState(false);

  const hasContent =
    Boolean(runbookMarkdown) &&
    runbookMarkdown.trim().length > 0 &&
    !runbookMarkdown.startsWith('Loading ');

  const displayText = hasContent
    ? runbookMarkdown
    : loading
      ? 'Loading docs/RUNBOOK.md...'
      : 'docs/RUNBOOK.md could not be loaded from /api/deliverables. Click Reload or redeploy the unified server.js container.';

  const handleCopy = async () => {
    if (!hasContent) return;
    const ok = await copyRunbookSafe(runbookMarkdown);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleDownload = () => {
    if (!hasContent) return;
    const blob = new Blob([runbookMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'RUNBOOK.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-8">
      {/* Interactive QA Test Cases Launcher (PRD Technical Doc §3) */}
      <section aria-labelledby="qa-matrix-heading" className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="border-b border-slate-100 pb-4">
          <h2 id="qa-matrix-heading" className="text-xl font-semibold text-slate-900">
            Quality Assurance Verification Matrix (Test Cases 1–3)
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Jump straight into Live Camera or Ontology Manager to exercise each acceptance scenario from the Technical Implementation Document.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="font-mono text-xs font-medium text-amber-700">Test Case 1</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-900">Scale Anchor &amp; Spatial AR</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                Place a quarter (24.26 mm), credit card, or thumb beside a part during Scan Problem or Hold to Explain and verify exact millimeter comparison + live AR overlay.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onLaunchQaTest(1)}
              className="mt-4 inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 hover:bg-slate-100 cursor-pointer"
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
                Inspect live Cloud SQL Recursive CTE nodes, correct a misidentified part via Ontology Feedback, and verify immediate pgvector RAG retrieval update.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onLaunchQaTest(2)}
              className="mt-4 inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 hover:bg-slate-100 cursor-pointer"
            >
              Launch Test Case 2
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="font-mono text-xs font-medium text-emerald-700">Test Case 3</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-900">Multi-Step Per-Step PiP &amp; Confirm Fix</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                Walk through a multi-step fix, generate an on-demand Step N motion clip, pin it over the AR overlay, and click Done — This Fixed It to record a Cloud SQL deflection.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onLaunchQaTest(3)}
              className="mt-4 inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 hover:bg-slate-100 cursor-pointer"
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-slate-700" aria-hidden="true" />
              <h3 id="deploy-runbook-heading" className="text-base font-semibold text-slate-900">
                Operations Runbook (docs/RUNBOOK.md)
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {!hasContent && !loading && onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reload
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleCopy()}
                disabled={!hasContent}
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={!hasContent}
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Download
              </button>
            </div>
          </div>
          <pre
            data-testid="runbook-markdown-viewer"
            className="mt-4 max-h-[540px] overflow-auto rounded-lg bg-[#0D1117] p-4 font-mono text-xs leading-relaxed text-slate-200 whitespace-pre-wrap"
          >
            {displayText}
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
                <strong className="text-slate-900">Server-Side Key Isolation:</strong> <code className="text-slate-800">GEMINI_API_KEY</code> and Cloud SQL credentials stay strictly inside Cloud Run runtime environment variables.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
              <span>
                <strong className="text-slate-900">Per-Step PiP Efficiency:</strong> Multi-step repairs generate 6-second <code className="text-slate-800">gemini-omni-1.2-flash</code> clips strictly on demand per step and cache them locally.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
              <span>
                <strong className="text-slate-900">Break 2 Scale Anchor Gate:</strong> Exact metric/imperial tool sizes are unlocked only when a known-size reference object (24.26 mm quarter, 85.6 mm card, 20 mm thumb) or WebXR depth is verified.
              </span>
            </li>
          </ul>
        </aside>
      </section>
    </div>
  );
};
