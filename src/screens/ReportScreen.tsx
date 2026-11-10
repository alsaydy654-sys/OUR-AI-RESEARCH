import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { ResearchJob, Report, SourceRun, Claim, DecisionOption, ReportContent } from '@/lib/types';
import {
  ArrowLeft,
  FileText,
  Download,
  Globe,
  Github,
  Youtube,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  ShieldQuestion,
  TrendingUp,
  ShieldAlert,
  Lightbulb,
  GitBranch,
  Loader2,
  XCircle,
} from 'lucide-react';

type Props = {
  jobId: string;
  onNavigate: (view: 'home' | 'progress' | 'report', jobId?: string) => void;
};

export default function ReportScreen({ jobId, onNavigate }: Props) {
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [report, setReport] = useState<ReportContent | null>(null);
  const [sourceRuns, setSourceRuns] = useState<SourceRun[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [decisionOptions, setDecisionOptions] = useState<DecisionOption[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    const [jobRes, reportRes, runsRes, claimsRes, decisionsRes] = await Promise.all([
      supabase.from('research_jobs').select('*').eq('id', jobId).maybeSingle(),
      supabase.from('reports').select('*').eq('research_job_id', jobId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('source_runs').select('*').eq('research_job_id', jobId).order('created_at', { ascending: true }),
      supabase.from('claims').select('*').eq('research_job_id', jobId),
      supabase.from('decision_options').select('*').eq('research_job_id', jobId),
    ]);

    setJob(jobRes.data as ResearchJob | null);
    setReport(reportRes.data ? (reportRes.data as Report).report_content : null);
    setSourceRuns((runsRes.data || []) as SourceRun[]);
    setClaims((claimsRes.data || []) as Claim[]);
    setDecisionOptions((decisionsRes.data || []) as DecisionOption[]);
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleExport = () => {
    if (!report || !job) return;
    exportReportAsHTML(job, report);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!job || !report) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
          <p className="text-neutral-600 mb-4">التقرير غير متاح</p>
          <button onClick={() => onNavigate('home')} className="text-primary-600 hover:underline">
            العودة للرئيسية
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 glass border-b border-neutral-200">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <button
            onClick={() => onNavigate('home')}
            className="flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            الرئيسية
          </button>
          <div className="flex items-center gap-3">
            {job.status === 'partial' && (
              <span className="flex items-center gap-1 text-xs text-accent-700 bg-accent-50 px-2 py-1 rounded-lg">
                <AlertTriangle className="w-3.5 h-3.5" />
                تقرير جزئي
              </span>
            )}
            <button
              onClick={handleExport}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white text-sm font-medium hover:bg-primary-700 transition-all"
            >
              <Download className="w-4 h-4" />
              تصدير HTML
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Title card */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 mb-6">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-12 h-12 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
              <FileText className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-display text-2xl font-bold text-neutral-900 leading-relaxed">{job.title}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {job.scope && (
                  <span className="text-xs text-neutral-500 bg-neutral-100 px-2 py-1 rounded-lg">
                    النطاق: {job.scope}
                  </span>
                )}
                <span className="text-xs text-neutral-500 bg-neutral-100 px-2 py-1 rounded-lg">
                  {job.depth === 'deep' ? 'بحث متعمق' : 'بحث سريع'}
                </span>
                <span className="text-xs text-neutral-500 bg-neutral-100 px-2 py-1 rounded-lg">
                  {new Date(job.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Table of contents */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 mb-6">
          <h2 className="font-display text-sm font-bold text-neutral-500 mb-3">محتويات التقرير</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              { num: 1, title: 'الملخص التنفيذي', id: 'summary' },
              { num: 2, title: 'سؤال البحث ونطاقه', id: 'question' },
              { num: 3, title: 'النتائج الرئيسية', id: 'findings' },
              { num: 4, title: 'الأدلة والمصادر', id: 'evidence' },
              { num: 5, title: 'تحليل السوق', id: 'market' },
              { num: 6, title: 'المنافسون والبدائل', id: 'competitors' },
              { num: 7, title: 'التحليل التقني', id: 'technical' },
              { num: 8, title: 'الفرص', id: 'opportunities' },
              { num: 9, title: 'المخاطر والقيود', id: 'risks' },
              { num: 10, title: 'التوصيات', id: 'recommendations' },
              { num: 11, title: 'خيارات القرار', id: 'decisions' },
              { num: 12, title: 'ما لا نعرفه بعد', id: 'unknowns' },
              { num: 13, title: 'قائمة المصادر', id: 'sources' },
            ].map((item) => (
              <a
                key={item.num}
                href={`#${item.id}`}
                className="flex items-center gap-2 text-sm text-neutral-600 hover:text-primary-600 transition-colors"
              >
                <span className="w-6 h-6 rounded bg-neutral-100 text-neutral-500 text-xs flex items-center justify-center font-display shrink-0">
                  {item.num}
                </span>
                {item.title}
              </a>
            ))}
          </div>
        </div>

        {/* Report sections */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 md:p-10 report-prose">
          {/* 1. Executive Summary */}
          <Section id="summary" num={1} title="الملخص التنفيذي" icon={Info}>
            <p style={{ whiteSpace: 'pre-line' }}>{report.executiveSummary}</p>
          </Section>

          {/* 2. Research Question */}
          <Section id="question" num={2} title="سؤال البحث ونطاقه" icon={FileText}>
            <p><strong>السؤال الأصلي:</strong> {report.researchQuestion}</p>
            <p><strong>النطاق:</strong> {report.scope}</p>
          </Section>

          {/* 3. Key Findings */}
          <Section id="findings" num={3} title="النتائج الرئيسية" icon={CheckCircle2}>
            {report.keyFindings.length > 0 ? (
              <ul>
                {report.keyFindings.map((f, i) => (
                  <li key={i}>
                    {f.finding}
                    {f.evidenceCount > 0 && (
                      <span className="text-xs text-neutral-400 mr-1">({f.evidenceCount} مصدر)</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>لم يتم العثور على نتائج كافية.</p>
            )}
          </Section>

          {/* 4. Evidence & Sources */}
          <Section id="evidence" num={4} title="الأدلة والمصادر" icon={Globe}>
            {report.evidenceAndSources.length > 0 ? (
              <div className="space-y-3 not-prose">
                {report.evidenceAndSources.map((e, i) => (
                  <div key={i} className="border border-neutral-200 rounded-xl p-4 hover:border-primary-200 transition-colors">
                    <div className="flex items-start gap-3">
                      <SourceIcon type={e.type} />
                      <div className="flex-1 min-w-0">
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-neutral-800 hover:text-primary-600 transition-colors flex items-center gap-1"
                        >
                          {e.title}
                          <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                        </a>
                        <p className="text-sm text-neutral-500 mt-1 line-clamp-2">{e.excerpt}</p>
                        <p className="text-xs text-neutral-400 mt-2">
                          تم الجمع: {new Date(e.retrievedAt).toLocaleDateString('ar-EG')}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p>لم يتم العثور على أدلة كافية.</p>
            )}
          </Section>

          {/* 5. Market Analysis */}
          <Section id="market" num={5} title="تحليل السوق أو المجال" icon={TrendingUp}>
            <p style={{ whiteSpace: 'pre-line' }}>{report.marketAnalysis}</p>
          </Section>

          {/* 6. Competitors */}
          <Section id="competitors" num={6} title="المنافسون والبدائل" icon={GitBranch}>
            <p style={{ whiteSpace: 'pre-line' }}>{report.competitors}</p>
          </Section>

          {/* 7. Technical Analysis */}
          <Section id="technical" num={7} title="التحليل التقني" icon={Github}>
            <p style={{ whiteSpace: 'pre-line' }}>{report.technicalAnalysis}</p>
          </Section>

          {/* 8. Opportunities */}
          <Section id="opportunities" num={8} title="الفرص" icon={Lightbulb}>
            <ul>
              {report.opportunities.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </Section>

          {/* 9. Risks */}
          <Section id="risks" num={9} title="المخاطر والقيود" icon={ShieldAlert}>
            <div className="space-y-3 not-prose">
              {report.risks.map((r, i) => (
                <div key={i} className={`rounded-xl p-4 border ${
                  r.severity === 'high' ? 'bg-red-50 border-red-200' :
                  r.severity === 'medium' ? 'bg-accent-50 border-accent-200' :
                  'bg-blue-50 border-blue-200'
                }`}>
                  <div className="flex items-start gap-2">
                    <AlertCircle className={`w-5 h-5 shrink-0 mt-0.5 ${
                      r.severity === 'high' ? 'text-red-500' :
                      r.severity === 'medium' ? 'text-accent-600' :
                      'text-blue-500'
                    }`} />
                    <div>
                      <p className="font-medium text-neutral-800">{r.risk}</p>
                      <p className="text-sm text-neutral-600 mt-1">
                        <strong>التخفيف:</strong> {r.mitigation}
                      </p>
                      <span className={`inline-block text-xs px-2 py-0.5 rounded mt-2 ${
                        r.severity === 'high' ? 'bg-red-100 text-red-700' :
                        r.severity === 'medium' ? 'bg-accent-100 text-accent-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        خطورة {r.severity === 'high' ? 'عالية' : r.severity === 'medium' ? 'متوسطة' : 'منخفضة'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* 10. Recommendations */}
          <Section id="recommendations" num={10} title="التوصيات" icon={CheckCircle2}>
            <ul>
              {report.recommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </Section>

          {/* 11. Decision Options */}
          <Section id="decisions" num={11} title="خيارات القرار ومبرراتها" icon={GitBranch}>
            <div className="space-y-3 not-prose">
              {report.decisionOptions.map((d, i) => (
                <div key={i} className="border border-neutral-200 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-semibold text-neutral-800">{d.title}</h3>
                    <ConfidenceBadge level={d.confidence} />
                  </div>
                  <p className="text-sm text-neutral-600">{d.rationale}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* 12. Unknowns */}
          <Section id="unknowns" num={12} title="ما لا نعرفه بعد" icon={ShieldQuestion}>
            <div className="bg-neutral-50 rounded-xl p-4 border border-neutral-200 not-prose">
              <ul>
                {report.unknowns.map((u, i) => (
                  <li key={i} className="text-neutral-600">{u}</li>
                ))}
              </ul>
            </div>
          </Section>

          {/* 13. Sources list */}
          <Section id="sources" num={13} title="قائمة المصادر وتواريخ الوصول" icon={Globe}>
            {report.sources.length > 0 ? (
              <div className="not-prose">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-right">
                      <th className="pb-2 font-medium text-neutral-600">#</th>
                      <th className="pb-2 font-medium text-neutral-600">العنوان</th>
                      <th className="pb-2 font-medium text-neutral-600">النوع</th>
                      <th className="pb-2 font-medium text-neutral-600">تاريخ الوصول</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sources.map((s, i) => (
                      <tr key={i} className="border-b border-neutral-100">
                        <td className="py-2 text-neutral-400">{i + 1}</td>
                        <td className="py-2">
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline flex items-center gap-1">
                            {s.title}
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        </td>
                        <td className="py-2 text-neutral-500">
                          {s.type === 'web' ? 'ويب' : s.type === 'repo' ? 'مستودع' : 'فيديو'}
                        </td>
                        <td className="py-2 text-neutral-400 text-xs">
                          {new Date(s.retrievedAt).toLocaleDateString('ar-EG')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>لا توجد مصادر.</p>
            )}
          </Section>
        </div>

        {/* Source runs summary */}
        {sourceRuns.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 mt-6">
            <h2 className="font-display text-lg font-bold text-neutral-900 mb-4">حالة المصادر</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {sourceRuns.map((run) => (
                <div key={run.id} className="flex items-center gap-3 p-3 rounded-xl bg-neutral-50">
                  {run.status === 'success' && <CheckCircle2 className="w-5 h-5 text-primary-600 shrink-0" />}
                  {run.status === 'failed' && <XCircleIcon run={run} />}
                  {run.status === 'running' && <Loader2 className="w-5 h-5 text-primary-600 animate-spin shrink-0" />}
                  {run.status === 'idle' && <Info className="w-5 h-5 text-neutral-300 shrink-0" />}
                  <div>
                    <p className="text-sm font-medium text-neutral-700">{run.source_name}</p>
                    <p className="text-xs text-neutral-400">
                      {run.status === 'success' ? `${run.result_count || 0} نتيجة` :
                       run.status === 'failed' ? 'فشل' :
                       run.status === 'running' ? 'قيد التشغيل' : 'لم يُستخدم'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Claims summary */}
        {claims.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 mt-6">
            <h2 className="font-display text-lg font-bold text-neutral-900 mb-4">الادعاءات ومستويات الثقة</h2>
            <div className="space-y-2">
              {claims.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 p-3 rounded-xl bg-neutral-50">
                  <p className="text-sm text-neutral-700">{c.claim_text}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <ConfidenceBadge level={c.confidence_level} />
                    {c.verification_status === 'conflicted' && (
                      <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-700">تعارض</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer note */}
        <div className="mt-8 mb-4 text-center">
          <p className="text-xs text-neutral-400">
            المعيار الأعلى ليس طول التقرير؛ بل جودة الأدلة ووضوح حدود المعرفة.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ id, num, title, icon: Icon, children }: {
  id: string;
  num: number;
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-8 scroll-mt-20">
      <h2 className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-primary-50 text-primary-600 text-sm flex items-center justify-center font-display shrink-0">
          {num}
        </span>
        <Icon className="w-5 h-5 text-primary-600 shrink-0" />
        {title}
      </h2>
      <div className="mt-3">
        {children}
      </div>
    </section>
  );
}

function SourceIcon({ type }: { type: string }) {
  if (type === 'repo') return <Github className="w-5 h-5 text-neutral-500 shrink-0 mt-0.5" />;
  if (type === 'video') return <Youtube className="w-5 h-5 text-neutral-500 shrink-0 mt-0.5" />;
  return <Globe className="w-5 h-5 text-neutral-500 shrink-0 mt-0.5" />;
}

function ConfidenceBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    high: 'bg-primary-100 text-primary-700',
    medium: 'bg-blue-100 text-blue-700',
    low: 'bg-accent-100 text-accent-700',
    unverified: 'bg-neutral-100 text-neutral-600',
  };
  const labels: Record<string, string> = {
    high: 'ثقة مرتفعة',
    medium: 'ثقة متوسطة',
    low: 'ثقة منخفضة',
    unverified: 'غير متحقق',
  };
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${styles[level] || styles.unverified}`}>
      {labels[level] || labels.unverified}
    </span>
  );
}

function XCircleIcon({ run }: { run: SourceRun }) {
  return (
    <div className="shrink-0">
      <XCircle className="w-5 h-5 text-red-500" />
      {run.error_message && <span className="sr-only">{run.error_message}</span>}
    </div>
  );
}

function exportReportAsHTML(job: ResearchJob, report: ReportContent) {
  const html = generateExportHTML(job, report);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `research-report-${job.id.substring(0, 8)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function generateExportHTML(job: ResearchJob, report: ReportContent): string {
  const sourceRows = report.sources.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><a href="${s.url}" target="_blank">${escapeHtml(s.title)}</a></td>
      <td>${s.type === 'web' ? 'ويب' : s.type === 'repo' ? 'مستودع' : 'فيديو'}</td>
      <td>${new Date(s.retrievedAt).toLocaleDateString('ar-EG')}</td>
    </tr>
  `).join('');

  const findings = report.keyFindings.map((f) => `<li>${escapeHtml(f.finding)}</li>`).join('');
  const opportunities = report.opportunities.map((o) => `<li>${escapeHtml(o)}</li>`).join('');
  const recommendations = report.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  const unknowns = report.unknowns.map((u) => `<li>${escapeHtml(u)}</li>`).join('');
  const risks = report.risks.map((r) => `
    <div class="risk-item severity-${r.severity}">
      <p><strong>${escapeHtml(r.risk)}</strong></p>
      <p>التخفيف: ${escapeHtml(r.mitigation)}</p>
    </div>
  `).join('');
  const decisions = report.decisionOptions.map((d) => `
    <div class="decision-item">
      <h3>${escapeHtml(d.title)} <span class="badge">${d.confidence === 'high' ? 'ثقة مرتفعة' : d.confidence === 'medium' ? 'ثقة متوسطة' : d.confidence === 'low' ? 'ثقة منخفضة' : 'غير متحقق'}</span></h3>
      <p>${escapeHtml(d.rationale)}</p>
    </div>
  `).join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(job.title)} — تقرير بحثي</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
body { font-family: 'IBM Plex Sans Arabic', sans-serif; background: #f8fafc; color: #0f172a; line-height: 1.8; margin: 0; padding: 20px; }
.container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
h1 { font-family: 'Cairo', sans-serif; font-size: 1.8rem; margin-bottom: 0.5rem; }
h2 { font-family: 'Cairo', sans-serif; font-size: 1.4rem; color: #0a7c66; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; margin-top: 2rem; }
h3 { font-size: 1.1rem; margin-top: 1.5rem; }
a { color: #0a7c66; }
.meta { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 2rem; }
.meta span { background: #f1f5f9; padding: 4px 12px; border-radius: 8px; font-size: 0.85rem; }
ul { padding-right: 1.5rem; }
li { margin-bottom: 0.5rem; }
.risk-item { padding: 12px; border-radius: 8px; margin-bottom: 8px; }
.severity-high { background: #fef2f2; border: 1px solid #fecaca; }
.severity-medium { background: #fffbeb; border: 1px solid #fde68a; }
.severity-low { background: #eff6ff; border: 1px solid #bfdbfe; }
.decision-item { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 8px; }
.badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; background: #f0fdf9; color: #0a7c66; }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { padding: 8px; text-align: right; border-bottom: 1px solid #f1f5f9; }
th { color: #64748b; font-weight: 500; }
.footer { text-align: center; color: #94a3b8; font-size: 0.8rem; margin-top: 2rem; }
</style>
</head>
<body>
<div class="container">
<h1>${escapeHtml(job.title)}</h1>
<div class="meta">
${job.scope ? `<span>النطاق: ${escapeHtml(job.scope)}</span>` : ''}
<span>${job.depth === 'deep' ? 'بحث متعمق' : 'بحث سريع'}</span>
<span>${new Date(job.created_at).toLocaleDateString('ar-EG')}</span>
</div>

<h2>1. الملخص التنفيذي</h2>
<p style="white-space: pre-line">${escapeHtml(report.executiveSummary)}</p>

<h2>2. سؤال البحث ونطاقه</h2>
<p><strong>السؤال:</strong> ${escapeHtml(report.researchQuestion)}</p>
<p><strong>النطاق:</strong> ${escapeHtml(report.scope)}</p>

<h2>3. النتائج الرئيسية</h2>
<ul>${findings}</ul>

<h2>4. الأدلة والمصادر</h2>
${report.evidenceAndSources.map((e) => `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:8px;"><a href="${e.url}" target="_blank"><strong>${escapeHtml(e.title)}</strong></a><p style="font-size:0.9rem;color:#64748b;margin:4px 0;">${escapeHtml(e.excerpt)}</p></div>`).join('')}

<h2>5. تحليل السوق أو المجال</h2>
<p style="white-space: pre-line">${escapeHtml(report.marketAnalysis)}</p>

<h2>6. المنافسون والبدائل</h2>
<p style="white-space: pre-line">${escapeHtml(report.competitors)}</p>

<h2>7. التحليل التقني</h2>
<p style="white-space: pre-line">${escapeHtml(report.technicalAnalysis)}</p>

<h2>8. الفرص</h2>
<ul>${opportunities}</ul>

<h2>9. المخاطر والقيود</h2>
${risks}

<h2>10. التوصيات</h2>
<ul>${recommendations}</ul>

<h2>11. خيارات القرار ومبرراتها</h2>
${decisions}

<h2>12. ما لا نعرفه بعد</h2>
<ul>${unknowns}</ul>

<h2>13. قائمة المصادر وتواريخ الوصول</h2>
<table><thead><tr><th>#</th><th>العنوان</th><th>النوع</th><th>تاريخ الوصول</th></tr></thead><tbody>${sourceRows}</tbody></table>

<div class="footer">المعيار الأعلى ليس طول التقرير؛ بل جودة الأدلة ووضوح حدود المعرفة.</div>
</div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
