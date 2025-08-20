"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { getAudioUrl } from "@/lib/audio-store";
import {
  expressionLabels,
  expressionColors,
  type ExpressionKey,
} from "../../lib/expression";

type EmotionItem = { name: string; confidence: number; color: string };
type JobStatus =
  | "QUEUED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "UNKNOWN"
  | "RESULTS_READY";

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
  const camel =
    parts[0] +
    parts.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return (camel as ExpressionKey) in expressionLabels
    ? (camel as ExpressionKey)
    : undefined;
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
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${map[status]}`}
    >
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

type ProsodyForSeg = ProsodyUtterance;
type LangForSeg = LangToken;

function getProsodyUtterances(payload: any): ProsodyForSeg[] {
  const out: ProsodyForSeg[] = [];
  eachModelPrediction(payload, "prosody", (p) => {
    const text: string = p?.text ?? "";
    const begin: number | undefined = p?.time?.begin;
    const end: number | undefined = p?.time?.end;
    const emotions = Array.isArray(p?.emotions) ? p.emotions : [];
    if (text && typeof begin === "number" && typeof end === "number") {
      out.push({ text, begin, end, emotions });
    }
  });
  out.sort((a, b) => a.begin - b.begin);
  return out;
}
function getLanguageTokens(payload: any): LangForSeg[] {
  const out: LangForSeg[] = [];
  eachModelPrediction(payload, "language", (p) => {
    out.push({
      text: p?.text,
      begin: p?.time?.begin,
      end: p?.time?.end,
      emotions: Array.isArray(p?.emotions) ? p.emotions : [],
    });
  });
  return out
    .filter(
      (t) =>
        t.text && typeof t.begin === "number" && typeof t.end === "number"
    )
    .sort((a, b) => a.begin! - b.begin!);
}
type Segment = { text: string; begin: number; end: number };
function buildSegmentsFromLanguage(
  tokens: LangForSeg[],
  opts?: { gap?: number; maxTokens?: number; endPunct?: RegExp }
): Segment[] {
  const gap = opts?.gap ?? 0.7;
  const maxTokens = opts?.maxTokens ?? 40;
  const endPunct = opts?.endPunct ?? /[.!?]/;

  const toks = tokens;
  const segs: Segment[] = [];
  let cur: Segment | null = null;
  let buff: LangForSeg[] = [];

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const prev = toks[i - 1];

    const isNew =
      i === 0 ||
      (prev && t.begin! - (prev.end as number) > gap) ||
      (prev && endPunct.test(prev.text || "")) ||
      buff.length >= maxTokens;

    if (isNew) {
      if (cur) {
        cur.text = buff
          .map((x) => x.text)
          .join(" ")
          .replace(/\s+([,.;!?])/g, "$1");
        segs.push(cur);
      }
      cur = { text: "", begin: t.begin!, end: t.end! };
      buff = [t];
    } else {
      cur!.end = t.end!;
      buff.push(t);
    }
  }

  if (cur) {
    cur.text = buff.map((x) => x.text).join(" ").replace(/\s+([,.;!?])/g, "$1");
    segs.push(cur);
  }
  return segs;
}
function mergeProsodyUtterances(
  utts: ProsodyForSeg[],
  opts?: { gap?: number; maxDuration?: number }
): Segment[] {
  const gap = opts?.gap ?? 0.6;
  const maxDur = opts?.maxDuration ?? 8;
  const arr = [...utts].sort((a, b) => a.begin - b.begin);
  const segs: Segment[] = [];
  let cur: Segment | null = null;

  for (const u of arr) {
    if (!cur) {
      cur = { text: u.text, begin: u.begin, end: u.end };
      continue;
    }
    const silent = u.begin - cur.end;
    const newDur = u.end - cur.begin;
    if (silent <= gap && newDur <= maxDur) {
      cur.text = `${cur.text} ${u.text}`.replace(/\s+/g, " ").trim();
      cur.end = u.end;
    } else {
      segs.push(cur);
      cur = { text: u.text, begin: u.begin, end: u.end };
    }
  }
  if (cur) segs.push(cur);
  return segs;
}

export default function ExpressionPage() {
  const params = useSearchParams();
  const jobId = params.get("jobId") ?? "";
  const label = params.get("label") ?? "";

  const [status, setStatus] = useState<JobStatus>("UNKNOWN");
  const [predictions, setPredictions] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const [audioResolved, setAudioResolved] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const setRowRef = (i: number) => (el: HTMLDivElement | null) => {
    rowRefs.current[i] = el;
  };
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function resolveAudio() {
      if (!jobId) return;
      let url = await getAudioUrl(jobId);

      if (!url && typeof window !== "undefined") {
        const ss = sessionStorage.getItem(`audioForJob:${jobId}`);
        if (ss) url = ss;
      }

      if (!url) {
        const qp = params.get("audio");
        if (qp) url = qp;
      }

      if (!cancelled) setAudioResolved(url || null);
    }
    resolveAudio();
    return () => {
      cancelled = true;
    };
  }, [jobId, params]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    async function tick() {
      try {
        setError(null);
        setLastChecked(Date.now());

        const sRes = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
          cache: "no-store",
        });
        if (sRes.ok) {
          const sCT = sRes.headers.get("content-type") || "";
          const sData = sCT.includes("application/json")
            ? await sRes.json()
            : await sRes.text();
          const s: JobStatus =
            (sData?.status as JobStatus) ??
            (sData?.state as JobStatus) ??
            "UNKNOWN";
          setStatus(s);
        }

        const pRes = await fetch(
          `/api/jobs/${encodeURIComponent(jobId)}/predictions`,
          { cache: "no-store" }
        );
        if (pRes.ok) {
          const pCT = pRes.headers.get("content-type") || "";
          const pData = pCT.includes("application/json")
            ? await pRes.json()
            : await pRes.text();
          const hasContent =
            (Array.isArray(pData) && pData.length > 0) ||
            (!!pData &&
              typeof pData === "object" &&
              Object.keys(pData).length > 0);
          if (hasContent) {
            if (!cancelled) {
              setPredictions(pData);
              setStatus((prev) =>
                prev === "IN_PROGRESS" ||
                prev === "QUEUED" ||
                prev === "UNKNOWN"
                  ? "RESULTS_READY"
                  : prev
              );
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
            }
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Unknown error");
      }
    }

    tick();
    pollRef.current = setInterval(tick, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId]);

  const prosodyUtterances = useMemo(
    () => getProsodyUtterances(predictions),
    [predictions]
  );
  const langTokens = useMemo(
    () => getLanguageTokens(predictions),
    [predictions]
  );

  const segments = useMemo<Segment[]>(() => {
    if (langTokens.length > 0) {
      return buildSegmentsFromLanguage(langTokens, {
        gap: 0.7,
        maxTokens: 40,
        endPunct: /[.!?]/,
      });
    }
    return mergeProsodyUtterances(prosodyUtterances, {
      gap: 0.6,
      maxDuration: 8,
    });
  }, [langTokens, prosodyUtterances]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || segments.length === 0) return;

    const onTime = () => {
      const t = el.currentTime;
      let idx = -1;
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (t >= s.begin && t < s.end) {
          idx = i;
          break;
        }
      }
      if (idx !== -1 && idx !== activeIdx) {
        setActiveIdx(idx);
        const row = rowRefs.current[idx];
        const cont = containerRef.current;
        if (row && cont) {
          row.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    };

    onTime();
    el.addEventListener("timeupdate", onTime);
    return () => {
      el.removeEventListener("timeupdate", onTime);
    };
  }, [segments, activeIdx]);

  const jumpTo = (sec: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, sec + 0.01);
    audioRef.current.play().catch(() => {});
  };

  const prosody = useMemo(
    () => topN(collectEmotions(predictions, "prosody"), 10),
    [predictions]
  );
  const language = useMemo(
    () => topN(collectEmotions(predictions, "language"), 10),
    [predictions]
  );
  const vocalBurst = useMemo(
    () => topN(collectEmotions(predictions, "burst"), 10),
    [predictions]
  );

  const last = lastChecked ? new Date(lastChecked).toLocaleTimeString() : "—";
  const activityHref =
    `/activity?jobId=${encodeURIComponent(jobId)}&label=${encodeURIComponent(label)}` +
    (audioResolved ? `&audio=${encodeURIComponent(audioResolved)}` : "");


  return (
    <div className="min-h-screen bg-white text-black p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">Overall Expression Measurement</h1>
            <p className="text-sm text-gray-700">
              <span className="font-semibold">Label:</span> {label || "—"} &nbsp;•&nbsp;
              <span className="font-semibold">Job ID:</span> {jobId || "—"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusChip status={status} />
            <span className="text-xs text-gray-500">last checked: {last}</span>
          </div>
          
            <Link
              href={`/`}
              className="text-sm underline"
            >
              ⟵ Back to Main
            </Link>
        </div>

        <div className="mb-3">
          {audioResolved ? (
            <audio
              ref={audioRef}
              controls
              preload="metadata"
              src={audioResolved}
              className="w-full"
            />
          ) : (
            <div className="rounded-md border border-gray-300 p-3 text-sm text-gray-700">
              Audio not available yet. If this file came from a ZIP, it will
              appear once the local copy is ready.
            </div>
          )}
        </div>

        {error && (
          <div className="mb-6 rounded-md border border-rose-500 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {(status === "QUEUED" ||
          status === "IN_PROGRESS" ||
          status === "UNKNOWN") &&
          !predictions && (
            <div className="mb-6 rounded-2xl border border-black p-4 text-sm text-gray-700">
              Processing...
            </div>
          )}

        {status === "FAILED" && (
          <div className="mb-6 rounded-2xl border border-black p-4 text-sm text-gray-700">
            Job failed. Check input or model configuration.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <p className="text-lg font-semibold">Transcript</p>
            <div
              ref={containerRef}
              className="mt-3 rounded-2xl border border-black h-[480px] overflow-auto"
            >
              {!predictions && (
                <p className="p-6 text-sm text-gray-600">
                  Waiting for expression predictions...
                </p>
              )}
              {predictions && segments.length === 0 && (
                <p className="p-6 text-sm text-gray-600">
                  No transcript segments found.
                </p>
              )}
              <div className="divide-y divide-gray-200">
                {segments.map((seg, i) => {
                  const active = i === activeIdx;
                  return (
                    <div
                      key={i}
                      ref={setRowRef(i)}
                      className={`p-4 transition-colors cursor-pointer ${
                        active
                          ? "bg-blue-50/60 border-l-4 border-blue-400"
                          : "bg-white border-l-4 border-transparent hover:bg-gray-50"
                      }`}
                      onClick={() => jumpTo(seg.begin)}
                      aria-current={active ? "true" : undefined}
                    >
                      <div className="grid grid-cols-[120px_1fr] gap-x-6 text-sm">
                        <div className="text-black">
                          <div className="font-semibold">User</div>
                          <div
                            className={active ? "text-blue-800" : "text-gray-700"}
                          >
                            {secondsToClock(seg.begin)}
                          </div>
                        </div>
                        <div
                          className={`text-black ${
                            active ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {seg.text}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <CategoryCard title="Prosody" items={prosody} href={activityHref} />
            <CategoryCard title="Language" items={language} href={activityHref} />
            <CategoryCard title="Vocal Burst" items={vocalBurst} href={activityHref} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryCard({
  title,
  items,
  href,
}: {
  title: string;
  items: EmotionItem[];
  href: string;
}) {
  return (
    <div>
      <h3 className="text-center text-lg font-semibold mb-4">{title}</h3>
      <div className="space-y-5">
        {items.length === 0 && (
          <div className="text-sm text-gray-600">No predictions</div>
        )}
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
            <ConfidenceBar value={e.confidence} color={e.color} />
          </div>
        ))}
      </div>
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            window.location.assign(href);
          }}
          className="mt-6 block w-full text-center border border-black rounded-full px-4 py-2 text-sm hover:bg-gray-50"
        >
          View Activity ↗
        </a>

    </div>
  );
}
