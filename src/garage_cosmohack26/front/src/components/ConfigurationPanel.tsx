import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FileCode,
  Orbit,
  Layers,
  Activity,
  AlertTriangle,
  Compass,
  Gauge,
  Rocket,
  CheckCircle2,
  Sliders,
  Eye,
  Settings2
} from 'lucide-react';
import { ConstellationConfig, Satellite } from '../types/simulation';
import { formatTimeSeconds } from '../utils/orbitalMechanics';

interface ConfigurationPanelProps {
  config: ConstellationConfig | null;
  satellites: Satellite[];
  simulationTime: number;
  onFocusSatellite: (satId: string) => void;
  onEditPlanes: () => void;
  lang: 'ru' | 'en';
}

export const ConfigurationPanel: React.FC<ConfigurationPanelProps> = ({
  config,
  satellites,
  simulationTime,
  onFocusSatellite,
  onEditPlanes,
  lang
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Derive counts from live satellites state
  const totalCount = satellites.length || config?.totalSatellites || 0;
  const offlineCount = satellites.filter(s => s.status === 'offline').length;
  const activeCount = totalCount - offlineCount;

  // Active failure status
  const activeFailure = config?.failures[0];
  const isFaultActiveNow =
    activeFailure &&
    simulationTime >= activeFailure.startSeconds &&
    simulationTime <= activeFailure.endSeconds;

  const t = {
    title: lang === 'ru' ? 'Текущая конфигурация' : 'Current Configuration',
    scenario: lang === 'ru' ? 'Сценарий' : 'Scenario',
    constellation: lang === 'ru' ? 'Группировка' : 'Constellation',
    totalSats: lang === 'ru' ? 'Всего спутников' : 'Total Satellites',
    activeSats: lang === 'ru' ? 'Активных' : 'Active',
    offlineSats: lang === 'ru' ? 'Недоступных' : 'Unavailable',
    orbitalStructure: lang === 'ru' ? 'Орбитальная структура' : 'Orbital Structure',
    planes: lang === 'ru' ? 'Плоскостей' : 'Planes',
    altitude: lang === 'ru' ? 'Высота орбиты' : 'Orbit Altitude',
    raan: lang === 'ru' ? 'RAAN' : 'RAAN',
    phasing: lang === 'ru' ? 'Фазирование' : 'Phasing',
    deploymentStage: lang === 'ru' ? 'Этап развёртывания' : 'Deployment Stage',
    batch: lang === 'ru' ? 'Очередь' : 'Batch',
    launched: lang === 'ru' ? 'Запущено' : 'Launched',
    apparatus: lang === 'ru' ? 'аппаратов' : 'spacecraft',
    failureSim: lang === 'ru' ? 'Моделирование отказов' : 'Failure Simulation',
  };

  return (
    <div className="absolute top-16 left-6 z-20 w-80 max-w-[calc(100vw-3rem)] pointer-events-auto select-none transition-all duration-300">
      <div className="rounded-2xl bg-slate-950/85 backdrop-blur-xl border border-slate-800/90 shadow-2xl shadow-black/60 overflow-hidden">
        {/* Panel Header */}
        <div
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center justify-between px-4 py-3.5 cursor-pointer hover:bg-slate-900/50 transition-colors border-b border-white/5"
        >
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-white tracking-tight">
              {t.title}
            </h2>
          </div>
          <button className="text-slate-400 hover:text-white transition-colors">
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>

        {/* Panel Body */}
        {!isCollapsed && !config && (
          <div className="p-8 text-center text-xs text-slate-500">
            Создайте проект, чтобы увидеть параметры группировки
          </div>
        )}
        {!isCollapsed && config && (
          <div className="p-4 space-y-4 text-xs">
            {/* Scenario file */}
            <div>
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">
                {t.scenario}
              </div>
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-900/90 border border-slate-800/80 font-mono-data text-slate-200">
                <FileCode className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="truncate">{config.fileName}</span>
              </div>
            </div>

            {/* Constellation summary */}
            <div>
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-2">
                {t.constellation}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-slate-300">
                  <div className="flex items-center gap-2">
                    <Orbit className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t.totalSats}</span>
                  </div>
                  <span className="font-mono-data font-semibold text-white">{totalCount}</span>
                </div>

                <div className="flex items-center justify-between text-slate-300">
                  <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{t.activeSats}</span>
                  </div>
                  <span className="font-mono-data font-semibold text-emerald-400">{activeCount}</span>
                </div>

                <div className="flex items-center justify-between text-slate-300">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={`w-3.5 h-3.5 ${offlineCount > 0 ? 'text-rose-400' : 'text-slate-500'}`} />
                    <span>{t.offlineSats}</span>
                  </div>
                  <span className={`font-mono-data font-semibold ${offlineCount > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                    {offlineCount}
                  </span>
                </div>
              </div>
            </div>

            {/* Orbital structure */}
            <div className="pt-2 border-t border-slate-800/70">
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-2">
                {t.orbitalStructure}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-slate-300">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t.planes}</span>
                  </div>
                  <span className="font-mono-data font-semibold text-white">{config.planes}</span>
                </div>

                <div className="flex items-center justify-between text-slate-300">
                  <div className="flex items-center gap-2">
                    <Gauge className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t.altitude}</span>
                  </div>
                  <span className="font-mono-data font-semibold text-white">
                    {config.altitudeKm} {lang === 'ru' ? 'км' : 'km'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-slate-300">
                  <div className="flex items-center gap-2">
                    <Compass className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t.raan}</span>
                  </div>
                  <span
                    className="max-w-40 truncate text-right font-mono-data font-semibold text-white"
                    title={config.orbitPlanes.map(plane => `${plane.id}: ${plane.raanDeg}°`).join(', ')}
                  >
                    {config.orbitPlanes.map(plane => plane.raanDeg).join('°, ')}°
                  </span>
                </div>

                <div className="flex items-center justify-between text-slate-300">
                  <div className="flex items-center gap-2">
                    <Orbit className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t.phasing}</span>
                  </div>
                  <span
                    className="max-w-40 truncate text-right font-mono-data font-semibold text-white"
                    title={config.orbitPlanes.map(plane => `${plane.id}: ${plane.phaseDeg}°`).join(', ')}
                  >
                    {config.orbitPlanes.map(plane => plane.phaseDeg).join('°, ')}°
                  </span>
                </div>
              </div>
              <button
                onClick={onEditPlanes}
                className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50 text-xs font-semibold text-slate-200"
              >
                <Settings2 className="w-3.5 h-3.5 text-cyan-400" />
                {lang === 'ru' ? 'Настроить плоскости' : 'Configure planes'}
              </button>
            </div>

            {/* Deployment Stage */}
            <div className="pt-2 border-t border-slate-800/70">
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-2">
                {t.deploymentStage}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-slate-300">
                  <div className="flex items-center gap-2">
                    <Rocket className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{t.batch}</span>
                  </div>
                  <span className="font-mono-data font-semibold text-white">{config.deploymentBatch}</span>
                </div>

                <div className="flex items-center justify-between text-slate-300">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{t.launched}</span>
                  </div>
                  <span className="font-mono-data font-semibold text-white">
                    {config.launchedCount} {t.apparatus}
                  </span>
                </div>
              </div>
            </div>

            {/* Failure Simulation */}
            {activeFailure && (
              <div className="pt-2 border-t border-slate-800/70">
                <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-2">
                  {t.failureSim}
                </div>
                <div
                  onClick={() => onFocusSatellite(activeFailure.satelliteId)}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    isFaultActiveNow
                      ? 'bg-rose-950/40 border-rose-500/50 hover:bg-rose-900/40 text-rose-300 shadow-md shadow-rose-950/40'
                      : 'bg-slate-900/80 border-slate-800 hover:bg-slate-800 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 font-semibold text-xs">
                      <AlertTriangle className={`w-3.5 h-3.5 ${isFaultActiveNow ? 'text-rose-400 animate-bounce' : 'text-amber-400'}`} />
                      <span>{activeFailure.satelliteId}</span>
                    </div>
                    <span className="text-[11px] font-mono-data font-medium text-slate-400">
                      {formatTimeSeconds(activeFailure.startSeconds).slice(0, 5)} – {formatTimeSeconds(activeFailure.endSeconds).slice(0, 5)}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 leading-relaxed flex items-center justify-between mt-1">
                    <span>{isFaultActiveNow ? (lang === 'ru' ? 'Активный отказ' : 'Active failure') : (lang === 'ru' ? 'Запланированное окно отказа' : 'Scheduled failure window')}</span>
                    <Eye className="w-3 h-3 text-slate-400 ml-1 shrink-0" />
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
};
