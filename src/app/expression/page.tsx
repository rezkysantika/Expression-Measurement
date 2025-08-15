"use client";

import { useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  expressionLabels,
  expressionColors,
  type ExpressionKey,
} from "../../lib/expression";

type EmotionItem = { name: string; confidence: number; color: string };
type TranscriptItem = { speaker?: string; text?: string; start?: number };
type JobStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "UNKNOWN" | "RESULTS_READY";

function secondsToClock(s?: number) {
  if (typeof s !== "number" || Number.isNaN(s)) return "00:00:00";
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

function normConfidence(v: any): number {
  if (typeof v !== "number" || Number.isNaN(v)) return 0;
  return v > 1 ? Math.min(1, v / 100) : Math.max(0, Math.min(1, v));
}
function colorForFallback(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 70%, 60%)`;
}
function toExpressionKey(name: string): ExpressionKey | undefined {
  const cleaned = name
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return undefined;

  const parts = cleaned.split(" ");
  const camel = parts[0] + parts.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return (camel as ExpressionKey) in expressionLabels ? (camel as ExpressionKey) : undefined;
}

function StatusChip({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, string> = {
    QUEUED: "bg-yellow-100 text-yellow-800 border-yellow-300",
    IN_PROGRESS: "bg-blue-100 text-blue-800 border-blue-300",
    COMPLETED: "bg-emerald-100 text-emerald-800 border-emerald-300",
    FAILED: "bg-rose-100 text-rose-800 border-rose-300",
    UNKNOWN: "bg-gray-100 text-gray-800 border-gray-300",
    RESULTS_READY: "bg-emerald-100 text-emerald-800 border-emerald-300",
  };
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${map[status]}`}>
      <span className="inline-block h-2 w-2 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

function ConfidenceBar({ value, color }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="w-full h-2 rounded-full bg-gray-200">
      <div
        className="h-2 rounded-full"
        style={{ width: `${pct}%`, background: color || "#9CA3AF" }}
      />
    </div>
  );
}


function asTopLevelItems(payload: any): any[] {
  if (!payload) return [];
  return Array.isArray(payload) ? payload : [payload];
}
function eachModelPrediction(
  payload: any,
  modelKey: "prosody" | "language" | "burst",
  cb: (p: any) => void
) {
  const items = asTopLevelItems(payload);
  for (const it of items) {
    const preds = it?.results?.predictions;
    if (!Array.isArray(preds)) continue;
    for (const pred of preds) {
      const model = pred?.models?.[modelKey];
      const groups = model?.grouped_predictions;
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        const inner = g?.predictions;
        if (!Array.isArray(inner)) continue;
        for (const p of inner) cb(p);
      }
    }
  }
}
function collectTranscriptFromProsody(payload: any): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  eachModelPrediction(payload, "prosody", (p) => {
    const text = p?.text ?? "";
    const start = p?.time?.begin ?? undefined;
    if (text) out.push({ text, start });
  });
  out.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  return out;
}
function collectEmotions(payload: any, modelKey: "prosody" | "language" | "burst"): EmotionItem[] {
  const bag = new Map<string, EmotionItem>();
  eachModelPrediction(payload, modelKey, (p) => {
    const emos = p?.emotions;
    if (!Array.isArray(emos)) return;
    for (const e of emos) {
      const rawName: string = e?.name ?? "Unknown";
      const key = toExpressionKey(rawName);
      const displayName = key ? expressionLabels[key] : rawName;
      const color = key ? expressionColors[key] : colorForFallback(rawName);
      const conf = normConfidence(e?.score);
      const dedupeKey = key ?? rawName.toLowerCase();

      const prev = bag.get(dedupeKey);
      if (!prev || conf > prev.confidence) {
        bag.set(dedupeKey, { name: displayName, confidence: conf, color });
      }
    }
  });
  return Array.from(bag.values()).sort((a, b) => b.confidence - a.confidence);
}
function topN<T>(arr: T[], n = 10) { return arr.slice(0, n); }

export default function ExpressionPage() {
  const params = useSearchParams();
  const jobId = params.get("jobId") ?? "";
  const label = params.get("label") ?? "";

  const [status, setStatus] = useState<JobStatus>("UNKNOWN");
  const [predictions, setPredictions] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    async function tick() {
      try {
        setError(null);
        setLastChecked(Date.now());

        // status
        const sRes = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        if (sRes.ok) {
          const sCT = sRes.headers.get("content-type") || "";
          const sData = sCT.includes("application/json") ? await sRes.json() : await sRes.text();
          const s: JobStatus =
            (sData?.status as JobStatus) ??
            (sData?.state as JobStatus) ??
            "UNKNOWN";
          setStatus(s);
        }

        const pRes = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/predictions`, { cache: "no-store" });
        if (pRes.ok) {
          const pCT = pRes.headers.get("content-type") || "";
          const pData = pCT.includes("application/json") ? await pRes.json() : await pRes.text();
          const hasContent =
            (Array.isArray(pData) && pData.length > 0) ||
            (!!pData && typeof pData === "object" && Object.keys(pData).length > 0);
          if (hasContent) {
            if (!cancelled) {
              setPredictions(pData);
              setStatus((prev) =>
                prev === "IN_PROGRESS" || prev === "QUEUED" || prev === "UNKNOWN"
                  ? "RESULTS_READY"
                  : prev
              );
              if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            }
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Unknown error");
      }
    }

    tick();
    pollRef.current = setInterval(tick, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId]);

  const transcript = useMemo(() => collectTranscriptFromProsody(predictions), [predictions]);
  const prosody    = useMemo(() => topN(collectEmotions(predictions, "prosody"), 10), [predictions]);
  const language   = useMemo(() => topN(collectEmotions(predictions, "language"), 10), [predictions]);
  const vocalBurst = useMemo(() => topN(collectEmotions(predictions, "burst"), 10), [predictions]); // 'burst' key in Hume JSON

  const last = lastChecked ? new Date(lastChecked).toLocaleTimeString() : "—";

  return (
    <div className="min-h-screen bg-white text-black p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="space-y-1">
            <p className="text-lg"><span className="font-semibold">Label:</span> {label || "—"}</p>
            <p className="text-lg"><span className="font-semibold">JOB ID:</span> {jobId || "—"}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusChip status={status} />
            <span className="text-xs text-gray-500">last checked: {last}</span>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-md border border-rose-500 p-4 text-sm text-rose-700">{error}</div>
        )}

        {(status === "QUEUED" || status === "IN_PROGRESS" || status === "UNKNOWN") && !predictions && (
          <div className="mb-6 rounded-2xl border border-black p-4 text-sm text-gray-700">
            Processing...
          </div>
        )}

        {status === "FAILED" && (
          <div className="mb-6 rounded-2xl border border-black p-4 text-sm text-gray-700">
            Job failed. Check your input or model configuration.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <p className="text-lg font-semibold">Transcript</p>
            <div className="mt-3 rounded-2xl border border-black p-6 h-[480px] overflow-auto">
              {!predictions && <p className="text-sm text-gray-600">Waiting for predictions…</p>}
              {predictions && transcript.length === 0 && (
                <p className="text-sm text-gray-600">No transcript found (prosody text missing).</p>
              )}
              <div className="space-y-6">
                {transcript.map((t, i) => (
                  <div key={i} className="grid grid-cols-[120px_1fr] gap-x-6 text-sm">
                    <div className="text-black">
                      <div className="font-semibold">{t.speaker ?? "User"}:</div>
                      <div className="text-gray-700">{secondsToClock(t.start)}</div>
                    </div>
                    <div className="text-black">{t.text ?? ""}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <CategoryCard title="Prosody" items={prosody} />
            <CategoryCard title="Language" items={language} />
            <CategoryCard title="Vocal Burst" items={vocalBurst} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryCard({ title, items }: { title: string; items: EmotionItem[] }) {
  return (
    <div>
      <h3 className="text-center text-lg font-semibold mb-4">{title}</h3>
      <div className="space-y-5">
        {items.length === 0 && <div className="text-sm text-gray-600">No predictions.</div>}
        {items.map((e, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="truncate">
                <span
                  className="inline-block w-3 h-3 rounded-full mr-2 align-middle"
                  style={{ background: e.color }}
                  aria-hidden
                />
                {e.name}
              </span>
              <span className="tabular-nums">{e.confidence.toFixed(2)}</span>
            </div>
            {/* <ConfidenceBar value={e.confidence} /> */}
            <ConfidenceBar value={e.confidence} color={e.color} />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-6 w-full border border-black rounded-full px-4 py-2 text-sm hover:bg-gray-50"
        onClick={() => alert(`TODO: show ${title} activity timeline`)}
      >
        View Activity ↗
      </button>
    </div>
  );
}
