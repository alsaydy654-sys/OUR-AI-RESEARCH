import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { STAGES } from '@/lib/researchEngine';
import type { ResearchJob, SourceRun } from '@/lib/types';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  ArrowLeft,
  FileText,
  Globe,
  Github,
  Youtube,
  AlertTriangle,
} from 'lucide-react';

type Props = {
  jobId: string;
  onNavigate: (view: 'home' | 'progress' | 'report', jobId?: string) => void;
};

export default function ProgressScreen({ jobId, onNavigate }: Props) {
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [sourceRuns, setSourceRuns] = useState<SourceRun[]>([]);
  const [loading, setLoading] = useState(true);

  const loadJob = useCallback(async () => {
    const { data } = await supabase
      .from('research_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();
    if (data) setJob(data as ResearchJob);
    return data as ResearchJob | null;
  }, [jobId]);

  const loadSourceRuns = useCallback(async () => {
    const { data } = await supabase
      .from('source_runs')
      .select('*')
      .eq('research_job_id', jobId)
      .order('created_at', { ascending: true });
    setSourceRuns((data || []) as SourceRun[]);
  }, [jobId]);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      const jobData = await loadJob();
      await loadSourceRuns();
      if (!active) return;
      setLoading(false);

      if (jobData && (jobData.status === 'completed' || jobData.status === 'partial' || jobData.status === 'failed')) {
        return;
      }
      setTimeout(poll, 2000);
    };

    poll();

    return () => {
      active = false;
    };
  }, [loadJob, loadSourceRuns]);

  useEffect(() => {
    if (job && (job.status === 'completed' || job.status === 'partial')) {
      const timer = setTimeout(() => {
        onNavigate('report', jobId);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [job, jobId, onNavigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
          <p className="text-neutral-600 mb-4">لم يتم العثور على هذا البحث</p>
          <button onClick={() => onNavigate('home')} className="text-primary-600 hover:underline">
            العودة للرئيسية
          </button>
        </div>
      </div>
    );
  }

  const isFinished = job.status === 'completed' || job.status === 'partial' || job.status === 'failed';

  return (
    <div className="min-h-screen mesh-bg">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <button
          onClick={() => onNavigate('home')}
          className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          العودة للرئيسية
        </button>

        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 mb-6">
          <div className="flex items-start gap-3 mb-2">
            <FileText className="w-5 h-5 text-primary-600 shrink-0 mt-1" />
            <h1 className="font-display text-xl font-bold text-neutral-900 leading-relaxed">{job.title}</h1>
          </div>
          {job.scope && (
            <p className="text-sm text-neutral-500 mr-8">النطاق: {job.scope}</p>
          )}
          <div className="flex items-center gap-3 mr-8 mt-2">
            <span className="text-xs text-neutral-400">
              {job.depth === 'deep' ? 'بحث متعمق' : 'بحث سريع'}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-neutral-700">التقدم الكلي</span>
            <span className="text-sm font-bold text-primary-600">{job.progress_percent}%</span>
          </div>
          <div className="h-3 bg-neutral-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-l from-primary-400 to-primary-600 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${job.progress_percent}%` }}
            />
          </div>
          {!isFinished && job.progress_percent < 100 && (
            <p className="text-xs text-neutral-400 mt-2">
              النسبة محسوبة من المهام الفعلية المعروفة
            </p>
          )}
        </div>

        {/* Stages */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 mb-6">
          <h2 className="font-display text-lg font-bold text-neutral-900 mb-4">مراحل البحث</h2>
          <div className="space-y-1">
            {STAGES.map((stage) => {
              const isCurrent = job.current_stage === stage.id && !isFinished;
              const isDone = job.current_stage > stage.id || isFinished;
              const isFailed = job.status === 'failed' && job.current_stage === stage.id;

              return (
                <div
                  key={stage.id}
                  className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
                    isCurrent ? 'bg-primary-50 border border-primary-200' : ''
                  } ${isFailed ? 'bg-red-50 border border-red-200' : ''}`}
                >
                  <div className="shrink-0">
                    {isDone ? (
                      <CheckCircle2 className="w-6 h-6 text-primary-600" />
                    ) : isFailed ? (
                      <XCircle className="w-6 h-6 text-red-500" />
                    ) : isCurrent ? (
                      <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
                    ) : (
                      <Circle className="w-6 h-6 text-neutral-300" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className={`font-medium ${isDone ? 'text-neutral-700' : isCurrent ? 'text-primary-700' : 'text-neutral-400'}`}>
                      {stage.label}
                    </p>
                    {isCurrent && (
                      <p className="text-xs text-primary-500 mt-0.5">جاري التنفيذ...</p>
                    )}
                    {isFailed && (
                      <p className="text-xs text-red-500 mt-0.5">فشل في هذه المرحلة</p>
                    )}
                  </div>
                  <span className="text-xs text-neutral-300 font-display">{stage.id}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Source runs */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 mb-6">
          <h2 className="font-display text-lg font-bold text-neutral-900 mb-4">حالة المصادر</h2>
          {sourceRuns.length === 0 ? (
            <div className="space-y-2">
              {[
                { name: 'الويب', icon: Globe },
                { name: 'GitHub', icon: Github },
                { name: 'YouTube', icon: Youtube },
              ].map((s) => (
                <div key={s.name} className="flex items-center gap-3 p-3 rounded-xl bg-neutral-50">
                  <Circle className="w-5 h-5 text-neutral-300 shrink-0" />
                  <s.icon className="w-5 h-5 text-neutral-400 shrink-0" />
                  <span className="text-neutral-400 text-sm">{s.name}</span>
                  <span className="text-xs text-neutral-300 mr-auto">لم يبدأ</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {sourceRuns.map((run) => (
                <SourceRunRow key={run.id} run={run} />
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {job.status === 'failed' && job.error_summary && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800 mb-1">فشل البحث</p>
                <p className="text-sm text-red-600">{job.error_summary}</p>
              </div>
            </div>
          </div>
        )}

        {/* Partial warning */}
        {job.status === 'partial' && (
          <div className="bg-accent-50 border border-accent-200 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-accent-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-accent-800 mb-1">اكتمل البحث جزئياً</p>
                <p className="text-sm text-accent-700">
                  {job.error_summary || 'بعض المصادر فشلت، لكن التقرير أُعد بالمصادر المتاحة.'}
                </p>
                <p className="text-xs text-accent-600 mt-2">سيتم نقلك إلى التقرير تلقائياً...</p>
              </div>
            </div>
          </div>
        )}

        {/* Completed */}
        {job.status === 'completed' && (
          <div className="bg-primary-50 border border-primary-200 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-primary-600 shrink-0" />
              <p className="text-sm font-medium text-primary-800">اكتمل البحث بنجاح. سيتم نقلك إلى التقرير...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SourceRunRow({ run }: { run: SourceRun }) {
  const Icon = run.source_name === 'GitHub' ? Github : run.source_name === 'YouTube' ? Youtube : Globe;

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-neutral-50 border border-neutral-100">
      <div className="shrink-0">
        {run.status === 'running' && <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />}
        {run.status === 'success' && <CheckCircle2 className="w-5 h-5 text-primary-600" />}
        {run.status === 'failed' && <XCircle className="w-5 h-5 text-red-500" />}
        {run.status === 'idle' && <Circle className="w-5 h-5 text-neutral-300" />}
      </div>
      <Icon className="w-5 h-5 text-neutral-500 shrink-0" />
      <span className="text-sm font-medium text-neutral-700 shrink-0">{run.source_name}</span>
      <span className="text-xs text-neutral-400 mr-auto">
        {run.status === 'running' && 'قيد التشغيل'}
        {run.status === 'success' && `نجح · ${run.result_count || 0} نتيجة`}
        {run.status === 'failed' && (run.error_message || 'فشل')}
        {run.status === 'idle' && 'لم يُستخدم'}
      </span>
    </div>
  );
}
