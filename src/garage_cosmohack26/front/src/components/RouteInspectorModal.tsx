import { Check, Radio, X } from 'lucide-react';
import { CommunicationRoute } from '../types/simulation';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  routes: CommunicationRoute[];
  activeRouteId: string;
  onSelectRoute: (route: CommunicationRoute) => void;
  lang: 'ru' | 'en';
}

export const RouteInspectorModal = ({ isOpen, onClose, routes, activeRouteId, onSelectRoute, lang }: Props) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2"><Radio className="w-4 h-4 text-emerald-400" /><h3 className="font-semibold text-white">{lang === 'ru' ? 'Маршруты бэкенда' : 'Backend routes'}</h3></div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto max-h-[70vh]">
          {routes.length === 0 && <div className="py-10 text-center text-slate-400">{lang === 'ru' ? 'Маршрутов нет' : 'No routes'}</div>}
          {routes.map(route => {
            const active = route.id === activeRouteId;
            return <button key={route.id} onClick={() => onSelectRoute(route)} className={`w-full p-4 rounded-xl border text-left ${active ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/50 hover:bg-slate-900'}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono-data text-xs text-white break-all">{route.name}</span>
                {active && <Check className="w-4 h-4 shrink-0 text-emerald-400" />}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                <span className={route.status === 'offline' ? 'text-rose-300' : 'text-emerald-300'}>{route.status === 'offline' ? (lang === 'ru' ? 'Недоступен' : 'Unreachable') : (lang === 'ru' ? 'Доступен' : 'Reachable')}</span>
                <span className="text-slate-400">{route.satelliteHops.length} hops</span>
                <span className="text-slate-300 text-right">{route.latencyMs == null ? '—' : `${route.latencyMs.toFixed(2)} ms`}</span>
              </div>
            </button>;
          })}
        </div>
      </div>
    </div>
  );
};
