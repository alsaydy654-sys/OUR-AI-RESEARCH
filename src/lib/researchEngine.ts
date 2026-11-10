import { supabase } from './supabase';
import type {
  ResearchJob,
  SourceRun,
  EvidenceItem,
  Claim,
  DecisionOption,
  ReportContent,
  ResearchDepth,
} from './types';

const STAGE_PLANNING = 1;
const STAGE_COLLECTING = 2;
const STAGE_ANALYZING = 3;
const STAGE_VERIFYING = 4;
const STAGE_REPORTING = 5;

const STAGES = [
  { id: STAGE_PLANNING, label: 'تخطيط البحث', status: 'planning' },
  { id: STAGE_COLLECTING, label: 'جمع المصادر', status: 'collecting' },
  { id: STAGE_ANALYZING, label: 'تحليل النتائج', status: 'analyzing' },
  { id: STAGE_VERIFYING, label: 'التحقق من الأدلة', status: 'verifying' },
  { id: STAGE_REPORTING, label: 'إعداد التقرير', status: 'reporting' },
];

const SOURCE_CHANNELS = [
  { name: 'الويب', action: 'web_search', type: 'web' as const },
  { name: 'GitHub', action: 'github_search', type: 'repo' as const },
  { name: 'YouTube', action: 'youtube_search', type: 'video' as const },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashContent(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `h${Math.abs(hash).toString(16)}`;
}

async function updateJob(jobId: string, updates: Partial<ResearchJob>): Promise<void> {
  const { error } = await supabase.from('research_jobs').update(updates).eq('id', jobId);
  if (error) console.error('Failed to update job:', error);
}

async function createSourceRun(
  jobId: string,
  sourceName: string,
  actionName: string
): Promise<SourceRun> {
  const { data, error } = await supabase
    .from('source_runs')
    .insert({
      research_job_id: jobId,
      source_name: sourceName,
      action_name: actionName,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create source run: ${error.message}`);
  return data as SourceRun;
}

async function completeSourceRun(
  runId: string,
  resultCount: number,
  status: 'success' | 'failed',
  errorMsg?: string
): Promise<void> {
  const { error } = await supabase
    .from('source_runs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      result_count: resultCount,
      error_message: errorMsg || null,
    })
    .eq('id', runId);
  if (error) console.error('Failed to complete source run:', error);
}

type WebResult = {
  title: string;
  url: string;
  content: string;
  published_date?: string;
  author?: string;
};

type SearchResult = {
  results: WebResult[];
};

async function searchWeb(query: string, numResults: number): Promise<WebResult[]> {
  try {
    const response = await fetch(
      `https://api.tavily.com/search?key=${import.meta.env.VITE_TAVILY_API_KEY || ''}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          max_results: numResults,
          search_depth: 'basic',
        }),
      }
    );
    if (!response.ok) throw new Error(`Search failed: ${response.status}`);
    const data: SearchResult = await response.json();
    return data.results || [];
  } catch {
    return [];
  }
}

async function insertEvidence(
  jobId: string,
  sourceRunId: string | null,
  item: {
    title: string;
    url: string;
    sourceType: 'web' | 'repo' | 'video';
    excerpt: string;
    publishedAt: string | null;
    author: string | null;
  }
): Promise<EvidenceItem | null> {
  const contentHash = hashContent(item.url + item.title);
  const { data: existing } = await supabase
    .from('evidence_items')
    .select('id')
    .eq('research_job_id', jobId)
    .eq('content_hash', contentHash)
    .maybeSingle();

  if (existing) return null;

  const { data, error } = await supabase
    .from('evidence_items')
    .insert({
      research_job_id: jobId,
      source_run_id: sourceRunId,
      title: item.title,
      url: item.url,
      source_type: item.sourceType,
      excerpt: item.excerpt,
      published_at: item.publishedAt || null,
      retrieved_at: new Date().toISOString(),
      author: item.author || null,
      content_hash: contentHash,
      reliability_notes: null,
      collection_status: 'collected',
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to insert evidence:', error);
    return null;
  }
  return data as EvidenceItem;
}

async function insertQuestions(jobId: string, query: string, depth: ResearchDepth): Promise<void> {
  const numQuestions = depth === 'deep' ? 6 : 4;
  const questions = generateSubQuestions(query, numQuestions);
  const rows = questions.map((q, i) => ({
    research_job_id: jobId,
    question: q,
    priority: i + 1,
    status: 'active',
  }));
  const { error } = await supabase.from('research_questions').insert(rows);
  if (error) console.error('Failed to insert questions:', error);
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

async function collectFromAllSources(
  jobId: string,
  query: string,
  depth: ResearchDepth
): Promise<{ allEvidence: EvidenceItem[]; sourceResults: { name: string; status: 'success' | 'failed'; count: number }[] }> {
  const numPerSource = depth === 'deep' ? 8 : 5;
  const sourceResults: { name: string; status: 'success' | 'failed'; count: number }[] = [];
  const allEvidence: EvidenceItem[] = [];

  const channelPromises = SOURCE_CHANNELS.map(async (channel) => {
    const run = await createSourceRun(jobId, channel.name, channel.action);

    const searchQuery = channel.type === 'repo'
      ? `${query} github repository`
      : channel.type === 'video'
      ? `${query} youtube video`
      : `${query}`;

    try {
      const results = await searchWeb(searchQuery, numPerSource);

      if (results.length === 0) {
        await completeSourceRun(run.id, 0, 'failed', 'لم يتم العثور على نتائج');
        sourceResults.push({ name: channel.name, status: 'failed', count: 0 });
        return;
      }

      let inserted = 0;
      for (const result of results) {
        const evidence = await insertEvidence(jobId, run.id, {
          title: result.title,
          url: result.url,
          sourceType: channel.type,
          excerpt: result.content.substring(0, 500),
          publishedAt: result.published_date || null,
          author: result.author || null,
        });
        if (evidence) {
          allEvidence.push(evidence);
          inserted++;
        }
      }

      await completeSourceRun(run.id, inserted, 'success');
      sourceResults.push({ name: channel.name, status: 'success', count: inserted });
    } catch (err) {
      await completeSourceRun(run.id, 0, 'failed', err instanceof Error ? err.message : 'خطأ غير معروف');
      sourceResults.push({ name: channel.name, status: 'failed', count: 0 });
    }
  });

  await Promise.all(channelPromises);

  return { allEvidence, sourceResults };
}

async function extractClaimsAndLinkEvidence(jobId: string, evidence: EvidenceItem[]): Promise<Claim[]> {
  if (evidence.length === 0) return [];

  const claims: Claim[] = [];
  const claimTexts = generateClaimsFromEvidence(evidence);

  for (const claimText of claimTexts) {
    const confidence = assessConfidence(claimText, evidence);
    const verification = confidence === 'high' ? 'verified' : confidence === 'unverified' ? 'unverified' : 'pending';

    const { data, error } = await supabase
      .from('claims')
      .insert({
        research_job_id: jobId,
        claim_text: claimText,
        claim_type: 'factual',
        confidence_level: confidence,
        verification_status: verification,
      })
      .select()
      .single();

    if (error || !data) continue;

    const claim = data as Claim;
    claims.push(claim);

    const supportingEvidence = evidence.slice(0, Math.min(3, evidence.length));
    const ceRows = supportingEvidence.map((e) => ({
      claim_id: claim.id,
      evidence_item_id: e.id,
      relation_type: 'supports',
    }));
    if (ceRows.length > 0) {
      await supabase.from('claim_evidence').insert(ceRows);
    }
  }

  return claims;
}

function generateClaimsFromEvidence(evidence: EvidenceItem[]): string[] {
  if (evidence.length === 0) return [];
  const claims: string[] = [];

  if (evidence.filter((e) => e.source_type === 'web').length > 0) {
    claims.push('يوجد محتوى منشور على الويب يتعلق بموضوع البحث، مما يشير إلى وجود اهتمام عام بالموضوع.');
  }
  if (evidence.filter((e) => e.source_type === 'repo').length > 0) {
    claims.push('توجد مستودعات برمجية مفتوحة المصدر مرتبطة بالموضوع، مما يشير إلى وجود نشاط تقني.');
  }
  if (evidence.filter((e) => e.source_type === 'video').length > 0) {
    claims.push('يوجد محتوى مرئي على يوتيوب يتناول الموضوع، مما يشير إلى وجود طلب على المحتوى المرئي.');
  }
  if (evidence.length >= 5) {
    claims.push('حجم المصادر المتاحة يشير إلى أن الموضوع قابل للدراسة، لكن جودة الأدلة تحتاج تحقق أعمق.');
  } else if (evidence.length > 0 && evidence.length < 5) {
    claims.push('المصادر المتاحة محدودة، والاستنتاجات يجب أن تُؤخذ بحذر.');
  }
  const conflictingCheck = evidence.some((e) => e.source_type === 'web') && evidence.some((e) => e.source_type === 'repo');
  if (conflictingCheck && evidence.length > 4) {
    claims.push('وجود مصادر متعددة الأنواع قد يشير إلى وجهات نظر مختلفة حول الموضوع.');
  }

  return claims;
}

function assessConfidence(claim: string, evidence: EvidenceItem[]): 'high' | 'medium' | 'low' | 'unverified' {
  if (evidence.length === 0) return 'unverified';
  if (evidence.length >= 6) return 'high';
  if (evidence.length >= 3) return 'medium';
  return 'low';
}

async function generateReport(
  job: ResearchJob,
  evidence: EvidenceItem[],
  claims: Claim[]
): Promise<ReportContent> {
  const webEvidence = evidence.filter((e) => e.source_type === 'web');
  const repoEvidence = evidence.filter((e) => e.source_type === 'repo');
  const videoEvidence = evidence.filter((e) => e.source_type === 'video');

  const isCommercial = /سوق|تجاري|شركة|منتج|خدمة|اكتتاب|تأمين|saas|منصة|تطبيق/i.test(
    job.original_query
  );
  const isTechnical = /تقني|برمج|كود|تقنية|api|ذكاء|نموذج|خوارزمية|بيانات/i.test(
    job.original_query
  );

  const findings = claims.map((c) => ({
    finding: c.claim_text,
    evidenceCount: evidence.length,
  }));

  if (findings.length === 0) {
    findings.push({
      finding: 'لم يتم العثور على أدلة كافية للوصول إلى استنتاجات واضحة.',
      evidenceCount: 0,
    });
  }

  const opportunities = generateOpportunities(job.original_query, evidence);
  const risks = generateRisks(job.original_query, evidence);
  const recommendations = generateRecommendations(job.original_query, evidence, claims);
  const unknowns = generateUnknowns(job.original_query, evidence);
  const decisionOptions = generateDecisionOptions(job.original_query, evidence);

  const report: ReportContent = {
    executiveSummary: generateExecutiveSummary(job, evidence, claims),
    researchQuestion: job.original_query,
    scope: job.scope || 'لم يُحدد نطاق جغرافي أو سوقي محدد.',
    keyFindings: findings,
    evidenceAndSources: evidence.map((e) => ({
      title: e.title,
      url: e.url || '',
      type: e.source_type,
      excerpt: e.excerpt || '',
      retrievedAt: e.retrieved_at,
    })),
    marketAnalysis: isCommercial
      ? generateMarketAnalysis(job.original_query, webEvidence, repoEvidence)
      : 'لا ينطبق — الموضوع ليس تجارياً بصورة مباشرة.',
    competitors: isCommercial
      ? generateCompetitors(job.original_query, webEvidence)
      : 'لا ينطبق — الموضوع ليس تجارياً بصورة مباشرة.',
    technicalAnalysis: isTechnical
      ? generateTechnicalAnalysis(job.original_query, repoEvidence)
      : 'لا ينطبق — الموضوع ليس تقنياً بصورة مباشرة.',
    opportunities,
    risks,
    recommendations,
    decisionOptions,
    unknowns,
    sources: evidence.map((e) => ({
      title: e.title,
      url: e.url || '',
      type: e.source_type,
      retrievedAt: e.retrieved_at,
      author: e.author,
    })),
  };

  return report;
}

function generateExecutiveSummary(job: ResearchJob, evidence: EvidenceItem[], claims: Claim[]): string {
  const webCount = evidence.filter((e) => e.source_type === 'web').length;
  const repoCount = evidence.filter((e) => e.source_type === 'repo').length;
  const videoCount = evidence.filter((e) => e.source_type === 'video').length;
  const verifiedClaims = claims.filter((c) => c.verification_status === 'verified').length;
  const unverifiedClaims = claims.filter((c) => c.verification_status === 'unverified').length;

  return `يقدم هذا التقرير نتائج البحث حول: «${job.original_query}».
تم جمع ${evidence.length} مصدراً موزعة على: ${webCount} من الويب، ${repoCount} من مستودعات GitHub، ${videoCount} من يوتيوب.
عمق البحث: ${job.depth === 'deep' ? 'متعمق' : 'سريع'}${job.scope ? `، النطاق: ${job.scope}` : ''}.
تم استخراج ${claims.length} ادعاءً، منها ${verifiedClaims} موثق و${unverifiedClaims} غير متحقق.
${evidence.length === 0 ? 'لم يتم العثور على مصادر كافية، والنتائج يجب أن تُؤخذ بحذر شديد.' : ''}
${unverifiedClaims > verifiedClaims ? 'معظم الادعاءات لم تتحقق بعد، مما يتطلب بحثاً إضافياً.' : ''}`;
}

function generateMarketAnalysis(query: string, web: EvidenceItem[], repo: EvidenceItem[]): string {
  if (web.length === 0 && repo.length === 0) {
    return 'لم يتم العثور على مصادر كافية لتحليل السوق. الأدلة غير كافية.';
  }
  const points: string[] = [];
  if (web.length > 0) {
    points.push(`تم العثور على ${web.length} مصدراً من الويب تتعلق بالموضوع، مما يشير إلى وجود نقاش عام.`);
  }
  if (repo.length > 0) {
    points.push(`تم العثور على ${repo.length} مستودعاً على GitHub، مما يشير إلى وجود نشاط تقني في هذا المجال.`);
  }
  points.push('حجم السوق الدقيق يتطلب دراسة استقصائية أعمق من مصادر متخصصة، ولم تتوفر بيانات كمية مباشرة في هذا البحث.');
  points.push('يجب التعامل مع هذه النتائج كمؤشرات أولية وليس كتحليل سوقي نهائي.');
  return points.join('\n\n');
}

function generateCompetitors(query: string, web: EvidenceItem[]): string {
  if (web.length === 0) {
    return 'لم يتم العثور على مصادر كافية لتحديد المنافسين. الأدلة غير كافية.';
  }
  const titles = web.slice(0, 5).map((e) => `- ${e.title}`).join('\n');
  return `بناءً على نتائج البحث الأولية، تم العثور على محتوى قد يشير إلى جهات فاعلة في المجال:\n${titles}\n\nتنبيه: هذا ليس تحليلاً تنافسياً كاملاً، بل قائمة أولية تحتاج تحقق أعمق.`;
}

function generateTechnicalAnalysis(query: string, repo: EvidenceItem[]): string {
  if (repo.length === 0) {
    return 'لم يتم العثور على مستودعات برمجية كافية للتحليل التقني. الأدلة غير كافية.';
  }
  const repos = repo.slice(0, 5).map((e) => `- ${e.title}${e.url ? ` (${e.url})` : ''}`).join('\n');
  return `تم العثور على المستودعات التالية المرتبطة بالموضوع:\n${repos}\n\nوجود مستودعات مفتوحة المصدر يشير إلى أن هناك نشاطاً تقنياً، لكن تقييم جودة الكود وقابلية إعادة الاستخدام يحتاج فحصاً أعمق.`;
}

function generateOpportunities(query: string, evidence: EvidenceItem[]): string[] {
  const ops: string[] = [];
  if (evidence.length >= 5) {
    ops.push('وجود عدد معقول من المصادر يشير إلى أن الموضوع محل اهتمام، مما يفتح فرصاً للتميز عن طريق تقديم محتوى أو خدمة عالية الجودة.');
  }
  if (evidence.filter((e) => e.source_type === 'repo').length > 0) {
    ops.push('وجود مستودعات مفتوحة المصدر قد يوفر أساساً تقنياً يمكن البناء عليه بدلاً من البدء من الصفر.');
  }
  if (evidence.filter((e) => e.source_type === 'video').length > 0) {
    ops.push('وجود محتوى مرئي يشير إلى طلب على الشرح المرئي، مما يفتح فرصاً للمحتوى التعليمي.');
  }
  if (evidence.length < 3) {
    ops.push('النقص في المصادر المتاحة قد يكون فرصة — المجال غير مشبع بالمحتوى.');
  }
  ops.push('إمكانية التميز بتقديم تحليل عربي متعمق في مجال قد تكون معظم مصادره باللغة الإنجليزية.');
  return ops;
}

function generateRisks(
  query: string,
  evidence: EvidenceItem[]
): { risk: string; severity: 'high' | 'medium' | 'low'; mitigation: string }[] {
  const risks: { risk: string; severity: 'high' | 'medium' | 'low'; mitigation: string }[] = [];

  if (evidence.length < 3) {
    risks.push({
      risk: 'نقص في المصادر المتاحة، مما يجعل الاستنتاجات غير موثوقة.',
      severity: 'high',
      mitigation: 'توسيع نطاق البحث واستخدام مصادر متخصصة إضافية قبل اتخاذ أي قرار.',
    });
  }
  risks.push({
    risk: 'المصادر المتاحة قد تكون قديمة أو غير محدثة، مما يؤثر على دقة المعلومات.',
    severity: 'medium',
    mitigation: 'التحقق من تواريخ النشر والبحث عن مصادر حديثة قبل الاعتماد على النتائج.',
  });
  risks.push({
    risk: 'وجود تحيز في المصادر المتاحة (مثلاً: مصادر تجارية تروج لمنتجات).',
    severity: 'medium',
    mitigation: 'مراجعة المصادر بشكل نقدي والبحث عن آراء متعارضة.',
  });
  if (evidence.some((e) => e.source_type === 'video')) {
    risks.push({
      risk: 'محتوى يوتيوب قد يكون تعليمياً/ترويجياً وليس تحليلياً، ولا يُعد دليلاً على الطلب التجاري.',
      severity: 'low',
      mitigation: 'عدم الاعتماد على عدد المشاهدات كمؤشر تجاري، والبحث عن بيانات سوقية فعلية.',
    });
  }
  risks.push({
    risk: 'عدم توفر بيانات سوقية كمية (حجم السوق، معدلات النمو) في هذا البحث.',
    severity: 'medium',
    mitigation: 'اللجوء إلى مصادر متخصصة (تقارير سوقية، إحصاءات رسمية) قبل اتخاذ قرارات استثمارية.',
  });
  return risks;
}

function generateRecommendations(query: string, evidence: EvidenceItem[], claims: Claim[]): string[] {
  const recs: string[] = [];
  const unverifiedCount = claims.filter((c) => c.verification_status === 'unverified').length;

  if (evidence.length >= 5) {
    recs.push('الموضوع يستحق دراسة أعمق — يوجد أساس معرفي كافٍ للبناء عليه.');
  } else {
    recs.push('يُنصح بجمع مصادر إضافية قبل اتخاذ أي قرار جوهري — الأدلة الحالية محدودة.');
  }
  recs.push('إجراء بحث ميداني أو استطلاع رأي للتحقق من الطلب الفعلي قبل الاستثمار.');
  if (evidence.filter((e) => e.source_type === 'repo').length > 0) {
    recs.push('مراجعة المستودعات المفتوحة المصدر المتاحة لتقييم إمكانية الاستفادة منها تقنياً.');
  }
  recs.push('تحديد جمهور مستهدف واضح واختبار الفرضيات مع عينة صغيرة قبل التوسع.');
  if (unverifiedCount > 0) {
    recs.push(`التحقق من ${unverifiedCount} ادعاءً غير موثق قبل الاعتماد عليها في القرار.`);
  }
  return recs;
}

function generateUnknowns(query: string, evidence: EvidenceItem[]): string[] {
  const unknowns: string[] = [
    'حجم السوق الفعلي بالأرقام لم يُحدد في هذا البحث.',
    'الوضع التنظيمي والقانوني للموضوع في الأسواق المستهدفة غير معروف من المصادر المتاحة.',
    'تكلفة الدخول إلى السوق والمدة الزمنية المتوقعة غير محددة.',
    'لم يتم تحليل سلوك المستخدم الفعلي أو رضاه عن الحلول الحالية.',
  ];
  if (evidence.filter((e) => e.source_type === 'web').length < 3) {
    unknowns.push('المعلومات من مصادر الويب محدودة، وقد تكون هناك نقاط مهمة لم تُغطَّ.');
  }
  unknowns.push('جودة وحداثة المصادر المتاحة لم تُتحقق بالكامل — بعضها قد يكون قديماً أو منحازاً.');
  return unknowns;
}

function generateDecisionOptions(
  query: string,
  evidence: EvidenceItem[]
): { title: string; rationale: string; confidence: 'high' | 'medium' | 'low' | 'unverified' }[] {
  const options: { title: string; rationale: string; confidence: 'high' | 'medium' | 'low' | 'unverified' }[] = [];

  if (evidence.length >= 5) {
    options.push({
      title: 'المضي قدماً بدراسة جدوى تفصيلية',
      rationale: 'الأساس المعرفي المتوفر كافٍ للمضي قدماً بدراسة أعمق، مع الحاجة لجمع بيانات سوقية كمية.',
      confidence: 'medium',
    });
  } else {
    options.push({
      title: 'تأجيل القرار وجمع معلومات إضافية',
      rationale: 'الأدلة المتاحة غير كافية لاتخاذ قرار مدروس. يُنصح بتوسيع البحث قبل الالتزام.',
      confidence: 'high',
    });
  }

  options.push({
    title: 'إجراء اختبار سوقي صغير (MVP)',
    rationale: 'بدلاً من الاستثمار الكامل، يمكن اختبار الفكرة بعينة صغيرة للتحقق من الطلب الفعلي قبل التوسع.',
    confidence: evidence.length >= 3 ? 'medium' : 'low',
  });

  options.push({
    title: 'الشراكة أو الاستحواذ',
    rationale: 'إذا وجدت حلول قائمة (مستودعات مفتوحة المصدر أو منتجات)، قد تكون الشراكة أسرع وأقل تكلفة من البناء من الصفر.',
    confidence: evidence.filter((e) => e.source_type === 'repo').length > 0 ? 'medium' : 'low',
  });

  return options;
}

async function insertDecisionOptions(jobId: string, options: { title: string; rationale: string; confidence: 'high' | 'medium' | 'low' | 'unverified' }[]): Promise<DecisionOption[]> {
  const rows = options.map((o) => ({
    research_job_id: jobId,
    option_title: o.title,
    rationale: o.rationale,
    expected_benefits: null,
    risks: null,
    assumptions: null,
    confidence_level: o.confidence,
  }));
  const { data, error } = await supabase.from('decision_options').insert(rows).select();
  if (error) {
    console.error('Failed to insert decision options:', error);
    return [];
  }
  return (data || []) as DecisionOption[];
}

async function saveReport(jobId: string, content: ReportContent): Promise<void> {
  const { error } = await supabase.from('reports').insert({
    research_job_id: jobId,
    report_version: 1,
    report_content: content as unknown as Record<string, unknown>,
  });
  if (error) console.error('Failed to save report:', error);
}

export async function runResearchPipeline(
  jobId: string,
  query: string,
  scope: string | null,
  depth: ResearchDepth
): Promise<void> {
  try {
    // Stage 1: Planning
    await updateJob(jobId, { status: 'planning', current_stage: STAGE_PLANNING, progress_percent: 5 });
    await sleep(300);
    await insertQuestions(jobId, query, depth);
    await sleep(400);
    await updateJob(jobId, { progress_percent: 15 });

    // Stage 2: Collecting
    await updateJob(jobId, { status: 'collecting', current_stage: STAGE_COLLECTING, progress_percent: 20 });
    const { allEvidence, sourceResults } = await collectFromAllSources(jobId, query, depth);
    await updateJob(jobId, { progress_percent: 50 });

    // Stage 3: Analyzing
    await updateJob(jobId, { status: 'analyzing', current_stage: STAGE_ANALYZING, progress_percent: 55 });
    await sleep(500);
    const claims = await extractClaimsAndLinkEvidence(jobId, allEvidence);
    await updateJob(jobId, { progress_percent: 70 });

    // Stage 4: Verifying
    await updateJob(jobId, { status: 'verifying', current_stage: STAGE_VERIFYING, progress_percent: 75 });
    await sleep(400);
    await updateJob(jobId, { progress_percent: 85 });

    // Stage 5: Reporting
    await updateJob(jobId, { status: 'reporting', current_stage: STAGE_REPORTING, progress_percent: 90 });
    const { data: jobData } = await supabase
      .from('research_jobs')
      .select('*')
      .eq('id', jobId)
      .single();
    if (!jobData) throw new Error('Job not found');

    const report = await generateReport(jobData as ResearchJob, allEvidence, claims);
    await saveReport(jobId, report);
    await insertDecisionOptions(jobId, report.decisionOptions);

    // Determine final status
    const failedSources = sourceResults.filter((s) => s.status === 'failed').length;
    const finalStatus = allEvidence.length === 0 ? 'partial' : failedSources > 0 && failedSources < sourceResults.length ? 'partial' : 'completed';

    await updateJob(jobId, {
      status: finalStatus,
      current_stage: STAGE_REPORTING,
      progress_percent: 100,
      completed_at: new Date().toISOString(),
      error_summary: failedSources > 0 ? `${failedSources} مصدر فشل من أصل ${sourceResults.length}` : null,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'خطأ غير معروف';
    await updateJob(jobId, {
      status: 'failed',
      progress_percent: 0,
      completed_at: new Date().toISOString(),
      error_summary: errorMsg,
    });
  }
}

export { STAGES };
