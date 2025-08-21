export const runtime = "nodejs";

function must(name: string, v?: string | null) {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function GET(req: Request) {
  try {
    const API_KEY  = must("HUME_API_KEY", process.env.HUME_API_KEY);
    const API_BASE = process.env.HUME_API_BASE ?? "https://api.hume.ai";

    const pathname = new URL(req.url).pathname;
    const parts = pathname.split("/");
    const jobsIdx = parts.lastIndexOf("jobs");
    const jobId = jobsIdx >= 0 ? decodeURIComponent(parts[jobsIdx + 1] || "") : "";

    if (!jobId) {
      return new Response(JSON.stringify({ error: "Missing job id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = `${API_BASE}/v0/batch/jobs/${encodeURIComponent(jobId)}/predictions`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-Hume-Api-Key": API_KEY },
      cache: "no-store",
    });

    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json() : await res.text();

    return new Response(
      typeof data === "string" ? data : JSON.stringify(data),
      {
        status: res.status,
        headers: {
          "Content-Type": ct.includes("application/json") ? "application/json" : "text/plain",
        },
      }
    );
  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ error: err?.message ?? "Unexpected error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
