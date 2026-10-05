import React from 'react';
import {
  X,
  Clock,
  AlertTriangle,
  Radio,
  ArrowRight,
  ShieldAlert,
  CheckCircle,
  Zap,
  Play
} from 'lucide-react';
import { TimelineEvent } from '../types/simulation';

interface EventsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  events: TimelineEvent[];
  currentTimeSeconds: number;
  onSeek: (seconds: number) => void;
  onFocusSatellite?: (satId: string) => void;
  lang: 'ru' | 'en';
}

export const EventsDrawer: React.FC<EventsDrawerProps> = ({
  isOpen,
  onClose,
  events,
  currentTimeSeconds,
  onSeek,
  onFocusSatellite,
  lang
}) => {
  if (!isOpen) return null;

  const t = {
    title: lang === 'ru' ? 'Хронология событий симуляции' : 'Simulation Timeline Events',
    subtitle: lang === 'ru' ? 'Журнал отказов, переключений трафика и орбитальных событий' : 'Log of failures, routing handovers, and orbital events',
    jumpToTime: lang === 'ru' ? 'Перейти' : 'Jump',
    critical: lang === 'ru' ? 'Критический сбой' : 'Critical Failure',
    warning: lang === 'ru' ? 'Внимание' : 'Warning',
    info: lang === 'ru' ? 'Событие' : 'Info',
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-96 max-w-full bg-slate-950/95 border-l border-slate-800 shadow-2xl backdrop-blur-xl flex flex-col pointer-events-auto select-none animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80 bg-slate-900/50">
        <div className="flex items-center gap-2.5">
          <Clock className="w-4 h-4 text-cyan-400" />
          <div>
            <h3 className="text-sm font-semibold text-white font-tech">{t.title}</h3>
            <p className="text-[11px] text-slate-400">{t.subtitle}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Events List */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs">
        {events.map(ev => {
          const isPast = currentTimeSeconds > ev.timeSeconds;
          const isNear = Math.abs(currentTimeSeconds - ev.timeSeconds) < 600;

          let severityStyle = 'border-slate-800 bg-slate-900/40 text-slate-300';
          let icon = <CheckCircle className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;

          if (ev.severity === 'critical') {
            severityStyle = 'border-rose-500/50 bg-rose-950/30 text-rose-200';
            icon = <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
          } else if (ev.severity === 'warning') {
            severityStyle = 'border-amber-500/50 bg-amber-950/30 text-amber-200';
            icon = <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
          }

          return (
            <div
              key={ev.id}
              className={`p-3 rounded-xl border transition-all ${severityStyle} ${
                isNear ? 'ring-2 ring-cyan-500/60 shadow-lg shadow-cyan-950/40' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 font-bold">
                  {icon}
                  <span className="font-tech">{ev.title}</span>
                </div>
                <span className="font-mono-data font-bold text-cyan-400 text-[11px]">
                  {ev.timeFormatted}
                </span>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed mb-2.5">
                {ev.description}
              </p>

              <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px]">
                {ev.satelliteId && onFocusSatellite ? (
                  <button
                    onClick={() => onFocusSatellite(ev.satelliteId!)}
                    className="font-mono-data font-semibold text-cyan-400 hover:underline"
                  >
                    Показать {ev.satelliteId}
                  </button>
                ) : (
                  <span className="text-slate-500">Симуляция суточного цикла</span>
                )}

                <button
                  onClick={() => {
                    onSeek(ev.timeSeconds);
                    onClose();
                  }}
                  className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-cyan-900/60 hover:text-cyan-300 text-white font-medium flex items-center gap-1 transition-colors"
                >
                  <Play className="w-2.5 h-2.5 fill-current" />
                  <span>{t.jumpToTime}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
