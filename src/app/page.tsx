"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

const App = () => {
  const router = useRouter();

  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!file && !url.trim()) {
        throw new Error("Please provide a file or a URL.");
      }
      if (file && file.size > 100 * 1024 * 1024) {
        throw new Error("File too large (max 100MB).");
      }
      if (file && !/\.(mp3|wav|zip|m4a)$/i.test(file.name)) {
        throw new Error("Unsupported file type. Use MP3, WAV, or ZIP.");
      }

      const form = new FormData();
      form.append("label", label);
      form.append("url", url);
      if (file) form.append("file", file);

      const res = await fetch("/api/jobs", {
        method: "POST",
        body: form,
      });

      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("application/json") ? await res.json() : await res.text();

      if (!res.ok) {
        const msg = typeof data === "string" ? data : data?.error || "Request failed";
        throw new Error(msg);
      }

      // Hume returns { job_id: "..." } (fallback to "id" just in case)
      const jobId = (data as any)?.job_id ?? (data as any)?.id;
      if (!jobId) throw new Error("No job_id returned from Hume.");

      // ✅ Route to the results page with jobId & label
      router.push(`/expression?jobId=${encodeURIComponent(jobId)}&label=${encodeURIComponent(label)}`);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-black flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-4xl p-8 space-y-6">
        <h1 className="text-3xl font-extrabold text-center text-black tracking-tight">
          Expression Measurement
        </h1>

        <form onSubmit={handleAnalyze} className="space-y-6">
          <div>
            <label htmlFor="label" className="block text-sm font-medium text-black mb-1">
              Enter a label
            </label>
            <input
              type="text"
              id="label"
              value={label}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)}
              placeholder="Enter audio label"
              className="mt-1 block w-full px-4 py-2 bg-white border border-black rounded-md shadow-sm placeholder-gray-500 focus:outline-none focus:ring-black focus:border-black transition-colors duration-200"
            />
          </div>

          <div>
            <label htmlFor="file-upload" className="block text-sm font-medium text-black mb-1">
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
                  <p className="text-sm text-gray-700">
                    Selected file: {file.name}
                  </p>
                )}
                <p className="text-xs text-gray-500">
                  MP3, WAV, or ZIP up to 100MB
                </p>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-black" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-2 text-black">or</span>
            </div>
          </div>

          <div>
            <label htmlFor="url-input" className="block text-sm font-medium text-black mb-1">
              Import URL
            </label>
            <input
              type="text"
              id="url-input"
              value={url}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
              placeholder="Enter URL to audio or zip file"
              className="mt-1 block w-full px-4 py-2 bg-white border border-black rounded-md shadow-sm placeholder-gray-500 focus:outline-none focus:ring-black focus:border-black transition-colors duration-200"
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-black hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black transition-colors duration-200 disabled:opacity-60"
            >
              {loading ? "Analyzing…" : "Analyze"}
            </button>
          </div>
        </form>

        {error && (
          <div className="rounded-md border border-red-500 p-4 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
