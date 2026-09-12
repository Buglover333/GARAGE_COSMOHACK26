import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';

interface LegendOverlayProps {
  lang: 'ru' | 'en';
}

export const LegendOverlay: React.FC<LegendOverlayProps> = ({ lang }) => {
  const [isOpen, setIsOpen] = useState(false);

  const t = {
    activeSat: lang === 'ru' ? 'Активный спутник' : 'Active Satellite',
    offlineSat: lang === 'ru' ? 'Недоступный спутник' : 'Unavailable Satellite',
    inRouteSat: lang === 'ru' ? 'Спутник в маршруте' : 'Satellite in Route',
    clientStation: lang === 'ru' ? 'Наземный пункт (клиент)' : 'Ground Station (Client)',
    gatewayStation: lang === 'ru' ? 'Наземный пункт (шлюз)' : 'Ground Station (Gateway)',
    islLink: lang === 'ru' ? 'Межспутниковая связь' : 'Inter-Satellite Link (ISL)',
    orbitPlane: lang === 'ru' ? 'Орбитальная плоскость' : 'Orbital Plane',
    legend: lang === 'ru' ? 'Легенда' : 'Legend',
  };

  return (
    <div className="absolute bottom-24 left-6 z-20 pointer-events-auto select-none">
      <div className="rounded-xl bg-slate-950/85 backdrop-blur-xl border border-slate-800/80 shadow-xl overflow-hidden transition-all duration-200">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-900/40 transition-colors border-b border-white/5"
        >
          <div className="flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-cyan-400" />
            <span>{t.legend}</span>
          </div>
          {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronUp className="w-3.5 h-3.5 text-slate-500" />}
        </button>

        {isOpen && (
          <div className="p-3 space-y-2 text-xs">
            {/* Active Sat */}
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50 shrink-0" />
              <span className="text-slate-300">{t.activeSat}</span>
            </div>

            {/* Offline Sat */}
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50 shrink-0" />
              <span className="text-slate-300">{t.offlineSat}</span>
            </div>

            {/* In Route Sat */}
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-cyan-400 shadow-sm shadow-cyan-400/50 rotate-45 shrink-0" />
              <span className="text-slate-300">{t.inRouteSat}</span>
            </div>

            {/* Client Station */}
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400 shadow-sm shadow-sky-400/50 shrink-0" />
              <span className="text-slate-300">{t.clientStation}</span>
            </div>

            {/* Gateway Station */}
            <div className="flex items-center gap-2.5">
              <span className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[8px] border-b-amber-400 shrink-0" />
              <span className="text-slate-300">{t.gatewayStation}</span>
            </div>

            {/* ISL line */}
            <div className="flex items-center gap-2.5">
              <span className="w-4 h-0.5 bg-emerald-400 rounded-full shrink-0 shadow-sm shadow-emerald-400/50" />
              <span className="text-slate-300">{t.islLink}</span>
            </div>

            {/* Orbit line */}
            <div className="flex items-center gap-2.5">
              <span className="w-4 h-0.5 border-t border-dashed border-sky-400 shrink-0" />
              <span className="text-slate-300">{t.orbitPlane}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
