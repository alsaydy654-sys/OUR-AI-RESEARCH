// Research Events Edge Function — Server-Sent Events (SSE)
// Streams real-time research progress updates with event IDs and heartbeats.
// Supports Last-Event-ID for replay after reconnection.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const STAGE_MAP: Record<number, string> = {
  1: "تخطيط البحث",
  2: "جمع المصادر",
  3: "تحليل النتائج",
  4: "التحقق من الأدلة",
  5: "إعداد التقرير",
};

interface ProgressEvent {
  id: number;
  event: string;
  data: {
    jobId: string;
    status?: string;
    stage?: number;
    stageLabel?: string;
    progressPercent?: number;
    sourceName?: string;
    sourceStatus?: string;
    sourceCount?: number;
    error?: string;
    timestamp: string;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const jobId = pathParts[pathParts.length - 1];

  if (!jobId) {
    return new Response(JSON.stringify({ error: "Job ID required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get Last-Event-ID header for replay
  const lastEventIdHeader = req.headers.get("Last-Event-ID");
  const lastEventId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : 0;

  // Set up SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let eventCounter = lastEventId;
      let lastProgress = -1;
      let lastStatus = "";
      let lastStage = -1;
      let closed = false;

      const sendEvent = (event: string, data: Record<string, unknown>) => {
        if (closed) return;
        eventCounter++;
        const eventObj: ProgressEvent = {
          id: eventCounter,
          event,
          data: { ...data, jobId, timestamp: new Date().toISOString() } as ProgressEvent["data"],
        };
        const message = `id: ${eventObj.id}\nevent: ${eventObj.event}\ndata: ${JSON.stringify(eventObj.data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(message));
        } catch {
          closed = true;
        }
      };

      // Send replay events if Last-Event-ID > 0
      if (lastEventId > 0) {
        // Replay current state as a snapshot
        const { data: job } = await supabase
          .from("research_jobs")
          .select("*")
          .eq("id", jobId)
          .maybeSingle();

        if (job) {
          sendEvent("replay", {
            status: job.status,
            stage: job.current_stage,
            stageLabel: STAGE_MAP[job.current_stage] || "",
            progressPercent: job.progress_percent,
          });
        }

        // Replay source runs
        const { data: runs } = await supabase
          .from("source_runs")
          .select("*")
          .eq("research_job_id", jobId)
          .order("created_at", { ascending: true });

        if (runs) {
          for (const run of runs) {
            sendEvent("source_update", {
              sourceName: run.source_name,
              sourceStatus: run.status,
              sourceCount: run.result_count || 0,
            });
          }
        }
      }

      // Polling loop for live updates
      const pollInterval = setInterval(async () => {
        if (closed) {
          clearInterval(pollInterval);
          return;
        }

        try {
          const { data: job, error } = await supabase
            .from("research_jobs")
            .select("*")
            .eq("id", jobId)
            .maybeSingle();

          if (error || !job) {
            sendEvent("error", { error: "Job not found" });
            clearInterval(pollInterval);
            controller.close();
            return;
          }

          // Send update if progress changed
          if (job.progress_percent !== lastProgress || job.status !== lastStatus || job.current_stage !== lastStage) {
            lastProgress = job.progress_percent;
            lastStatus = job.status;
            lastStage = job.current_stage;

            sendEvent("progress", {
              status: job.status,
              stage: job.current_stage,
              stageLabel: STAGE_MAP[job.current_stage] || "",
              progressPercent: job.progress_percent,
            });
          }

          // Check source runs for changes
          const { data: runs } = await supabase
            .from("source_runs")
            .select("*")
            .eq("research_job_id", jobId)
            .order("created_at", { ascending: true });

          if (runs) {
            for (const run of runs) {
              const runKey = `${run.source_name}-${run.status}`;
              if (!sentSourceEvents.has(runKey)) {
                sentSourceEvents.add(runKey);
                sendEvent("source_update", {
                  sourceName: run.source_name,
                  sourceStatus: run.status,
                  sourceCount: run.result_count || 0,
                  error: run.error_message,
                });
              }
            }
          }

          // Terminal states
          if (["completed", "partial", "failed"].includes(job.status)) {
            sendEvent("complete", {
              status: job.status,
              error: job.error_summary,
            });
            clearInterval(pollInterval);
            controller.close();
            return;
          }

          // Heartbeat
          sendEvent("heartbeat", {});
        } catch (err) {
          console.error("SSE poll error:", err);
        }
      }, 2000);

      // Clean up on cancel
      req.signal?.addEventListener("abort", () => {
        closed = true;
        clearInterval(pollInterval);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

const sentSourceEvents = new Set<string>();
