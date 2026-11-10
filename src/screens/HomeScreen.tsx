import { Search, Loader2 } from 'lucide-react';

type Props = {
  onNavigate: (view: 'home' | 'progress' | 'report', jobId?: string) => void;
};

export default function HomeScreen({ onNavigate }: Props) {
  return (
    <div className="min-h-screen mesh-bg">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary-50/50 to-transparent" />
        <div className="relative max-w-4xl mx-auto px-6 pt-20 pb-12 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-50 border border-primary-200 mb-6 animate-fade-in">
            <Search className="w-4 h-4 text-primary-600" />
            <span className="text-sm text-primary-700 font-medium">منصة بحث ذكية متعددة المصادر</span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-neutral-900 mb-4 animate-fade-in-up">
            منصة البحث الذكي
          </h1>
          <p className="text-lg text-neutral-600 max-w-2xl mx-auto leading-relaxed animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
            أدخل موضوعاً واحداً، واحصل على تقرير منظم يوضح ما تم التحقق منه، وما لم يتم،
            والأدلة التي تدعم كل استنتاج — مع روابط المصادر لمراجعتها بنفسك.
          </p>
          <p className="text-sm text-neutral-500 mt-4 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
            لا ادعاءات بلا أدلة، ولا قرارات نهائية بلا توضيح مستوى الثقة والمخاطر.
          </p>
        </div>
      </section>

      {/* Search Form */}
      <section className="max-w-3xl mx-auto px-6 pb-16">
        <SearchForm onNavigate={onNavigate} />
      </section>

      {/* Recent Research */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <RecentResearch onNavigate={onNavigate} />
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <h2 className="font-display text-2xl font-bold text-neutral-900 mb-8 text-center">كيف تعمل المنصة</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[
            { step: 1, title: 'تخطيط', desc: 'فهم الموضوع وتقسيمه لأسئلة فرعية' },
            { step: 2, title: 'جمع المصادر', desc: 'البحث في الويب وGitHub ويوتيوب' },
            { step: 3, title: 'تحليل', desc: 'استخراج الادعاءات والأدلة' },
            { step: 4, title: 'تحقق', desc: 'فحص التعارضات ومستوى الثقة' },
            { step: 5, title: 'تقرير', desc: 'إخراج تقرير منظم قابل للتصدير' },
          ].map((item) => (
            <div
              key={item.step}
              className="bg-white rounded-xl border border-neutral-200 p-5 hover:border-primary-300 hover:shadow-md transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 font-bold flex items-center justify-center mb-3 font-display">
                {item.step}
              </div>
              <h3 className="font-semibold text-neutral-800 mb-1">{item.title}</h3>
              <p className="text-sm text-neutral-500 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { runResearchPipeline } from '@/lib/researchEngine';
import type { ResearchDepth } from '@/lib/types';

function SearchForm({ onNavigate }: { onNavigate: (view: 'home' | 'progress' | 'report', jobId?: string) => void }) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('');
  const [depth, setDepth] = useState<ResearchDepth>('quick');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      setError('الرجاء إدخال موضوع البحث');
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const title = query.trim().substring(0, 80);
      const { data, error: insertError } = await supabase
        .from('research_jobs')
        .insert({
          title,
          original_query: query.trim(),
          scope: scope.trim() || null,
          language: 'ar',
          depth,
          status: 'planning',
          current_stage: 1,
          progress_percent: 0,
        })
        .select()
        .single();

      if (insertError || !data) {
        throw new Error('فشل إنشاء البحث');
      }

      const jobId = data.id;
      onNavigate('progress', jobId);

      runResearchPipeline(jobId, query.trim(), scope.trim() || null, depth);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 md:p-8 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="query" className="block text-sm font-medium text-neutral-700 mb-2">
            ما موضوع البحث؟
          </label>
          <textarea
            id="query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={3}
            placeholder="مثال: دراسة جدوى إنشاء خدمة SaaS لإدارة اكتتاب التأمين الصحي في اليمن والسعودية"
            className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all resize-none"
            disabled={loading}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="scope" className="block text-sm font-medium text-neutral-700 mb-2">
              السوق أو البلد <span className="text-neutral-400">(اختياري)</span>
            </label>
            <input
              id="scope"
              type="text"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="مثال: السعودية، اليمن، الخليج"
              className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">عمق البحث</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDepth('quick')}
                className={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all ${
                  depth === 'quick'
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-neutral-300 bg-white text-neutral-600 hover:border-neutral-400'
                }`}
                disabled={loading}
              >
                بحث سريع
              </button>
              <button
                type="button"
                onClick={() => setDepth('deep')}
                className={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all ${
                  depth === 'deep'
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-neutral-300 bg-white text-neutral-600 hover:border-neutral-400'
                }`}
                disabled={loading}
              >
                بحث متعمق
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-6 py-4 text-white font-semibold hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              جاري إنشاء البحث...
            </>
          ) : (
            <>
              <Search className="w-5 h-5" />
              ابدأ البحث
            </>
          )}
        </button>
      </form>
    </div>
  );
}

import { useEffect, useState as useStateReact } from 'react';
import type { ResearchJob } from '@/lib/types';
import { FileText, Clock, ChevronLeft } from 'lucide-react';

function RecentResearch({ onNavigate }: { onNavigate: (view: 'home' | 'progress' | 'report', jobId?: string) => void }) {
  const [jobs, setJobs] = useStateReact<ResearchJob[]>([]);
  const [loading, setLoading] = useStateReact(true);

  useEffect(() => {
    loadJobs();
  }, []);

  const loadJobs = async () => {
    const { data } = await supabase
      .from('research_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    setJobs((data || []) as ResearchJob[]);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-xl shimmer" />
        ))}
      </div>
    );
  }

  if (jobs.length === 0) {
    return null;
  }

  return (
    <div>
      <h2 className="font-display text-xl font-bold text-neutral-900 mb-4 flex items-center gap-2">
        <Clock className="w-5 h-5 text-primary-600" />
        الأبحاث السابقة
      </h2>
      <div className="space-y-2">
        {jobs.map((job) => (
          <button
            key={job.id}
            onClick={() => onNavigate(job.status === 'completed' || job.status === 'partial' ? 'report' : 'progress', job.id)}
            className="w-full flex items-center justify-between bg-white rounded-xl border border-neutral-200 px-5 py-4 hover:border-primary-300 hover:shadow-sm transition-all text-right group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-neutral-800 truncate">{job.title}</p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {new Date(job.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
                  {' · '}
                  <StatusBadge status={job.status} />
                </p>
              </div>
            </div>
            <ChevronLeft className="w-5 h-5 text-neutral-400 group-hover:text-primary-600 transition-colors shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-primary-50 text-primary-700',
    partial: 'bg-accent-50 text-accent-700',
    failed: 'bg-red-50 text-red-700',
    planning: 'bg-blue-50 text-blue-700',
    collecting: 'bg-blue-50 text-blue-700',
    analyzing: 'bg-blue-50 text-blue-700',
    verifying: 'bg-blue-50 text-blue-700',
    reporting: 'bg-blue-50 text-blue-700',
  };
  const labels: Record<string, string> = {
    completed: 'مكتمل',
    partial: 'جزئي',
    failed: 'فشل',
    planning: 'تخطيط',
    collecting: 'جمع',
    analyzing: 'تحليل',
    verifying: 'تحقق',
    reporting: 'تقرير',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[status] || 'bg-neutral-100 text-neutral-600'}`}>
      {labels[status] || status}
    </span>
  );
}
