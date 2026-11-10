// Research Orchestrator Edge Function
// Server-side pipeline: creates research job, collects from real sources,
// extracts evidence-based claims, generates report.
// All privileged operations use service_role key (bypasses RLS).

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ResearchRequest {
  query: string;
  scope?: string;
  depth?: "quick" | "deep";
  language?: string;
}

interface UnifiedResult {
  source_name: string;
  source_type: "web" | "repo" | "video";
  title: string;
  url: string;
  excerpt: string;
  published_at: string | null;
  author: string | null;
  raw_metadata: Record<string, unknown> | null;
  collection_status: "collected" | "failed" | "partial";
}

interface ClaimData {
  claim_text: string;
  claim_type: string;
  confidence_level: "high" | "medium" | "low" | "unverified";
  verification_status: "verified" | "partially_supported" | "contradicted" | "unverified";
  reasoning_summary: string;
  uncertainty_notes: string;
  supporting_evidence_ids: string[];
  contradicting_evidence_ids: string[];
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

// ============================================================
// URL SAFETY VALIDATION (SSRF protection)
// ============================================================
function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    // Block loopback
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
    // Block private IP ranges
    if (/^10\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) || /^192\.168\./.test(host)) return false;
    // Block link-local
    if (/^169\.254\./.test(host)) return false;
    // Block cloud metadata endpoints
    if (host === "metadata.google.internal" || host === "169.254.169.254") return false;
    // Block .local
    if (host.endsWith(".local") || host.endsWith(".internal")) return false;
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// CONTENT HASHING (SHA-256 via Web Crypto API)
// ============================================================
async function sha256Hash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================================
// WEB SEARCH ADAPTER (uses Tavily if configured)
// ============================================================
async function searchWeb(query: string, maxResults: number): Promise<UnifiedResult[]> {
  const tavilyKey = Deno.env.get("TAVILY_API_KEY");
  if (!tavilyKey) {
    console.log("Web search: TAVILY_API_KEY not configured");
    return [];
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tavilyKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: "basic",
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`Web search failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const results = data.results || [];

    return results
      .filter((r: { url?: string }) => r.url && isUrlSafe(r.url))
      .map((r: { title: string; url: string; content: string; published_date?: string; author?: string }) => ({
        source_name: "الويب",
        source_type: "web" as const,
        title: r.title || "بدون عنوان",
        url: r.url,
        excerpt: (r.content || "").substring(0, 500),
        published_at: r.published_date || null,
        author: r.author || null,
        raw_metadata: { provider: "tavily" },
        collection_status: "collected" as const,
      }));
  } catch (err) {
    console.error("Web search error:", err);
    return [];
  }
}

// ============================================================
// GITHUB ADAPTER (uses GitHub Search API)
// ============================================================
async function searchGitHub(query: string, maxResults: number): Promise<UnifiedResult[]> {
  const githubToken = Deno.env.get("GITHUB_TOKEN");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "OUR-AI-RESEARCH/1.0",
    };
    if (githubToken) {
      headers["Authorization"] = `Bearer ${githubToken}`;
    }

    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(
      `https://api.github.com/search/repositories?q=${encodedQuery}&sort=stars&order=desc&per_page=${Math.min(maxResults, 30)}`,
      { headers, signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status === 403) {
        console.log("GitHub API rate limited");
      }
      console.error(`GitHub search failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const items = (data.items || []).slice(0, maxResults);

    return items.map((item: {
      full_name: string;
      html_url: string;
      description: string | null;
      created_at: string;
      updated_at: string;
      stargazers_count: number;
      language: string | null;
      owner: { login: string } | null;
    }) => ({
      source_name: "GitHub",
      source_type: "repo" as const,
      title: item.full_name || "بدون اسم",
      url: item.html_url,
      excerpt: item.description || "مستودع بدون وصف",
      published_at: item.created_at || null,
      author: item.owner?.login || null,
      raw_metadata: {
        stars: item.stargazers_count,
        language: item.language,
        updated_at: item.updated_at,
      },
      collection_status: "collected" as const,
    }));
  } catch (err) {
    console.error("GitHub search error:", err);
    return [];
  }
}

// ============================================================
// YOUTUBE ADAPTER (uses YouTube Data API v3 if configured)
// ============================================================
async function searchYouTube(query: string, maxResults: number): Promise<UnifiedResult[]> {
  const youtubeKey = Deno.env.get("YOUTUBE_API_KEY");
  if (!youtubeKey) {
    console.log("YouTube search: YOUTUBE_API_KEY not configured");
    return [];
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodedQuery}&type=video&maxResults=${Math.min(maxResults, 25)}&key=${youtubeKey}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`YouTube search failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const items = data.items || [];

    return items
      .filter((item: { id?: { videoId?: string } }) => item.id?.videoId)
      .map((item: {
        id: { videoId: string };
        snippet: {
          title: string;
          description: string;
          publishedAt: string;
          channelTitle: string;
          thumbnails: { default?: { url: string } };
        };
      }) => ({
        source_name: "YouTube",
        source_type: "video" as const,
        title: item.snippet.title || "فيديو بدون عنوان",
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        excerpt: (item.snippet.description || "").substring(0, 500),
        published_at: item.snippet.publishedAt || null,
        author: item.snippet.channelTitle || null,
        raw_metadata: {
          videoId: item.id.videoId,
          thumbnail: item.snippet.thumbnails?.default?.url || null,
        },
        collection_status: "collected" as const,
      }));
  } catch (err) {
    console.error("YouTube search error:", err);
    return [];
  }
}

// ============================================================
// EVIDENCE NORMALIZATION & DEDUPLICATION
// ============================================================
async function deduplicateEvidence(
  jobId: string,
  results: UnifiedResult[]
): Promise<{ id: string; source_type: string; title: string; url: string; excerpt: string; source_name: string }[]> {
  const inserted: { id: string; source_type: string; title: string; url: string; excerpt: string; source_name: string }[] = [];
  const seenHashes = new Set<string>();

  for (const result of results) {
    // Normalize content before hashing: URL + title
    const hashInput = `${result.url}|${result.title}`.trim().toLowerCase();
    const contentHash = await sha256Hash(hashInput);

    if (seenHashes.has(contentHash)) continue;

    // Check DB for existing hash in this research job
    const { data: existing } = await supabase
      .from("evidence_items")
      .select("id")
      .eq("research_job_id", jobId)
      .eq("content_hash", contentHash)
      .maybeSingle();

    if (existing) {
      seenHashes.add(contentHash);
      continue;
    }

    seenHashes.add(contentHash);

    const { data, error } = await supabase
      .from("evidence_items")
      .insert({
        research_job_id: jobId,
        title: result.title,
        url: result.url,
        source_type: result.source_type,
        excerpt: result.excerpt,
        published_at: result.published_at,
        retrieved_at: new Date().toISOString(),
        author: result.author,
        content_hash: contentHash,
        reliability_notes: result.source_type === "video"
          ? "محتوى مرئي — قد يكون تعليمياً أو ترويجياً، لا يُعد دليلاً على الطلب التجاري"
          : null,
        collection_status: result.collection_status,
      })
      .select("id, source_type, title, url, excerpt, source_name")
      .single();

    if (!error && data) {
      inserted.push({
        id: data.id,
        source_type: data.source_type,
        title: data.title,
        url: data.url || "",
        excerpt: data.excerpt || "",
        source_name: result.source_name,
      });
    }
  }

  return inserted;
}

// ============================================================
// CLAIM EXTRACTION & ANALYSIS ENGINE
// Replaces template claims with evidence-based analysis
// ============================================================
function analyzeEvidence(
  evidence: { id: string; source_type: string; title: string; excerpt: string; source_name: string }[],
  query: string
): ClaimData[] {
  const claims: ClaimData[] = [];
  if (evidence.length === 0) return claims;

  // Group evidence by source type
  const webEvidence = evidence.filter((e) => e.source_type === "web");
  const repoEvidence = evidence.filter((e) => e.source_type === "repo");
  const videoEvidence = evidence.filter((e) => e.source_type === "video");

  // Claim 1: Topic visibility on the web
  if (webEvidence.length > 0) {
    const supportingIds = webEvidence.map((e) => e.id);
    const isHigh = webEvidence.length >= 5;
    claims.push({
      claim_text: `يوجد محتوى منشور على الويب يتعلق بـ«${query.substring(0, 60)}» (${webEvidence.length} مصدر)، مما يشير إلى وجود اهتمام عام بالموضوع.`,
      claim_type: "observational",
      confidence_level: isHigh ? "high" : "medium",
      verification_status: "verified",
      reasoning_summary: `تم العثور على ${webEvidence.length} مصدراً ويب تحتوي على محتوى ذو صلة مباشرة بموضوع البحث. هذه المصادر منشورة على مواقع مختلفة، مما يدعم وجود نقاش عام.`,
      uncertainty_notes: "وجود محتوى لا يعني بالضرورة وجود طلب تجاري أو جدوى استثمارية. المصادر قد تكون تعليمية أو ترويجية.",
      supporting_evidence_ids: supportingIds,
      contradicting_evidence_ids: [],
    });
  }

  // Claim 2: Technical activity on GitHub
  if (repoEvidence.length > 0) {
    const supportingIds = repoEvidence.map((e) => e.id);
    const isHigh = repoEvidence.length >= 3;
    claims.push({
      claim_text: `توجد ${repoEvidence.length} مستودع برمجية على GitHub مرتبطة بالموضوع، مما يشير إلى وجود نشاط تقني مفتوح المصدر.`,
      claim_type: "technical",
      confidence_level: isHigh ? "high" : "medium",
      verification_status: "verified",
      reasoning_summary: `تم العثور على ${repoEvidence.length} مستودعاً على GitHub عبر البحث الرسمي في واجهة برمجة التطبيقات. وجود مستودعات مفتوحة المصدر يدعم وجود نشاط تقني فعلي في المجال.`,
      uncertainty_notes: "عدد المستودعات لا يعني جودتها أو قابلية استخدامها. بعضها قد يكون مهجوراً أو تجريبياً.",
      supporting_evidence_ids: supportingIds,
      contradicting_evidence_ids: [],
    });
  }

  // Claim 3: Video content availability
  if (videoEvidence.length > 0) {
    const supportingIds = videoEvidence.map((e) => e.id);
    claims.push({
      claim_text: `يوجد ${videoEvidence.length} محتوى مرئي على YouTube يتناول الموضوع، مما قد يشير إلى اهتمام جماهري.`,
      claim_type: "observational",
      confidence_level: "low",
      verification_status: "partially_supported",
      reasoning_summary: `تم العثور على ${videoEvidence.length} فيديو على YouTube عبر واجهة برمجة التطبيقات الرسمية. وجود محتوى مرئي يشير إلى وجود اهتمام، لكنه لا يُعد دليلاً على الطلب التجاري.`,
      uncertainty_notes: "عدد المشاهدات والإعجابات لا يُعد دليلاً على الطلب التجاري. المحتوى المرئي قد يكون تعليمياً مجانياً أو ترويجياً.",
      supporting_evidence_ids: supportingIds,
      contradicting_evidence_ids: [],
    });
  }

  // Claim 4: Evidence sufficiency assessment
  if (evidence.length >= 6) {
    claims.push({
      claim_text: "حجم الأدلة المتاحة (6 مصادر أو أكثر) يشير إلى أن الموضوع قابل للدراسة الأولية، لكن جودة الأدلة تحتاج تحقق أعمق قبل اتخاذ قرارات جوهرية.",
      claim_type: "meta_assessment",
      confidence_level: "medium",
      verification_status: "verified",
      reasoning_summary: `إجمالي المصادر ${evidence.length} موزعة على أنواع مختلفة (ويب: ${webEvidence.length}، GitHub: ${repoEvidence.length}، YouTube: ${videoEvidence.length}). التنوع يدعم قابلية الدراسة، لكن عدم توفر بيانات سوقية كمية يحد من الثقة.`,
      uncertainty_notes: "الكمية لا تعني الجودة. لم يتم تحليل محتوى كل مصدر بالعمق المطلوب لتقييم الموثوقية الفردية.",
      supporting_evidence_ids: evidence.slice(0, 6).map((e) => e.id),
      contradicting_evidence_ids: [],
    });
  } else if (evidence.length > 0 && evidence.length < 6) {
    claims.push({
      claim_text: "المصادر المتاحة محدودة، والاستنتاجات يجب أن تُؤخذ بحذر. لا تكفي للأحكام النهائية.",
      claim_type: "meta_assessment",
      confidence_level: "low",
      verification_status: "unverified",
      reasoning_summary: `إجمالي المصادر ${evidence.length} فقط، وهو عدد منخفض. الاستنتاجات المستندة إلى هذا الحجم لا يمكن اعتبارها موثوقة.`,
      uncertainty_notes: "نقص المصادر قد يكون بسبب قصور في البحث أو عدم وجود محتوى كافٍ عن الموضوع.",
      supporting_evidence_ids: evidence.map((e) => e.id),
      contradicting_evidence_ids: [],
    });
  }

  // Claim 5: Cross-source corroboration / conflict detection
  const sourceTypesPresent = [webEvidence.length > 0, repoEvidence.length > 0, videoEvidence.length > 0].filter(Boolean).length;
  if (sourceTypesPresent >= 2 && evidence.length > 4) {
    claims.push({
      claim_text: "وجود مصادر متعددة الأنواع (ويب ومستودعات و/أو فيديو) يشير إلى وجود اهتمام متعدد الأوجه بالموضوع، لكن قد يشير أيضاً إلى وجهات نظر مختلفة لم تُتحقق بعد.",
      claim_type: "meta_assessment",
      confidence_level: "medium",
      verification_status: "partially_supported",
      reasoning_summary: `المصادر موزعة على ${sourceTypesPresent} أنواع مختلفة. هذا التنوع قد يعني تأكيداً متبادلاً أو وجهات نظر مختلفة. لم يتم تحليل التعارضات المحتملة في المحتوى بدقة.`,
      uncertainty_notes: "تحليل التعارضات يتطلب قراءة كاملة للمحتوى ومقارنة دقيقة بين الادعاءات. هذا البحث الأولي يكتفي بالإشارة إلى الإمكانية.",
      supporting_evidence_ids: evidence.slice(0, 4).map((e) => e.id),
      contradicting_evidence_ids: [],
    });
  }

  return claims;
}

// ============================================================
// REPORT GENERATION
// ============================================================
function generateReport(
  job: { title: string; original_query: string; scope: string | null; depth: string; created_at: string },
  evidence: { id: string; source_type: string; title: string; url: string; excerpt: string; source_name: string }[],
  claims: ClaimData[],
  sourceResults: { name: string; status: string; count: number; error?: string }[]
) {
  const webEvidence = evidence.filter((e) => e.source_type === "web");
  const repoEvidence = evidence.filter((e) => e.source_type === "repo");
  const videoEvidence = evidence.filter((e) => e.source_type === "video");

  const isCommercial = /سوق|تجاري|شركة|منتج|خدمة|اكتتاب|تأمين|saas|منصة|تطبيق/i.test(job.original_query);
  const isTechnical = /تقني|برمج|كود|تقنية|api|ذكاء|نموذج|خوارزمية|بيانات/i.test(job.original_query);

  const verifiedClaims = claims.filter((c) => c.verification_status === "verified");
  const partialClaims = claims.filter((c) => c.verification_status === "partially_supported");
  const conflictedClaims = claims.filter((c) => c.verification_status === "contradicted");
  const unverifiedClaims = claims.filter((c) => c.verification_status === "unverified");

  const executiveSummary = `يقدم هذا التقرير نتائج البحث حول: «${job.original_query}».
تم جمع ${evidence.length} مصدراً موزعة على: ${webEvidence.length} من الويب، ${repoEvidence.length} من مستودعات GitHub، ${videoEvidence.length} من يوتيوب.
عمق البحث: ${job.depth === "deep" ? "متعمق" : "سريع"}${job.scope ? `، النطاق: ${job.scope}` : ""}.
تم استخراج ${claims.length} ادعاءً تحليلياً: ${verifiedClaims.length} موثق، ${partialClaims.length} مدعوم جزئياً، ${conflictedClaims.length} متعارض، ${unverifiedClaims.length} غير متحقق.
${sourceResults.filter((s) => s.status === "failed").length > 0 ? `${sourceResults.filter((s) => s.status === "failed").length} مصدر فشل من أصل ${sourceResults.length}.` : ""}
${evidence.length === 0 ? "لم يتم العثور على مصادر كافية، والنتائج يجب أن تُؤخذ بحذر شديد." : ""}
${unverifiedClaims.length > verifiedClaims.length ? "معظم الادعاءات لم تتحقق بعد، مما يتطلب بحثاً إضافياً." : ""}`;

  const keyFindings = claims.map((c) => ({
    finding: c.claim_text,
    verificationStatus: c.verification_status,
    confidenceLevel: c.confidence_level,
    reasoning: c.reasoning_summary,
    evidenceCount: c.supporting_evidence_ids.length,
  }));

  const report = {
    executiveSummary,
    researchQuestion: job.original_query,
    scope: job.scope || "لم يُحدد نطاق جغرافي أو سوقي محدد.",
    keyFindings: keyFindings.length > 0 ? keyFindings : [{ finding: "لم يتم العثور على أدلة كافية للوصول إلى استنتاجات واضحة.", verificationStatus: "unverified", confidenceLevel: "unverified", reasoning: "لا توجد أدلة كافية.", evidenceCount: 0 }],
    evidenceAndSources: evidence.map((e) => ({
      title: e.title,
      url: e.url,
      type: e.source_type,
      excerpt: e.excerpt,
      retrievedAt: new Date().toISOString(),
    })),
    marketAnalysis: isCommercial
      ? generateMarketAnalysis(job.original_query, webEvidence, repoEvidence)
      : "لا ينطبق — الموضوع ليس تجارياً بصورة مباشرة.",
    competitors: isCommercial
      ? generateCompetitors(webEvidence)
      : "لا ينطبق — الموضوع ليس تجارياً بصورة مباشرة.",
    technicalAnalysis: isTechnical
      ? generateTechnicalAnalysis(job.original_query, repoEvidence)
      : "لا ينطبق — الموضوع ليس تقنياً بصورة مباشرة.",
    opportunities: generateOpportunities(evidence),
    risks: generateRisks(evidence),
    recommendations: generateRecommendations(evidence, claims),
    decisionOptions: generateDecisionOptions(evidence),
    unknowns: generateUnknowns(evidence, sourceResults),
    sources: evidence.map((e) => ({
      title: e.title,
      url: e.url,
      type: e.source_type,
      retrievedAt: new Date().toISOString(),
      author: null,
    })),
    sourceRuns: sourceResults,
    claimsAnalysis: claims.map((c) => ({
      text: c.claim_text,
      verificationStatus: c.verification_status,
      confidenceLevel: c.confidence_level,
      reasoning: c.reasoning_summary,
      uncertainty: c.uncertainty_notes,
      supportingCount: c.supporting_evidence_ids.length,
      contradictingCount: c.contradicting_evidence_ids.length,
    })),
  };

  return report;
}

function generateMarketAnalysis(query: string, web: { length: number }, repo: { length: number }): string {
  if (web.length === 0 && repo.length === 0) {
    return "لم يتم العثور على مصادر كافية لتحليل السوق. الأدلة غير كافية.";
  }
  const points: string[] = [];
  if (web.length > 0) {
    points.push(`تم العثور على ${web.length} مصدراً من الويب تتعلق بالموضوع، مما يشير إلى وجود نقاش عام.`);
  }
  if (repo.length > 0) {
    points.push(`تم العثور على ${repo.length} مستودعاً على GitHub، مما يشير إلى وجود نشاط تقني في هذا المجال.`);
  }
  points.push("حجم السوق الدقيق يتطلب دراسة استقصائية أعمق من مصادر متخصصة، ولم تتوفر بيانات كمية مباشرة في هذا البحث.");
  points.push("يجب التعامل مع هذه النتائج كمؤشرات أولية وليس كتحليل سوقي نهائي.");
  return points.join("\n\n");
}

function generateCompetitors(web: { title: string }[]): string {
  if (web.length === 0) {
    return "لم يتم العثور على مصادر كافية لتحديد المنافسين. الأدلة غير كافية.";
  }
  const titles = web.slice(0, 5).map((e) => `- ${e.title}`).join("\n");
  return `بناءً على نتائج البحث الأولية، تم العثور على محتوى قد يشير إلى جهات فاعلة في المجال:\n${titles}\n\nتنبيه: هذا ليس تحليلاً تنافسياً كاملاً، بل قائمة أولية تحتاج تحقق أعمق.`;
}

function generateTechnicalAnalysis(query: string, repo: { title: string; url: string }[]): string {
  if (repo.length === 0) {
    return "لم يتم العثور على مستودعات برمجية كافية للتحليل التقني. الأدلة غير كافية.";
  }
  const repos = repo.slice(0, 5).map((e) => `- ${e.title}${e.url ? ` (${e.url})` : ""}`).join("\n");
  return `تم العثور على المستودعات التالية المرتبطة بالموضوع:\n${repos}\n\nوجود مستودعات مفتوحة المصدر يشير إلى أن هناك نشاطاً تقنياً، لكن تقييم جودة الكود وقابلية إعادة الاستخدام يحتاج فحصاً أعمق.`;
}

function generateOpportunities(evidence: { source_type: string; length: number }[]): string[] {
  const ops: string[] = [];
  const total = evidence.length;
  if (total >= 5) {
    ops.push("وجود عدد معقول من المصادر يشير إلى أن الموضوع محل اهتمام، مما يفتح فرصاً للتميز عن طريق تقديم محتوى أو خدمة عالية الجودة.");
  }
  if (evidence.filter((e) => e.source_type === "repo").length > 0) {
    ops.push("وجود مستودعات مفتوحة المصدر قد يوفر أساساً تقنياً يمكن البناء عليه بدلاً من البدء من الصفر.");
  }
  if (evidence.filter((e) => e.source_type === "video").length > 0) {
    ops.push("وجود محتوى مرئي يشير إلى طلب على الشرح المرئي، مما يفتح فرصاً للمحتوى التعليمي.");
  }
  if (total < 3) {
    ops.push("النقص في المصادر المتاحة قد يكون فرصة — المجال غير مشبع بالمحتوى.");
  }
  ops.push("إمكانية التميز بتقديم تحليل عربي متعمق في مجال قد تكون معظم مصادره باللغة الإنجليزية.");
  return ops;
}

function generateRisks(evidence: { source_type: string; length: number }[]): { risk: string; severity: "high" | "medium" | "low"; mitigation: string }[] {
  const risks: { risk: string; severity: "high" | "medium" | "low"; mitigation: string }[] = [];
  const total = evidence.length;
  if (total < 3) {
    risks.push({ risk: "نقص في المصادر المتاحة، مما يجعل الاستنتاجات غير موثوقة.", severity: "high", mitigation: "توسيع نطاق البحث واستخدام مصادر متخصصة إضافية قبل اتخاذ أي قرار." });
  }
  risks.push({ risk: "المصادر المتاحة قد تكون قديمة أو غير محدثة، مما يؤثر على دقة المعلومات.", severity: "medium", mitigation: "التحقق من تواريخ النشر والبحث عن مصادر حديثة قبل الاعتماد على النتائج." });
  risks.push({ risk: "وجود تحيز في المصادر المتاحة (مثلاً: مصادر تجارية تروج لمنتجات).", severity: "medium", mitigation: "مراجعة المصادر بشكل نقدي والبحث عن آراء متعارضة." });
  if (evidence.filter((e) => e.source_type === "video").length > 0) {
    risks.push({ risk: "محتوى يوتيوب قد يكون تعليمياً/ترويجياً وليس تحليلياً، ولا يُعد دليلاً على الطلب التجاري.", severity: "low", mitigation: "عدم الاعتماد على عدد المشاهدات كمؤشر تجاري، والبحث عن بيانات سوقية فعلية." });
  }
  risks.push({ risk: "عدم توفر بيانات سوقية كمية (حجم السوق، معدلات النمو) في هذا البحث.", severity: "medium", mitigation: "اللجوء إلى مصادر متخصصة (تقارير سوقية، إحصاءات رسمية) قبل اتخاذ قرارات استثمارية." });
  return risks;
}

function generateRecommendations(evidence: { source_type: string; length: number }[], claims: { verification_status: string }[]): string[] {
  const recs: string[] = [];
  const total = evidence.length;
  const unverifiedCount = claims.filter((c) => c.verification_status === "unverified").length;
  if (total >= 5) {
    recs.push("الموضوع يستحق دراسة أعمق — يوجد أساس معرفي كافٍ للبناء عليه.");
  } else {
    recs.push("يُنصح بجمع مصادر إضافية قبل اتخاذ أي قرار جوهري — الأدلة الحالية محدودة.");
  }
  recs.push("إجراء بحث ميداني أو استطلاع رأي للتحقق من الطلب الفعلي قبل الاستثمار.");
  if (evidence.filter((e) => e.source_type === "repo").length > 0) {
    recs.push("مراجعة المستودعات المفتوحة المصدر المتاحة لتقييم إمكانية الاستفادة منها تقنياً.");
  }
  recs.push("تحديد جمهور مستهدف واضح واختبار الفرضيات مع عينة صغيرة قبل التوسع.");
  if (unverifiedCount > 0) {
    recs.push(`التحقق من ${unverifiedCount} ادعاءً غير موثق قبل الاعتماد عليها في القرار.`);
  }
  return recs;
}

function generateUnknowns(evidence: { source_type: string; length: number }[], sourceResults: { name: string; status: string }[]): string[] {
  const unknowns: string[] = [
    "حجم السوق الفعلي بالأرقام لم يُحدد في هذا البحث.",
    "الوضع التنظيمي والقانوني للموضوع في الأسواق المستهدفة غير معروف من المصادر المتاحة.",
    "تكلفة الدخول إلى السوق والمدة الزمنية المتوقعة غير محددة.",
    "لم يتم تحليل سلوك المستخدم الفعلي أو رضاه عن الحلول الحالية.",
  ];
  if (evidence.filter((e) => e.source_type === "web").length < 3) {
    unknowns.push("المعلومات من مصادر الويب محدودة، وقد تكون هناك نقاط مهمة لم تُغطَّ.");
  }
  const failedSources = sourceResults.filter((s) => s.status === "failed");
  if (failedSources.length > 0) {
    unknowns.push(`فشل جمع البيانات من: ${failedSources.map((s) => s.name).join("، ")}. قد تكون هناك معلومات مهمة من هذه المصادر لم تُجمع.`);
  }
  unknowns.push("جودة وحداثة المصادر المتاحة لم تُتحقق بالكامل — بعضها قد يكون قديماً أو منحازاً.");
  return unknowns;
}

function generateDecisionOptions(evidence: { source_type: string; length: number }[]): { title: string; rationale: string; confidence: "high" | "medium" | "low" | "unverified" }[] {
  const total = evidence.length;
  const options: { title: string; rationale: string; confidence: "high" | "medium" | "low" | "unverified" }[] = [];
  if (total >= 5) {
    options.push({ title: "المضي قدماً بدراسة جدوى تفصيلية", rationale: "الأساس المعرفي المتوفر كافٍ للمضي قدماً بدراسة أعمق، مع الحاجة لجمع بيانات سوقية كمية.", confidence: "medium" });
  } else {
    options.push({ title: "تأجيل القرار وجمع معلومات إضافية", rationale: "الأدلة المتاحة غير كافية لاتخاذ قرار مدروس. يُنصح بتوسيع البحث قبل الالتزام.", confidence: "high" });
  }
  options.push({ title: "إجراء اختبار سوقي صغير (MVP)", rationale: "بدلاً من الاستثمار الكامل، يمكن اختبار الفكرة بعينة صغيرة للتحقق من الطلب الفعلي قبل التوسع.", confidence: total >= 3 ? "medium" : "low" });
  options.push({ title: "الشراكة أو الاستحواذ", rationale: "إذا وجدت حلول قائمة (مستودعات مفتوحة المصدر أو منتجات)، قد تكون الشراكة أسرع وأقل تكلفة من البناء من الصفر.", confidence: evidence.filter((e) => e.source_type === "repo").length > 0 ? "medium" : "low" });
  return options;
}

// ============================================================
// PIPELINE ORCHESTRATOR
// ============================================================
async function runPipeline(jobId: string, query: string, scope: string | null, depth: "quick" | "deep") {
  const numPerSource = depth === "deep" ? 8 : 5;
  const sourceResults: { name: string; status: string; count: number; error?: string }[] = [];

  // Stage 1: Planning
  await supabase.from("research_jobs").update({ status: "planning", current_stage: 1, progress_percent: 5 }).eq("id", jobId);

  const questions = generateSubQuestions(query, depth === "deep" ? 6 : 4);
  await supabase.from("research_questions").insert(
    questions.map((q, i) => ({
      research_job_id: jobId,
      question: q,
      priority: i + 1,
      status: "active",
    }))
  );
  await supabase.from("research_jobs").update({ progress_percent: 15 }).eq("id", jobId);

  // Stage 2: Collecting from independent sources
  await supabase.from("research_jobs").update({ status: "collecting", current_stage: 2, progress_percent: 20 }).eq("id", jobId);

  // Create source run records
  const channels = [
    { name: "الويب", action: "web_search", collector: () => searchWeb(query, numPerSource) },
    { name: "GitHub", action: "github_search", collector: () => searchGitHub(query, numPerSource) },
    { name: "YouTube", action: "youtube_search", collector: () => searchYouTube(query, numPerSource) },
  ];

  const allResults: UnifiedResult[] = [];

  // Run all source collectors in parallel
  const collectionResults = await Promise.allSettled(
    channels.map(async (channel) => {
      // Create source run
      const { data: run } = await supabase
        .from("source_runs")
        .insert({
          research_job_id: jobId,
          source_name: channel.name,
          action_name: channel.action,
          status: "running",
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      const runId = run?.id;

      try {
        const results = await channel.collector();

        if (results.length === 0) {
          if (runId) {
            await supabase.from("source_runs").update({
              status: "failed",
              completed_at: new Date().toISOString(),
              result_count: 0,
              error_message: "لم يتم العثور على نتائج أو الخدمة غير مهيأة",
            }).eq("id", runId);
          }
          return { name: channel.name, status: "failed", count: 0, error: "no results", results: [] as UnifiedResult[] };
        }

        if (runId) {
          await supabase.from("source_runs").update({
            status: "success",
            completed_at: new Date().toISOString(),
            result_count: results.length,
          }).eq("id", runId);
        }

        return { name: channel.name, status: "success", count: results.length, error: undefined, results };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "خطأ غير معروف";
        if (runId) {
          await supabase.from("source_runs").update({
            status: "failed",
            completed_at: new Date().toISOString(),
            result_count: 0,
            error_message: errorMsg,
          }).eq("id", runId);
        }
        return { name: channel.name, status: "failed", count: 0, error: errorMsg, results: [] as UnifiedResult[] };
      }
    })
  );

  for (const result of collectionResults) {
    if (result.status === "fulfilled") {
      sourceResults.push({ name: result.value.name, status: result.value.status, count: result.value.count, error: result.value.error });
      allResults.push(...result.value.results);
    } else {
      sourceResults.push({ name: "unknown", status: "failed", count: 0, error: result.reason?.message || "rejected" });
    }
  }

  await supabase.from("research_jobs").update({ progress_percent: 50 }).eq("id", jobId);

  // Stage 3: Evidence normalization & deduplication
  await supabase.from("research_jobs").update({ status: "analyzing", current_stage: 3, progress_percent: 55 }).eq("id", jobId);
  const evidence = await deduplicateEvidence(jobId, allResults);
  await supabase.from("research_jobs").update({ progress_percent: 70 }).eq("id", jobId);

  // Check cancellation
  const { data: jobCheck } = await supabase.from("research_jobs").select("cancelled").eq("id", jobId).maybeSingle();
  if (jobCheck?.cancelled) {
    await supabase.from("research_jobs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_summary: "cancelled by user",
    }).eq("id", jobId);
    return;
  }

  // Stage 4: Claim extraction & verification
  await supabase.from("research_jobs").update({ status: "verifying", current_stage: 4, progress_percent: 75 }).eq("id", jobId);
  const claims = analyzeEvidence(evidence, query);

  // Insert claims and link evidence
  for (const claim of claims) {
    const { data: claimRow } = await supabase.from("claims").insert({
      research_job_id: jobId,
      claim_text: claim.claim_text,
      claim_type: claim.claim_type,
      confidence_level: claim.confidence_level,
      verification_status: claim.verification_status,
      reasoning_summary: claim.reasoning_summary,
      uncertainty_notes: claim.uncertainty_notes,
    }).select().single();

    if (claimRow) {
      // Link supporting evidence
      for (const evidenceId of claim.supporting_evidence_ids) {
        await supabase.from("claim_evidence").insert({
          claim_id: claimRow.id,
          evidence_item_id: evidenceId,
          relation_type: "supports",
        });
      }
      // Link contradicting evidence
      for (const evidenceId of claim.contradicting_evidence_ids) {
        await supabase.from("claim_evidence").insert({
          claim_id: claimRow.id,
          evidence_item_id: evidenceId,
          relation_type: "contradicts",
        });
      }
    }
  }
  await supabase.from("research_jobs").update({ progress_percent: 85 }).eq("id", jobId);

  // Stage 5: Report generation
  await supabase.from("research_jobs").update({ status: "reporting", current_stage: 5, progress_percent: 90 }).eq("id", jobId);

  const { data: jobData } = await supabase.from("research_jobs").select("*").eq("id", jobId).single();
  if (!jobData) throw new Error("Job not found");

  const report = generateReport(jobData, evidence, claims, sourceResults);

  await supabase.from("reports").insert({
    research_job_id: jobId,
    report_version: 1,
    report_content: report,
  });

  // Insert decision options
  for (const opt of report.decisionOptions) {
    await supabase.from("decision_options").insert({
      research_job_id: jobId,
      option_title: opt.title,
      rationale: opt.rationale,
      confidence_level: opt.confidence,
    });
  }

  // Determine final status
  const failedSources = sourceResults.filter((s) => s.status === "failed").length;
  const finalStatus = evidence.length === 0 ? "partial" : failedSources > 0 && failedSources < sourceResults.length ? "partial" : "completed";

  await supabase.from("research_jobs").update({
    status: finalStatus,
    current_stage: 5,
    progress_percent: 100,
    completed_at: new Date().toISOString(),
    error_summary: failedSources > 0 ? `${failedSources} مصدر فشل من أصل ${sourceResults.length}` : null,
  }).eq("id", jobId);
}

function generateSubQuestions(query: string, count: number): string[] {
  const base = [
    `ما هو الوضع الحالي لمجال: ${query}؟`,
    `ما حجم السوق والفرص المتاحة في: ${query}؟`,
    `من هم المنافسون الرئيسيون في: ${query}؟`,
    `ما المخاطر والتحديات المرتبطة بـ: ${query}؟`,
    `ما المتطلبات التقنية لتطبيق: ${query}؟`,
    `ما التوصيات العملية للبدء في: ${query}؟`,
  ];
  return base.slice(0, count);
}

// ============================================================
// MAIN HANDLER
// ============================================================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: ResearchRequest = await req.json();

    // Validate input
    if (!body.query || body.query.trim().length < 3) {
      return new Response(JSON.stringify({ error: "Query must be at least 3 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const depth = body.depth === "deep" ? "deep" : "quick";
    const scope = body.scope?.trim() || null;
    const language = body.language || "ar";
    const title = body.query.trim().substring(0, 80);

    // Create job via SECURITY DEFINER function
    const { data: job, error: jobError } = await supabase.rpc("create_research_job", {
      p_title: title,
      p_original_query: body.query.trim(),
      p_scope: scope,
      p_language: language,
      p_depth: depth,
    });

    if (jobError || !job) {
      return new Response(JSON.stringify({ error: "Failed to create research job" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jobId = job.id;

    // Run pipeline in background (EdgeRuntime.waitUntil keeps it alive)
    EdgeRuntime.waitUntil(runPipeline(jobId, body.query.trim(), scope, depth));

    return new Response(JSON.stringify({ jobId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("Orchestrator error:", message);
    return new Response(JSON.stringify({ error: "An error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
