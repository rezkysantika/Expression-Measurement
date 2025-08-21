"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  expressionLabels,
  expressionColors,
  type ExpressionKey,
} from "../../lib/expression";

type JobStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "UNKNOWN" | "RESULTS_READY";

type LangToken = {
  text?: string;
  begin?: number;
  end?: number;
  emotions: { name: string; score: number }[];
};

type Segment = {
  begin: number;
  end: number;
  tokens: LangToken[];
};

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

function asTopLevelItems(payload: any): any[] {
  if (!payload) return [];
  return Array.isArray(payload) ? payload : [payload];
}
function eachLanguagePrediction(payload: any, cb: (p: any) => void) {
  const items = asTopLevelItems(payload);
  for (const it of items) {
    const preds = it?.results?.predictions;
    if (!Array.isArray(preds)) continue;
    for (const pred of preds) {
      const groups = pred?.models?.language?.grouped_predictions;
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        const inner = g?.predictions;
        if (!Array.isArray(inner)) continue;
        for (const p of inner) cb(p);
      }
    }
  }
}
function getLanguageTokens(payload: any): LangToken[] {
  const out: LangToken[] = [];
  eachLanguagePrediction(payload, (p) => {
    out.push({
      text: p?.text,
      begin: p?.time?.begin,
      end: p?.time?.end,
      emotions: Array.isArray(p?.emotions) ? p.emotions : [],
    });
  });
  return out
    .filter(t => t.text && typeof t.begin === "number" && typeof t.end === "number")
    .sort((a, b) => (a.begin! - b.begin!));
}

function segmentTokens(
  tokens: LangToken[],
  opts?: { gap?: number; maxTokens?: number; endPunct?: RegExp }
): Segment[] {
  const gap = opts?.gap ?? 0.7;
  const maxTokens = opts?.maxTokens ?? 40;
  const endPunct = opts?.endPunct ?? /[.!?]/;

  const segs: Segment[] = [];
  let cur: Segment | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1];

    const isNew =
      i === 0 ||
      (prev && (t.begin! - prev.end!) > gap) ||
      (prev && endPunct.test(prev.text || "")) ||
      (cur && cur.tokens.length >= maxTokens);

    if (isNew) {
      if (cur) segs.push(cur);
      cur = { begin: t.begin!, end: t.end!, tokens: [t] };
    } else {
      cur!.end = t.end!;
      cur!.tokens.push(t);
    }
  }
  if (cur) segs.push(cur);
  return segs;
}

function rgbaFromColor(color: string, alpha = 0.22): string {
  try {
    if (!color) return `rgba(0,0,0,${alpha})`;
    if (color.startsWith("#")) {
      let r = 0, g = 0, b = 0;
      if (color.length === 4) {
        r = parseInt(color[1] + color[1], 16);
        g = parseInt(color[2] + color[2], 16);
        b = parseInt(color[3] + color[3], 16);
      } else if (color.length === 7) {
        r = parseInt(color.slice(1, 3), 16);
        g = parseInt(color.slice(3, 5), 16);
        b = parseInt(color.slice(5, 7), 16);
      }
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (color.startsWith("hsl")) {
      const m = color.match(/hsl\(\s*([0-9.]+)\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*\)/i);
      if (m) {
        const h = parseFloat(m[1]) / 360;
        const s = parseFloat(m[2]) / 100;
        const l = parseFloat(m[3]) / 100;
        const hue2rgb = (p: number, q: number, t: number) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        let r: number, g: number, b: number;
        if (s === 0) {
          r = g = b = l;
        } else {
          const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
          const p = 2 * l - q;
          r = hue2rgb(p, q, h + 1 / 3);
          g = hue2rgb(p, q, h);
          b = hue2rgb(p, q, h - 1 / 3);
        }
        return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
          b * 255
        )}, ${alpha})`;
      }
    }
    return `rgba(0,0,0,${alpha})`;
  } catch {
    return `rgba(0,0,0,${alpha})`;
  }
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

export default function LanguageActivityClient() {
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

        const sRes = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        if (sRes.ok) {
          const sCT = sRes.headers.get("content-type") || "";
          const sData = sCT.includes("application/json") ? await sRes.json() : await sRes.text();
          const s: JobStatus =
            (sData?.status as JobStatus) ??
            (sData?.state as JobStatus) ??
            "UNKNOWN";
          if (!cancelled) setStatus(s);
        }

        const pRes = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/predictions`, { cache: "no-store" });
        if (pRes.ok) {
          const pCT = pRes.headers.get("content-type") || "";
          const pData = pCT.includes("application/json") ? await pRes.json() : await pRes.text();
          const hasContent =
            (Array.isArray(pData) && pData.length > 0) ||
            (!!pData && typeof pData === "object" && Object.keys(pData).length > 0);
          if (hasContent && !cancelled) {
            setPredictions(pData);
            setStatus((prev) =>
              prev === "IN_PROGRESS" || prev === "QUEUED" || prev === "UNKNOWN"
                ? "RESULTS_READY"
                : prev
            );
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Unknown error");
      }
    }

    tick();
    pollRef.current = setInterval(tick, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); cancelled = true; };
  }, [jobId]);

  const langTokens = useMemo(() => getLanguageTokens(predictions), [predictions]);
  const segments = useMemo<Segment[]>(
    () => segmentTokens(langTokens, { gap: 0.7, maxTokens: 40, endPunct: /[.!?]/ }),
    [langTokens]
  );

  const last = lastChecked ? new Date(lastChecked).toLocaleTimeString() : "—";
  const backHref = `/expression?jobId=${encodeURIComponent(jobId)}&label=${encodeURIComponent(label)}`;

  return (
    <div className="min-h-screen bg-white text-black p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">Language Activity</h1>
            <p className="text-sm text-gray-700">
              <span className="font-semibold">Label:</span> {label || "—"} &nbsp;•&nbsp;
              <span className="font-semibold">Job ID:</span> {jobId || "—"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusChip status={status} />
            <span className="text-xs text-gray-500">last checked: {last}</span>
            <Link href={backHref} className="text-sm underline">⟵ Back to Summary</Link>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-md border border-rose-500 p-4 text-sm text-rose-700">{error}</div>
        )}

        {(status === "QUEUED" || status === "IN_PROGRESS" || status === "UNKNOWN") && !predictions && (
          <div className="mb-6 rounded-2xl border border-black p-4 text-sm text-gray-700">
            Processing…
          </div>
        )}

        <div className="rounded-2xl border border-black h-[560px] overflow-auto">
          {!predictions && (
            <div className="p-6 text-sm text-gray-600">Waiting for language tokens…</div>
          )}

          {predictions && segments.length === 0 && (
            <div className="p-6 text-sm text-gray-600">No transcript tokens found.</div>
          )}

          <div className="divide-y divide-gray-200">
            {segments.map((seg, idx) => (
              <SegmentRow key={idx} seg={seg} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SegmentRow({ seg }: { seg: Segment }) {
  return (
    <div className="p-4 bg-white hover:bg-gray-50 transition-colors">
      <div className="grid grid-cols-[120px_1fr] gap-x-6 text-sm">
        <div className="text-black">
          <div className="text-gray-700">{secondsToClock(seg.begin)}–{secondsToClock(seg.end)}</div>
        </div>
        <div className="text-black leading-7">
          <RichTokens tokens={seg.tokens} />
        </div>
      </div>
    </div>
  );
}

function RichTokens({ tokens }: { tokens: LangToken[] }) {
  const pieces: React.ReactNode[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const text = t.text || "";

    let topName = "Unknown";
    let topScore = 0;
    let color = "";
    let found = false;

    for (const e of t.emotions || []) {
      const conf = normConfidence(e?.score);
      if (conf >= topScore) {
        const key = toExpressionKey(e?.name ?? "Unknown");
        topName = key ? expressionLabels[key] : (e?.name ?? "Unknown");
        color   = key ? expressionColors[key] : colorForFallback(e?.name ?? "Unknown");
        topScore = conf;
        found = true;
      }
    }

    const needsSpace =
      i > 0 && !/^[,.;!?]/.test(text || "");

    if (needsSpace) pieces.push(<span key={`sp-${i}`}>{" "}</span>);

    if (found && topScore > 0) {
      const bg = rgbaFromColor(color, 0.22);
      pieces.push(
        <span
          key={`w-${i}`}
          title={`${topName} ${topScore.toFixed(2)}`}
          className="rounded-[4px] px-1.5 py-0.5"
          style={{
            background: bg,
            boxShadow: `inset 0 0 0 1px ${rgbaFromColor(color, 0.35)}`,
          }}
        >
          {text}
        </span>
      );
    } else {
      pieces.push(<span key={`w-${i}`}>{text}</span>);
    }
  }

  return <>{pieces}</>;
}
