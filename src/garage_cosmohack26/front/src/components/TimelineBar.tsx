import React, { useRef } from 'react';
import {
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { SimulationTime, TimelineEvent } from '../types/simulation';
import { formatTimeSeconds } from '../utils/orbitalMechanics';

interface TimelineBarProps {
  simulationTime: SimulationTime;
  onSeek: (seconds: number) => void;
  onSpeedChange: (speed: SimulationTime['speed']) => void;
  onOpenEventsDrawer?: () => void;
  events: TimelineEvent[];
  lang: 'ru' | 'en';
}

export const TimelineBar: React.FC<TimelineBarProps> = ({
  simulationTime,
  onSeek,
  onSpeedChange,
  events,
  lang
}) => {
  const trackRef = useRef<HTMLDivElement>(null);

  const totalSecondsInDay = simulationTime.horizonSeconds;
  const progressRatio = Math.min(1, Math.max(0, simulationTime.timeSeconds / totalSecondsInDay));
  const progressPercent = progressRatio * 100;

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    onSeek(ratio * totalSecondsInDay);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const moveX = moveEvent.clientX - rect.left;
      const moveRatio = Math.max(0, Math.min(1, moveX / rect.width));
      onSeek(moveRatio * totalSecondsInDay);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const jumpSeconds = (delta: number) => {
    let next = (simulationTime.timeSeconds + delta) % totalSecondsInDay;
    if (next < 0) next += totalSecondsInDay;
    onSeek(next);
  };

  const t = {
    events: lang === 'ru' ? 'События' : 'Events',
  };

  return (
    <div className="absolute bottom-4 left-6 right-6 z-20 pointer-events-auto select-none">
      <div className="flex items-center gap-4 px-4 py-3 rounded-2xl bg-slate-950/90 backdrop-blur-xl border border-slate-800/90 shadow-2xl shadow-black/80">
        {/* Left playback controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => jumpSeconds(-3600)}
            title="-1 час"
            className="w-8 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => jumpSeconds(3600)}
            title="+1 час"
            className="w-8 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          {/* Speed selector */}
          <div className="flex items-center gap-0.5 ml-1 p-1 bg-slate-900/90 rounded-xl border border-slate-800">
            {([10, 50, 100] as const).map(spd => (
              <button
                key={spd}
                onClick={() => onSpeedChange(spd)}
                className={`px-2.5 py-1 text-xs font-mono-data font-semibold rounded-lg transition-all ${
                  simulationTime.speed === spd
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        {/* Center Timeline Scrubber */}
        <div className="flex-1 px-4 relative">
          {/* Floating Current Time Tag directly above scrubber thumb */}
          <div
            style={{ left: `${progressPercent}%` }}
            className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded-md bg-slate-900/95 border border-slate-700/80 text-[11px] font-mono-data font-bold text-white shadow-lg pointer-events-none whitespace-nowrap transition-all duration-75"
          >
            {formatTimeSeconds(simulationTime.timeSeconds)}
            <div className="w-1.5 h-1.5 bg-slate-900 rotate-45 mx-auto -mb-1 border-r border-b border-slate-700" />
          </div>

          {/* Track Bar */}
          <div
            ref={trackRef}
            onPointerDown={handleTrackPointerDown}
            className="h-2 w-full bg-slate-800/80 hover:bg-slate-800 rounded-full relative cursor-pointer group"
          >
            {/* Event Markers along the timeline */}
            {events.map(ev => {
              const posPct = (ev.timeSeconds / totalSecondsInDay) * 100;
              return (
                <div
                  key={ev.id}
                  style={{ left: `${posPct}%` }}
                  title={`${ev.timeFormatted}: ${ev.title}`}
                  className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-3 -translate-x-1/2 rounded-full pointer-events-none ${
                    ev.severity === 'critical'
                      ? 'bg-rose-500 ring-2 ring-rose-900/50'
                      : ev.severity === 'warning'
                      ? 'bg-amber-400'
                      : 'bg-cyan-400'
                  }`}
                />
              );
            })}

            {/* Filled Active Progress */}
            <div
              style={{ width: `${progressPercent}%` }}
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full relative"
            >
              {/* Draggable Thumb */}
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg shadow-cyan-500/50 ring-2 ring-blue-500 group-hover:scale-125 transition-transform" />
            </div>
          </div>

          {/* Time Labels beneath track */}
          <div className="flex justify-between text-[10px] font-mono-data text-slate-400 mt-2 px-0.5 select-none">
            {[0, 0.25, 0.5, 0.75, 1].map(part => (
              <span key={part}>{formatTimeSeconds(totalSecondsInDay * part).slice(0, 5)}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
