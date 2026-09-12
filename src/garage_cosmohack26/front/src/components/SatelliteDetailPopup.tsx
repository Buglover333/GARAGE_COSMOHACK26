import { Activity, CheckCircle2, Moon, Power, Sun, X } from 'lucide-react';
import { Satellite } from '../types/simulation';

interface Props {
  satellite: Satellite | null;
  onClose: () => void;
  onDisableSatellite: (satelliteId: string) => void;
  onEnableSatellite: (satelliteId: string) => void;
  isDisabling: boolean;
  isEnabling: boolean;
  lang: 'ru' | 'en';
}

export const SatelliteDetailPopup = ({
  satellite,
  onClose,
  onDisableSatellite,
  onEnableSatellite,
  isDisabling,
  isEnabling,
  lang,
}: Props) => {
  if (!satellite) return null;
  const inRoute = satellite.status === 'in_route';
  const offline = satellite.status === 'offline';
  const busy = isDisabling || isEnabling;

  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 w-80 pointer-events-auto select-none">
      <div className="rounded-2xl bg-slate-950/90 backdrop-blur-xl border border-slate-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div>
            <div className="text-sm font-bold text-white font-tech">{satellite.name}</div>
            <div className="text-[10px] text-slate-400">
              {lang === 'ru' ? 'Плоскость' : 'Plane'} {satellite.planeIndex + 1} ·{' '}
              {lang === 'ru' ? 'слот' : 'slot'} {satellite.satIndex + 1}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 text-xs">
          <div
            className={`flex items-center gap-2 rounded-xl border p-2.5 ${
              offline
                ? 'border-rose-500/40 text-rose-300'
                : inRoute
                  ? 'border-cyan-500/40 text-cyan-300'
                  : 'border-emerald-500/30 text-emerald-300'
            }`}
          >
            {inRoute ? <Activity className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            {offline
              ? lang === 'ru'
                ? 'Недоступен'
                : 'Unavailable'
              : inRoute
                ? lang === 'ru'
                  ? 'В активном маршруте'
                  : 'In active route'
                : lang === 'ru'
                  ? 'Активен'
                  : 'Active'}
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono-data">
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-2.5">
              <div className="text-[10px] text-slate-400 font-sans">
                {lang === 'ru' ? 'Подспутниковая точка' : 'Subsatellite point'}
              </div>
              <div className="mt-1 text-white">
                {satellite.lat.toFixed(2)}°, {satellite.lon.toFixed(2)}°
              </div>
            </div>
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-2.5">
              <div className="text-[10px] text-slate-400 font-sans">
                {lang === 'ru' ? 'Орбита' : 'Orbit'}
              </div>
              <div className="mt-1 text-white">{satellite.altitudeKm} km</div>
            </div>
            <div className="col-span-2 rounded-xl bg-slate-900 border border-slate-800 p-2.5 flex items-center gap-2">
              {satellite.sunlit ? (
                <Sun className="w-4 h-4 text-amber-300" />
              ) : (
                <Moon className="w-4 h-4 text-slate-300" />
              )}
              <span>
                {satellite.sunlit
                  ? lang === 'ru'
                    ? 'Освещён Солнцем'
                    : 'Sunlit'
                  : lang === 'ru'
                    ? 'В тени Земли'
                    : 'In Earth shadow'}
              </span>
            </div>
          </div>

          {offline ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onEnableSatellite(satellite.id)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/50 bg-emerald-950/40 px-3 py-2.5 font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
            >
              <Power className="h-4 w-4" />
              {isEnabling
                ? lang === 'ru'
                  ? 'Включение…'
                  : 'Enabling…'
                : lang === 'ru'
                  ? 'Включить спутник'
                  : 'Enable satellite'}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDisableSatellite(satellite.id)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/50 bg-rose-950/40 px-3 py-2.5 font-semibold text-rose-300 transition-colors hover:bg-rose-900/50 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
            >
              <Power className="h-4 w-4" />
              {isDisabling
                ? lang === 'ru'
                  ? 'Отключение…'
                  : 'Disabling…'
                : lang === 'ru'
                  ? 'Отключить спутник'
                  : 'Disable satellite'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};