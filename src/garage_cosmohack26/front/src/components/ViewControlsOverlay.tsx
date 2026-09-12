import React from 'react';
import {
  Plus,
  Minus,
  Eye,
  EyeOff,
} from 'lucide-react';
import { SceneLayers } from '../types/simulation';

interface ViewControlsOverlayProps {
  layers: SceneLayers;
  onToggleLayer: (layerKey: keyof SceneLayers) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  lang: 'ru' | 'en';
}

export const ViewControlsOverlay: React.FC<ViewControlsOverlayProps> = ({
  layers,
  onToggleLayer,
  onZoomIn,
  onZoomOut,
  lang
}) => {
  const t = {
    orbits: lang === 'ru' ? 'Орбиты' : 'Orbits',
    coverage: lang === 'ru' ? 'Покрытие' : 'Coverage',
    labels: lang === 'ru' ? 'Метки' : 'Labels',
  };

  return (
    <>
      {/* Right vertical camera navigation tools */}
      <div className="absolute right-6 bottom-24 z-20 flex flex-col items-center gap-2 pointer-events-auto select-none">
        {/* Zoom In */}
        <button
          onClick={onZoomIn}
          title={lang === 'ru' ? 'Приблизить' : 'Zoom In'}
          className="w-10 h-10 rounded-xl bg-slate-950/85 hover:bg-slate-900 border border-slate-800/90 text-slate-300 hover:text-white flex items-center justify-center shadow-lg backdrop-blur-xl transition-all"
        >
          <Plus className="w-4 h-4" />
        </button>

        {/* Zoom Out */}
        <button
          onClick={onZoomOut}
          title={lang === 'ru' ? 'Отдалить' : 'Zoom Out'}
          className="w-10 h-10 rounded-xl bg-slate-950/85 hover:bg-slate-900 border border-slate-800/90 text-slate-300 hover:text-white flex items-center justify-center shadow-lg backdrop-blur-xl transition-all"
        >
          <Minus className="w-4 h-4" />
        </button>

      </div>

      {/* Bottom Horizontal Layer Toggles (exact pills from screenshot: [Орбиты], [Поверхность], [Покрытие]) */}
      <div className="absolute right-20 bottom-24 z-20 flex items-center gap-1.5 bg-slate-950/85 p-1 rounded-xl border border-slate-800/80 shadow-xl backdrop-blur-xl pointer-events-auto select-none">
        {/* Orbits Toggle */}
        <button
          onClick={() => onToggleLayer('showOrbits')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            layers.showOrbits
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${layers.showOrbits ? 'bg-white' : 'bg-slate-500'}`} />
          <span>{t.orbits}</span>
        </button>

        {/* Coverage Cones Toggle */}
        <button
          onClick={() => onToggleLayer('showCoverageCones')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            layers.showCoverageCones
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${layers.showCoverageCones ? 'bg-white' : 'bg-slate-500'}`} />
          <span>{t.coverage}</span>
        </button>

        {/* Labels Toggle */}
        <button
          onClick={() => onToggleLayer('showLabels')}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            layers.showLabels
              ? 'text-cyan-400 bg-cyan-950/30'
              : 'text-slate-500 hover:text-slate-300'
          }`}
          title={t.labels}
        >
          {layers.showLabels ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
      </div>
    </>
  );
};
