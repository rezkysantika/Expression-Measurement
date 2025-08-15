import { NextRequest } from "next/server";

export const runtime = "nodejs";

function must(name: string, v?: string | null) {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: NextRequest) {
  try {
    const API_KEY  = must("HUME_API_KEY", process.env.HUME_API_KEY);
    const API_BASE = process.env.HUME_API_BASE ?? "https://api.hume.ai";
    const NOTIFY   = (process.env.HUME_NOTIFY ?? "false").toLowerCase() === "true";

    const form = await req.formData();
    const label = (form.get("label") as string) ?? "";
    const url   = (form.get("url") as string) ?? "";
    const file  = form.get("file") as File | null;

    let humeUrl = `${API_BASE}/v0/batch/jobs`;
    let headers: HeadersInit = { "X-Hume-Api-Key": API_KEY };
    let body: BodyInit;

    if (file) {
      // Multipart flow for local files (Hume expects 'file' and optional 'json') :contentReference[oaicite:3]{index=3}
      const passthrough = new FormData();

      // minimal config; add models/transcription/etc as you need
      const config = { notify: NOTIFY /*, models: {...}*/ };
      passthrough.append("json", JSON.stringify(config));

      // If you ever want to send multiple files, call append("file", anotherFile) again.
      passthrough.append("file", file, (file as any).name ?? "upload.bin");

      // (Optional) carry your own label through as a "json" metadata key if desired:
      // passthrough.set("json", JSON.stringify({ ...config, metadata: { label } }));

      body = passthrough; // don't set Content-Type; fetch will set boundary
    } else if (url) {
      // JSON flow for public URLs (Hume expects an object with 'urls') :contentReference[oaicite:4]{index=4}
      headers = { ...headers, "Content-Type": "application/json" };
      body = JSON.stringify({
        urls: [url],
        notify: NOTIFY,
        // models: {...} // add when you know which models you want
        // You can carry your label locally in your DB/UI; Hume doesn't require it.
      });
    } else {
      return new Response(JSON.stringify({ error: "Provide a file or a URL." }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const res = await fetch(humeUrl, { method: "POST", headers, body });
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json() : await res.text();

    // Success response shape: { job_id: "..." } :contentReference[oaicite:5]{index=5}
    return new Response(typeof data === "string" ? data : JSON.stringify(data), {
      status: res.status,
      headers: { "Content-Type": ct.includes("application/json") ? "application/json" : "text/plain" }
    });
  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ error: err?.message ?? "Unexpected error" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
