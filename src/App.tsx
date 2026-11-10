import { useState } from 'react';
import { Microscope } from 'lucide-react';
import HomeScreen from '@/screens/HomeScreen';
import ProgressScreen from '@/screens/ProgressScreen';
import ReportScreen from '@/screens/ReportScreen';

type View = 'home' | 'progress' | 'report';

export default function App() {
  const [view, setView] = useState<View>('home');
  const [jobId, setJobId] = useState<string | null>(null);

  const navigate = (newView: View, newJobId?: string) => {
    setView(newView);
    setJobId(newJobId || null);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Top bar */}
      <header className="sticky top-0 z-20 glass border-b border-neutral-200">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate('home')}
            className="flex items-center gap-2 group"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white flex items-center justify-center shadow-sm group-hover:shadow-md transition-all">
              <Microscope className="w-5 h-5" />
            </div>
            <span className="font-display font-bold text-neutral-900 text-lg">منصة البحث الذكي</span>
          </button>
          <div className="flex items-center gap-1">
            <span className="text-xs text-neutral-400 hidden sm:block">لا ادعاءات بلا أدلة</span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main>
        {view === 'home' && <HomeScreen onNavigate={navigate} />}
        {view === 'progress' && jobId && <ProgressScreen jobId={jobId} onNavigate={navigate} />}
        {view === 'report' && jobId && <ReportScreen jobId={jobId} onNavigate={navigate} />}
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 py-6 mt-auto">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-xs text-neutral-400">
            منصة بحث وتحليل متعددة المصادر — عربية أولاً
          </p>
        </div>
      </footer>
    </div>
  );
}
