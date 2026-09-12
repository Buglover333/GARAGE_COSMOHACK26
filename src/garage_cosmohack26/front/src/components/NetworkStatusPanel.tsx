import { useState } from 'react';
import { ChevronDown, ChevronUp, Radio, TrendingUp } from 'lucide-react';
import { CommunicationRoute, GroundStation, Satellite } from '../types/simulation';

interface NetworkStatusPanelProps {
  selectedStation: GroundStation | null;
  stations: GroundStation[];
  onSelectStation: (station: GroundStation) => void;
  activeRoute: CommunicationRoute | null;
  satellites: Satellite[];
  onOpenRouteModal: () => void;
  onFocusSatellite: (satId: string) => void;
  lang: 'ru' | 'en';
}

export const NetworkStatusPanel = ({
  selectedStation,
  stations,
  onSelectStation,
  activeRoute,
  onOpenRouteModal,
  onFocusSatellite,
  lang,
}: NetworkStatusPanelProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const reachable = activeRoute?.status !== 'offline';
  const gateway = stations.find(station => station.id === activeRoute?.gatewayStationId);

  return (
    <div className="absolute top-16 right-6 z-20 w-80 max-w-[calc(100vw-3rem)] pointer-events-auto select-none">
      <div className="rounded-2xl bg-slate-950/85 backdrop-blur-xl border border-slate-800/90 shadow-2xl shadow-black/60 overflow-hidden">
        <div onClick={() => setCollapsed(!collapsed)} className="flex items-center justify-between px-4 py-3.5 cursor-pointer border-b border-white/5">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">{lang === 'ru' ? 'Состояние сети' : 'Network Status'}</h2>
          </div>
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </div>

        {!collapsed && !selectedStation && <div className="p-8 text-center text-xs text-slate-500">
          Данные наземных пунктов и маршрутов появятся после создания проекта
        </div>}
        {!collapsed && selectedStation && <div className="p-4 space-y-4 text-xs">
          <div className="relative">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1.5">{lang === 'ru' ? 'Наземный пункт' : 'Ground site'}</div>
            <button onClick={() => setSelectorOpen(!selectorOpen)} className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-left">
              <div>
                <div className="font-semibold text-white">{selectedStation.name}</div>
                <div className="text-[10px] text-slate-400 font-mono-data">{selectedStation.lat.toFixed(2)}°, {selectedStation.lon.toFixed(2)}°</div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>
            {selectorOpen && <div className="absolute left-0 right-0 mt-1 z-50 rounded-xl bg-slate-900 border border-slate-700 py-1 shadow-2xl">
              {stations.map(station => <button
                key={station.id}
                onClick={() => { onSelectStation(station); setSelectorOpen(false); }}
                className={`w-full px-3 py-2 text-left hover:bg-slate-800 ${station.id === selectedStation.id ? 'text-emerald-300' : 'text-slate-300'}`}
              >
                <div className="font-medium">{station.name}</div>
                <div className="text-[10px] text-slate-500">{station.type} · {station.lat.toFixed(2)}°, {station.lon.toFixed(2)}°</div>
              </button>)}
            </div>}
          </div>

          <div className="flex items-center justify-between border-t border-slate-800 pt-3">
            <span className="text-slate-300">{lang === 'ru' ? 'Маршрут' : 'Route'}</span>
            <span className={`px-2.5 py-1 rounded-full border font-semibold ${reachable && activeRoute ? 'bg-emerald-950 border-emerald-500/40 text-emerald-400' : 'bg-rose-950 border-rose-500/40 text-rose-300'}`}>
              {reachable && activeRoute ? (lang === 'ru' ? 'Доступен' : 'Reachable') : (lang === 'ru' ? 'Недоступен' : 'Unreachable')}
            </span>
          </div>

          {activeRoute && <div className="space-y-2 border-t border-slate-800 pt-3">
            <div className="flex items-center gap-2 text-slate-200"><span className="w-2 h-2 rounded-full bg-emerald-400" />{selectedStation.name}</div>
            {activeRoute.satelliteHops.map(id => <button key={id} onClick={() => onFocusSatellite(id)} className="w-full flex items-center gap-2 p-1 text-left text-cyan-300 hover:bg-slate-900 rounded">
              <span className="w-2 h-2 rotate-45 bg-cyan-400" /><span className="font-mono-data font-semibold">{id}</span>
            </button>)}
            <div className="flex items-center gap-2 text-amber-300"><span className="w-2 h-2 bg-amber-400" />{gateway?.name ?? activeRoute.gatewayStationId}</div>
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-2.5 space-y-1.5 font-mono-data">
              <div className="flex justify-between"><span className="text-slate-400">{lang === 'ru' ? 'Задержка' : 'Latency'}</span><span className="text-white">{activeRoute.latencyMs == null ? '—' : `${activeRoute.latencyMs.toFixed(2)} ms`}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">{lang === 'ru' ? 'Длина пути' : 'Path length'}</span><span className="text-white">{activeRoute.totalRangeKm == null ? '—' : `${activeRoute.totalRangeKm.toFixed(0)} km`}</span></div>
            </div>
          </div>}

          <button onClick={onOpenRouteModal} disabled={!activeRoute} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 border border-slate-700 disabled:opacity-40">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            {lang === 'ru' ? 'Все маршруты' : 'All routes'}
          </button>
        </div>}
      </div>
    </div>
  );
};
