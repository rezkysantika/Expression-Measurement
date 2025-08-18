"use client";

import { useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  expressionLabels,
  expressionColors,
  type ExpressionKey,
} from "../../lib/expression";

type EmotionItem = { name: string; confidence: number; color: string };
type JobStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "UNKNOWN" | "RESULTS_READY";

type ProsodyUtterance = {
  text: string;
  begin: number;
  end: number;
  emotions: { name: string; score: number }[];
};

type LangToken = {
  text?: string;
  begin?: number;
  end?: number;
  emotions: { name: string; score: number }[];
};

type BurstEvent = {
  begin?: number;
  end?: number;
  emotions: { name: string; score: number }[];
};

function secondsToClock(s?: number) {
  if (typeof s !== "number" || Number.isNaN(s)) return "00:00";
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
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
function topN<T>(arr: T[], n = 3) { return arr.slice(0, n); }
function overlap(a0?: number, a1?: number, b0?: number, b1?: number) {
  if (a0 == null || a1 == null || b0 == null || b1 == null) return false;
  return a0 < b1 && b0 < a1;
}

function ConfidenceBar({ value, color }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="w-full h-1.5 rounded-full bg-gray-200">
      <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: color || "#9CA3AF" }} />
    </div>
  );
}

function asItems(payload: any): any[] {
  return Array.isArray(payload) ? payload : payload ? [payload] : [];
}

function getProsodyUtterances(payload: any): ProsodyUtterance[] {
  const out: ProsodyUtterance[] = [];
  for (const it of asItems(payload)) {
    const preds = it?.results?.predictions;
    if (!Array.isArray(preds)) continue;
    for (const pred of preds) {
      const groups = pred?.models?.prosody?.grouped_predictions;
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        const inner = g?.predictions;
        if (!Array.isArray(inner)) continue;
        for (const p of inner) {
          const text: string = p?.text ?? "";
          const begin: number | undefined = p?.time?.begin;
          const end: number | undefined = p?.time?.end;
          const emotions = Array.isArray(p?.emotions) ? p.emotions : [];
          if (text && typeof begin === "number" && typeof end === "number") {
            out.push({ text, begin, end, emotions });
          }
        }
      }
    }
  }
  out.sort((a, b) => a.begin - b.begin);
  return out;
}

function getLanguageTokens(payload: any): LangToken[] {
  const out: LangToken[] = [];
  for (const it of asItems(payload)) {
    const preds = it?.results?.predictions;
    if (!Array.isArray(preds)) continue;
    for (const pred of preds) {
      const groups = pred?.models?.language?.grouped_predictions;
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        const inner = g?.predictions;
        if (!Array.isArray(inner)) continue;
        for (const p of inner) {
          out.push({
            text: p?.text,
            begin: p?.time?.begin,
            end: p?.time?.end,
            emotions: Array.isArray(p?.emotions) ? p.emotions : [],
          });
        }
      }
    }
  }
  return out;
}

function getBurstEvents(payload: any): BurstEvent[] {
  const out: BurstEvent[] = [];
  for (const it of asItems(payload)) {
    const preds = it?.results?.predictions;
    if (!Array.isArray(preds)) continue;
    for (const pred of preds) {
      const groups = pred?.models?.burst?.grouped_predictions;
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        const inner = g?.predictions;
        if (!Array.isArray(inner)) continue;
        for (const p of inner) {
          out.push({
            begin: p?.time?.begin,
            end: p?.time?.end,
            emotions: Array.isArray(p?.emotions) ? p.emotions : [],
          });
        }
      }
    }
  }
  return out;
}

// emotions aggregation
function aggregateEmotions(items: { emotions: { name: string; score: number }[] }[]): EmotionItem[] {
  const bag = new Map<string, EmotionItem>();
  for (const it of items) {
    for (const e of it.emotions || []) {
      const rawName = e?.name ?? "Unknown";
      const key = toExpressionKey(rawName);
      const name = key ? expressionLabels[key] : rawName;
      const color = key ? expressionColors[key] : colorForFallback(rawName);
      const conf = normConfidence(e?.score);
      const dedupe = key ?? rawName.toLowerCase();
      const prev = bag.get(dedupe);
      if (!prev || conf > prev.confidence) bag.set(dedupe, { name, confidence: conf, color });
    }
  }
  return Array.from(bag.values()).sort((a, b) => b.confidence - a.confidence);
}

export default function ActivityPage() {
  const params = useSearchParams();
  const jobId = params.get("jobId") ?? "";
  const label = params.get("label") ?? "";

  const [status, setStatus] = useState<JobStatus>("UNKNOWN");
  const [predictions, setPredictions] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!jobId) return;

    async function tick() {
      try {
        const pRes = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/predictions`, { cache: "no-store" });
        const ct = pRes.headers.get("content-type") || "";
        const data = ct.includes("application/json") ? await pRes.json() : await pRes.text();
        const hasContent =
          (Array.isArray(data) && data.length > 0) ||
          (!!data && typeof data === "object" && Object.keys(data).length > 0);

        if (pRes.ok && hasContent) {
          setPredictions(data);
          setStatus("RESULTS_READY");
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        } else {
          setStatus("IN_PROGRESS");
        }
      } catch (e: any) {
        setError(e?.message ?? "Unknown error");
      }
    }

    tick();
    pollRef.current = setInterval(tick, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId]);

  const prosodyUtterances = useMemo(() => getProsodyUtterances(predictions), [predictions]);
  const langTokens = useMemo(() => getLanguageTokens(predictions), [predictions]);
  const burstEvents = useMemo(() => getBurstEvents(predictions), [predictions]);

  return (
    <div className="min-h-screen bg-white text-black p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">Activity</h1>
            <p className="text-sm text-gray-700">
              <span className="font-semibold">Label:</span> {label || "—"} &nbsp; &nbsp;
              <span className="font-semibold">Job ID:</span> {jobId || "—"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs rounded-full border px-3 py-1">{status}</span>
            <Link href={`/expression?jobId=${encodeURIComponent(jobId)}&label=${encodeURIComponent(label)}`} className="text-sm underline">
              ⟵ Back to Summary
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-md border border-rose-500 p-4 text-sm text-rose-700">{error}</div>
        )}

        <div className="mt-3 rounded-2xl border border-black h-[540px] overflow-auto">
          {!predictions && (
            <div className="p-6 text-sm text-gray-600">Loading detail...</div>
          )}

          {predictions && prosodyUtterances.length === 0 && (
            <div className="p-6 text-sm text-gray-600">No prosody text found.</div>
          )}

          <div className="divide-y divide-gray-200">
            {prosodyUtterances.map((utt, idx) => {
              const tokensInWin = langTokens.filter(t => overlap(utt.begin, utt.end, t.begin, t.end));
              const burstsInWin = burstEvents.filter(b => overlap(utt.begin, utt.end, b.begin, b.end));

              const prosodyTop  = topN(aggregateEmotions([{ emotions: utt.emotions }]), 3);
              const languageTop = topN(aggregateEmotions(tokensInWin), 3);
              const burstTop    = topN(aggregateEmotions(burstsInWin), 3);

              return (
                <div key={idx} className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                    <div className="md:col-span-7">
                      <div className="text-[11px] text-gray-600">
                        {secondsToClock(utt.begin)} - {secondsToClock(utt.end)}
                      </div>
                      <div className="text-sm font-medium mt-1">{utt.text}</div>
                    </div>
                    
                    <div className="md:col-span-5">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <CategoryMini title="Prosody" items={prosodyTop} />
                        <CategoryMini title="Language" items={languageTop} />
                        <CategoryMini title="Vocal Burst" items={burstTop} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryMini({ title, items }: { title: string; items: EmotionItem[] }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold mb-1.5">{title}</h3>
      {items.length === 0 && <div className="text-xs text-gray-600">—</div>}
      <div className="space-y-1.5">
        {items.map((e, i) => (
          <div key={i} className="space-y-0.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="truncate">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle"
                  style={{ background: e.color }}
                  aria-hidden
                />
                {e.name}
              </span>
              <span className="tabular-nums">{e.confidence.toFixed(2)}</span>
            </div>
            <ConfidenceBar value={e.confidence} color={e.color} />
          </div>
        ))}
      </div>
    </div>
  );
}
