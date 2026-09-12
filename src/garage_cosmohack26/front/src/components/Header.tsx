import { useState } from 'react';
import { ChevronDown, FileUp, Maximize2, Minimize2, Orbit, Plus } from 'lucide-react';
import { ConstellationConfig, SimulationTime } from '../types/simulation';
import { formatTimeSeconds } from '../utils/orbitalMechanics';

interface Props {
  config: ConstellationConfig | null;
  simulationTime: SimulationTime;
  onCreateProject: (mode: 'manual' | 'file') => void;
  lang: 'ru' | 'en';
}

export const Header = ({ config, simulationTime, onCreateProject, lang }: Props) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().then(() => setFullscreen(true));
    } else {
      void document.exitFullscreen().then(() => setFullscreen(false));
    }
  };

  const choose = (mode: 'manual' | 'file') => {
    setMenuOpen(false);
    onCreateProject(mode);
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

      <div className="relative ml-2">
        <button onClick={() => setMenuOpen(!menuOpen)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700/70 text-xs text-slate-200">
          <span className="text-slate-400">{lang === 'ru' ? 'Проект:' : 'Project:'}</span>
          <span className="font-semibold text-white">{config?.name ?? (lang === 'ru' ? 'не создан' : 'not created')}</span>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </button>
        {menuOpen && <div className="absolute left-0 mt-1.5 w-64 rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl py-1 z-50">
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">{lang === 'ru' ? 'Новый проект' : 'New project'}</div>
          <button onClick={() => choose('manual')} className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs text-slate-200 hover:bg-slate-800">
            <Plus className="w-4 h-4 text-cyan-400" />{lang === 'ru' ? 'Создать вручную' : 'Create manually'}
          </button>
          <button onClick={() => choose('file')} className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs text-slate-200 hover:bg-slate-800">
            <FileUp className="w-4 h-4 text-emerald-400" />{lang === 'ru' ? 'Создать из файла' : 'Create from file'}
          </button>
        </div>}
      </div>
    </div>

    <div className="text-xl font-bold font-mono-data text-white tracking-widest">
      {config ? formatTimeSeconds(simulationTime.timeSeconds) : '--:--:--'}
    </div>

    <button onClick={toggleFullscreen} className="w-8 h-8 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 flex items-center justify-center text-slate-400 hover:text-white">
      {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
    </button>
  </header>;
};
