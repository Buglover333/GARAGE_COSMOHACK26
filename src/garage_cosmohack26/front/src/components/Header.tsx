import { useEffect, useRef, useState } from 'react';
import { BarChart3, ChevronDown, FolderOpen, GitCompareArrows, Maximize2, Minimize2, Orbit, Plus, Sparkles } from 'lucide-react';
import { ConfigSummaryDto } from '../api/simulation';
import { ConstellationConfig, SimulationTime } from '../types/simulation';
import { formatTimeSeconds } from '../utils/orbitalMechanics';

interface Props {
  config: ConstellationConfig | null;
  savedConfigs: ConfigSummaryDto[];
  simulationTime: SimulationTime;
  loadingConfigId: string | null;
  onCreateProject: () => void;
  onLoadProject: (id: string) => void;
  onOpenComparison: () => void;
  onOpenMetrics: () => void;
  onOpenOptimization: () => void;
  lang: 'ru' | 'en';
}

export const Header = ({
  config,
  savedConfigs,
  simulationTime,
  loadingConfigId,
  onCreateProject,
  onLoadProject,
  onOpenComparison,
  onOpenMetrics,
  onOpenOptimization,
  lang,
}: Props) => {
  const [fullscreen, setFullscreen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isProjectMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!projectMenuRef.current?.contains(event.target as Node)) {
        setIsProjectMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [isProjectMenuOpen]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().then(() => setFullscreen(true));
    } else {
      void document.exitFullscreen().then(() => setFullscreen(false));
    }
  };

  return <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 py-3.5 bg-gradient-to-b from-slate-950/90 via-slate-950/60 to-transparent backdrop-blur-sm pointer-events-auto select-none border-b border-white/5">
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-3">
        <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border border-cyan-500/30 flex items-center justify-center">
          <Orbit className="w-5 h-5 text-cyan-400 animate-spin-slow" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-white font-tech leading-none">{lang === 'ru' ? 'Спутниковая группировка' : 'Satellite Constellation'}</h1>
          <p className="text-xs text-slate-400 mt-0.5">{lang === 'ru' ? 'Симуляция и анализ' : 'Simulation & Analysis'}</p>
        </div>
      </div>

      <div ref={projectMenuRef} className="relative ml-2">
        <button
          onClick={() => setIsProjectMenuOpen(previous => !previous)}
          aria-expanded={isProjectMenuOpen}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700/70 text-xs text-slate-200"
        >
          <span className="text-slate-400">{lang === 'ru' ? 'Проект:' : 'Project:'}</span>
          <span className="font-semibold text-white">{config?.name ?? (lang === 'ru' ? 'не создан' : 'not created')}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isProjectMenuOpen ? 'rotate-180' : ''}`} />
        </button>

        {isProjectMenuOpen && (
          <div className="absolute top-full left-0 mt-2 w-80 overflow-hidden rounded-xl border border-slate-700/80 bg-slate-950/95 shadow-2xl shadow-black/60 backdrop-blur-xl">
            <div className="px-3 py-2.5 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {lang === 'ru' ? 'Сохранённые конфигурации' : 'Saved configurations'}
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5">
              {savedConfigs.length === 0 ? (
                <div className="px-3 py-5 text-center text-xs text-slate-500">
                  {lang === 'ru' ? 'Сохранённых конфигураций нет' : 'No saved configurations'}
                </div>
              ) : savedConfigs.map(item => {
                const isActive = item.id === config?.id;
                const isLoading = item.id === loadingConfigId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={loadingConfigId !== null}
                    onClick={() => {
                      setIsProjectMenuOpen(false);
                      onLoadProject(item.id);
                    }}
                    className={`w-full flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left disabled:opacity-50 ${isActive ? 'bg-cyan-950/60 border border-cyan-800/60' : 'border border-transparent hover:bg-slate-800/80'}`}
                  >
                    <FolderOpen className={`mt-0.5 w-4 h-4 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium text-slate-100">{item.title || item.id}</span>
                        {item.is_example && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-400">пример</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                        {isLoading ? 'Загрузка…' : `${item.id} · ${item.satellites} спутников · ${item.ground_sites} пунктов`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-slate-800 p-1.5">
              <button
                type="button"
                onClick={() => {
                  setIsProjectMenuOpen(false);
                  onCreateProject();
                }}
                className="w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium text-cyan-300 hover:bg-cyan-950/50"
              >
                <Plus className="w-4 h-4" />
                {lang === 'ru' ? 'Создать новый проект' : 'Create new project'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>

    <div className="text-xl font-bold font-mono-data text-white tracking-widest">
      {config ? formatTimeSeconds(simulationTime.timeSeconds) : '--:--:--'}
    </div>

    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={!config}
        onClick={onOpenMetrics}
        className="h-8 px-3 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 flex items-center gap-2 text-xs text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        title={lang === 'ru' ? 'Рассчитать метрики конфигурации' : 'Calculate configuration metrics'}
      >
        <BarChart3 className="w-4 h-4 text-cyan-400" />
        <span className="hidden xl:inline">{lang === 'ru' ? 'Метрики' : 'Metrics'}</span>
      </button>
      <button
        type="button"
        onClick={onOpenOptimization}
        className="h-8 px-3 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 flex items-center gap-2 text-xs text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        title={lang === 'ru' ? 'Рассчитать эффективный деплой' : 'Optimize deployment'}
      >
        <Sparkles className="w-4 h-4 text-violet-400" />
        <span className="hidden xl:inline">{lang === 'ru' ? 'Оптимизация' : 'Optimization'}</span>
      </button>
      <button
        type="button"
        onClick={onOpenComparison}
        className="h-8 px-3 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 flex items-center gap-2 text-xs text-slate-300 hover:text-white"
        title={lang === 'ru' ? 'Сравнить сохранённые конфигурации' : 'Compare saved configurations'}
      >
        <GitCompareArrows className="w-4 h-4 text-cyan-400" />
        <span className="hidden md:inline">{lang === 'ru' ? 'Сравнение' : 'Compare'}</span>
      </button>
      <button onClick={toggleFullscreen} className="w-8 h-8 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 flex items-center justify-center text-slate-400 hover:text-white">
        {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
      </button>
    </div>
  </header>;
};
