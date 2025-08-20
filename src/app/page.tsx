"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { putAudio } from "@/lib/audio-store";

type Row = {
  name: string;
  fullPath: string;
  size: number;
  blob: Blob;
  url: string;
  included: boolean;
  label: string;
  status: "idle" | "uploading" | "done" | "error";
  jobId?: string;
  error?: string;
};

const AUDIO_RE = /\.(wav|mp3|m4a)$/i;

export default function App() {
  const router = useRouter();

  const [baseLabel, setBaseLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [loadingSingle, setLoadingSingle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);

  const includedCount = useMemo(
    () => rows?.filter((r) => r.included).length ?? 0,
    [rows]
  );

  async function parseZip(f: File, base: string) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(f);

    const next: Row[] = [];
    for (const [path, entry] of Object.entries(zip.files)) {
      if ((entry as any).dir) continue;
      const baseName = path.split("/").pop() || path;
      if (!AUDIO_RE.test(baseName)) continue;
      const blob = await (entry as any).async("blob");
      const url = URL.createObjectURL(blob);
      next.push({
        name: baseName,
        fullPath: path,
        size: blob.size,
        blob,
        url,
        included: true,
        label: base ? `${base} - ${baseName}` : baseName,
        status: "idle",
      });
    }
    next.sort((a, b) => a.name.localeCompare(b.name));
    setRows(next);
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (!e.target.files?.length) {
      setFile(null);
      if (rows) {
        rows.forEach((r) => URL.revokeObjectURL(r.url));
        setRows(null);
      }
      return;
    }
    const f = e.target.files[0];
    setFile(f);

    if (/\.zip$/i.test(f.name) || f.type === "application/zip") {
      try {
        await parseZip(f, baseLabel);
      } catch (err: any) {
        setError("Failed to read ZIP: " + (err?.message ?? "unknown error"));
        setRows(null);
      }
    } else {
      if (rows) {
        rows.forEach((r) => URL.revokeObjectURL(r.url));
        setRows(null);
      }
    }
  };

  const handleAnalyzeSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoadingSingle(true);

    try {
      if (!file && !url.trim())
        throw new Error("Please provide a file or a URL.");
      if (file && file.size > 100 * 1024 * 1024)
        throw new Error("File too large (max 100MB).");
      if (file && !/\.(mp3|wav|zip|m4a)$/i.test(file.name))
        throw new Error("Unsupported type.");

      const form = new FormData();
      form.append("label", baseLabel);
      form.append("url", url);
      if (file) form.append("file", file);

      const res = await fetch("/api/jobs", { method: "POST", body: form });
      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("application/json")
        ? await res.json()
        : await res.text();
      if (!res.ok)
        throw new Error(
          typeof data === "string" ? data : data?.error || "Request failed"
        );

      const jobId = (data as any)?.job_id ?? (data as any)?.id;

      if (file && !/\.zip$/i.test(file.name)) {
        await putAudio(jobId, file);
        const blobUrl = URL.createObjectURL(file);
        sessionStorage.setItem(`audioForJob:${jobId}`, blobUrl);
      }

      const dest = `/expression?jobId=${encodeURIComponent(
        jobId
      )}&label=${encodeURIComponent(baseLabel)}`;
      router.push(dest);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong.");
    } finally {
      setLoadingSingle(false);
    }
  };

  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const analyzeSelected = async () => {
    if (!rows) return;
    const selected = rows.filter((r) => r.included);
    if (selected.length === 0) {
      setError("Select at least one audio from the ZIP.");
      return;
    }

    setBulkSubmitting(true);
    setError(null);

    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      const row = next[i];
      if (!row.included || row.status === "done") continue;

      next[i] = { ...row, status: "uploading", error: undefined };
      setRows([...next]);

      try {
        const form = new FormData();
        form.append("label", row.label || row.name);
        form.append(
          "file",
          new File([row.blob], row.name, {
            type: row.blob.type || "audio/wav",
          })
        );

        const res = await fetch("/api/jobs", { method: "POST", body: form });
        const ct = res.headers.get("content-type") || "";
        const data = ct.includes("application/json")
          ? await res.json()
          : await res.text();
        if (!res.ok)
          throw new Error(
            typeof data === "string" ? data : data?.error || "Request failed"
          );

        const jobId = (data as any)?.job_id ?? (data as any)?.id;
        await putAudio(jobId, row.blob);
        sessionStorage.setItem(`audioForJob:${jobId}`, row.url);

        next[i] = { ...row, status: "done", jobId };
        setRows([...next]);
      } catch (err: any) {
        next[i] = {
          ...row,
          status: "error",
          error: err?.message ?? "Upload failed",
        };
        setRows([...next]);
      }
    }

    setBulkSubmitting(false);
  };

  const goToExpression = (row: Row) => {
    if (!row.jobId) return;
    const href = `/expression?jobId=${encodeURIComponent(row.jobId)}&label=${encodeURIComponent(row.label || row.name)}`;
    window.open(href, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="min-h-screen bg-white text-black flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-4xl p-8 space-y-6">
        <h1 className="text-3xl font-extrabold text-center text-black tracking-tight">
          Expression Measurement
        </h1>

        <div>
          <label htmlFor="label" className="block text-sm font-medium mb-1">
            Enter a label
          </label>
          <input
            id="label"
            type="text"
            value={baseLabel}
            onChange={(e) => {
              setBaseLabel(e.target.value);
              if (rows) {
                setRows(
                  rows.map((r) =>
                    r.status === "idle"
                      ? {
                          ...r,
                          label: e.target.value
                            ? `${e.target.value} - ${r.name}`
                            : r.name,
                        }
                      : r
                  )
                );
              }
            }}
            placeholder="Enter audio label"
            className="mt-1 block w-full px-4 py-2 border border-black rounded-md"
          />
        </div>

        <div>
          <label
            htmlFor="file-upload"
            className="block text-sm font-medium text-black mb-1"
          >
            Upload a file (audio or zip file)
          </label>
          <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-black border-dashed rounded-md">
            <div className="space-y-1 text-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mx-auto h-12 w-12 text-black"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" x2="12" y1="3" y2="15"></line>
              </svg>
              <div className="text-center text-sm text-gray-600">
                <label
                  htmlFor="file-upload"
                  className="relative cursor-pointer bg-white rounded-md font-medium text-black hover:text-gray-700 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-black"
                >
                  <span>Upload a file</span>
                  <input
                    id="file-upload"
                    name="file-upload"
                    type="file"
                    className="sr-only"
                    accept=".mp3,.wav,.zip,.m4a"
                    onChange={handleFileChange}
                  />
                </label>
              </div>
              {file && (
                <p className="text-sm text-gray-700">Selected file: {file.name}</p>
              )}
              <p className="text-xs text-gray-500">MP3, WAV, or ZIP up to 100MB</p>
            </div>
          </div>
        </div>

        {!rows && (
          <form onSubmit={handleAnalyzeSingle} className="space-y-4">
            <div className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-black" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-2 text-black">or</span>
              </div>
            </div>

            <div>
              <label htmlFor="url-input" className="block text-sm font-medium mb-1">
                Import URL
              </label>
              <input
                id="url-input"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Enter URL to audio or ZIP"
                className="mt-1 block w-full px-4 py-2 border border-black rounded-md"
              />
            </div>

            <button
              type="submit"
              disabled={loadingSingle}
              className="w-full py-2 rounded-md text-white bg-black hover:bg-gray-800 disabled:opacity-60"
            >
              {loadingSingle ? "Analyzing..." : "Analyze"}
            </button>
          </form>
        )}

        {rows && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Files in ZIP</div>
              <div className="text-sm text-gray-600">{includedCount} selected</div>
            </div>

            <div className="rounded-xl border border-black max-h-80 overflow-auto divide-y">
              {rows.map((r, i) => (
                <div key={r.fullPath + i} className="p-3 grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-1 flex justify-center">
                    <input
                      type="checkbox"
                      checked={r.included}
                      onChange={(e) => {
                        const next = [...rows];
                        next[i] = { ...r, included: e.target.checked };
                        setRows(next);
                      }}
                    />
                  </div>

                  <div className="col-span-5 min-w-0">
                    <div className="truncate text-sm font-medium">{r.name}</div>
                    <div className="text-xs text-gray-500">
                      {(r.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <div className="col-span-3">
                    <audio src={r.url} controls className="h-8 w-full" preload="metadata" />
                  </div>

                  <div className="col-span-3">
                    <input
                      type="text"
                      value={r.label}
                      onChange={(e) => {
                        const next = [...rows];
                        next[i] = { ...r, label: e.target.value };
                        setRows(next);
                      }}
                      className="w-full px-2 py-1 border border-gray-300 rounded"
                    />
                  </div>

                  <div className="col-span-12 md:col-span-12 flex items-center gap-3">
                    {r.status === "uploading" && (
                      <span className="text-xs text-blue-700">Uploading...</span>
                    )}
                    {r.status === "error" && (
                      <span className="text-xs text-rose-700">Error: {r.error}</span>
                    )}
                    {r.status === "done" && r.jobId && (
                      <>
                        <span className="text-xs text-emerald-700">
                          Job ID: {r.jobId}
                        </span>
                        <button
                          type="button"
                          onClick={() => goToExpression(r)}
                          className="text-xs px-3 py-1 rounded-full border border-black hover:bg-gray-50"
                        >
                          Open Expression ↗
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={analyzeSelected}
                disabled={bulkSubmitting || includedCount === 0}
                className="px-4 py-2 rounded-md text-white bg-black hover:bg-gray-800 disabled:opacity-60"
              >
                {bulkSubmitting ? "Submitting..." : "Analyze"}
              </button>
              <button
                type="button"
                onClick={() => {
                  rows.forEach((r) => URL.revokeObjectURL(r.url));
                  setRows(null);
                }}
                className="px-4 py-2 rounded-md border border-gray-300 hover:bg-gray-50"
              >
                Choose another file
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
