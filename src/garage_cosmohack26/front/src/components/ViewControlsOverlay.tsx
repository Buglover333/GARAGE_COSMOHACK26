import React, { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Minus,
  Eye,
  EyeOff,
  Info,
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
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const legendRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLegendOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!legendRef.current?.contains(event.target as Node)) setIsLegendOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [isLegendOpen]);

  const t = {
    orbits: lang === 'ru' ? 'Орбиты' : 'Orbits',
    coverage: lang === 'ru' ? 'Покрытие' : 'Coverage',
    labels: lang === 'ru' ? 'Метки' : 'Labels',
    legend: lang === 'ru' ? 'Легенда' : 'Legend',
    activeSat: lang === 'ru' ? 'Активный спутник' : 'Active Satellite',
    offlineSat: lang === 'ru' ? 'Недоступный спутник' : 'Unavailable Satellite',
    inRouteSat: lang === 'ru' ? 'Спутник в маршруте' : 'Satellite in Route',
    clientStation: lang === 'ru' ? 'Наземный пункт (клиент)' : 'Ground Station (Client)',
    gatewayStation: lang === 'ru' ? 'Наземный пункт (шлюз)' : 'Ground Station (Gateway)',
    islLink: lang === 'ru' ? 'Межспутниковая связь' : 'Inter-Satellite Link (ISL)',
    orbitPlane: lang === 'ru' ? 'Орбитальная плоскость' : 'Orbital Plane',
    coverageArea: lang === 'ru' ? 'Зона покрытия' : 'Coverage Area',
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
      <div ref={legendRef} className="absolute right-20 bottom-24 z-20 flex items-center gap-1.5 bg-slate-950/85 p-1 rounded-xl border border-slate-800/80 shadow-xl backdrop-blur-xl pointer-events-auto select-none">
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

        <div className="h-5 w-px bg-slate-800" />
        <button
          type="button"
          onClick={() => setIsLegendOpen(previous => !previous)}
          aria-expanded={isLegendOpen}
          title={t.legend}
          className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors ${isLegendOpen ? 'bg-cyan-950/50 text-cyan-300' : 'text-slate-400 hover:bg-slate-900/60 hover:text-white'}`}
        >
          <Info className="h-3.5 w-3.5" />
        </button>

        {isLegendOpen && (
          <div className="absolute bottom-full right-0 mb-2 w-64 overflow-hidden rounded-xl border border-slate-800/90 bg-slate-950/95 shadow-2xl shadow-black/60 backdrop-blur-xl">
            <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2 text-xs font-semibold text-slate-200">
              <Info className="h-3.5 w-3.5 text-cyan-400" />
              <span>{t.legend}</span>
            </div>
            <div className="space-y-2.5 p-3 text-xs">
              <div className="flex items-center gap-2.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" /><span className="text-slate-300">{t.activeSat}</span></div>
              <div className="flex items-center gap-2.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50" /><span className="text-slate-300">{t.offlineSat}</span></div>
              <div className="flex items-center gap-2.5"><span className="h-2.5 w-2.5 shrink-0 rotate-45 rounded-sm bg-cyan-400 shadow-sm shadow-cyan-400/50" /><span className="text-slate-300">{t.inRouteSat}</span></div>
              <div className="flex items-center gap-2.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-400 shadow-sm shadow-sky-400/50" /><span className="text-slate-300">{t.clientStation}</span></div>
              <div className="flex items-center gap-2.5"><span className="h-0 w-0 shrink-0 border-b-[8px] border-l-[5px] border-r-[5px] border-b-amber-400 border-l-transparent border-r-transparent" /><span className="text-slate-300">{t.gatewayStation}</span></div>
              <div className="flex items-center gap-2.5"><span className="h-0.5 w-4 shrink-0 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" /><span className="text-slate-300">{t.islLink}</span></div>
              <div className="flex items-center gap-2.5"><span className="h-0.5 w-4 shrink-0 border-t border-dashed border-sky-400" /><span className="text-slate-300">{t.orbitPlane}</span></div>
              <div className="flex items-center gap-2.5"><span className="h-3 w-4 shrink-0 rounded-sm border border-cyan-300 bg-cyan-400/40 shadow-sm shadow-cyan-400/40" /><span className="text-slate-300">{t.coverageArea}</span></div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
