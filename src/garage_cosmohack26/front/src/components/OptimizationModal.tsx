import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Eye, GitCompareArrows, Save, Sparkles, Square, X } from 'lucide-react';
import { analyticsApi } from '../api/analytics';
import { ScenarioDto } from '../api/simulation';
import { ClientMetrics, OptimizationStage } from '../types/analytics';
import { formatTimeSeconds } from '../utils/orbitalMechanics';

interface Props {
  isOpen: boolean;
  scenario: ScenarioDto | null;
  onClose: () => void;
  onPreview: (scenario: ScenarioDto) => Promise<void>;
  onApply: (scenario: ScenarioDto) => Promise<void>;
  onSave: (scenario: ScenarioDto) => Promise<void>;
  onCompare: (scenario: ScenarioDto, label: string) => void;
}

const stageKey = (stage: OptimizationStage) => `${stage.requested_planes}:${stage.stage}`;
const metricsSummary = (metrics?: Record<string, ClientMetrics>) => {
  const values = Object.values(metrics ?? {});
  const average = (items: number[]) => items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : 0;
  return {
    meanAvailability: average(values.map(item => item.gateway_availability_pct)),
    minAvailability: values.length ? Math.min(...values.map(item => item.gateway_availability_pct)) : 0,
    maxInterruption: Math.max(0, ...values.map(item => item.max_interruption_s)),
    meanHops: average(values.flatMap(item => item.avg_hops === null ? [] : [item.avg_hops])),
  };
};

const compareStages = (a: OptimizationStage, b: OptimizationStage) => {
  if (a.met_target !== b.met_target) return a.met_target ? -1 : 1;
  const satellites = a.scenario.design.satellites.length - b.scenario.design.satellites.length;
  if (satellites !== 0) return satellites;
  return a.best_score - b.best_score;
};

export const OptimizationModal = ({ isOpen, scenario, onClose, onPreview, onApply, onSave, onCompare }: Props) => {
  const [minPlanes, setMinPlanes] = useState('2');
  const [maxPlanes, setMaxPlanes] = useState('5');
  const [stageSpec, setStageSpec] = useState('4,4,4');
  const [iterations, setIterations] = useState('30');
  const [seed, setSeed] = useState('0');
  const [results, setResults] = useState<OptimizationStage[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const currentPlanes = Math.max(1, scenario?.design.planes.length ?? 3);
    const satsPerPlane = Math.max(3, Math.ceil((scenario?.design.satellites.length ?? currentPlanes * 12) / currentPlanes));
    const base = Math.floor(satsPerPlane / 3);
    const remainder = satsPerPlane % 3;
    setMinPlanes(String(Math.max(1, currentPlanes - 1)));
    setMaxPlanes(String(Math.min(8, currentPlanes + 2)));
    setStageSpec([0, 1, 2].map(index => Math.max(1, base + (index < remainder ? 1 : 0))).join(','));
    setResults([]);
    setSelectedKey(null);
    setError(null);
    setMessage(null);
    return () => abortRef.current?.abort();
  }, [isOpen]);

  const selected = results.find(item => stageKey(item) === selectedKey) ?? null;
  const best = useMemo(() => [...results].sort(compareStages)[0] ?? null, [results]);
  const expectedStages = (() => {
    const min = Number(minPlanes); const max = Number(maxPlanes);
    const stages = stageSpec.split(',').filter(item => item.trim()).length;
    return Number.isInteger(min) && Number.isInteger(max) && max >= min ? (max - min + 1) * stages : 0;
  })();

  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (!scenario) return;
    const min = Number(minPlanes); const max = Number(maxPlanes); const count = Number(iterations); const randomSeed = Number(seed);
    const perPlane = stageSpec.split(',').map(item => Number(item.trim())).filter(value => Number.isFinite(value));
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) return setError('Проверьте диапазон количества плоскостей');
    if (max > 12) return setError('На фронтенде поиск ограничен двенадцатью плоскостями');
    if (perPlane.length < 1 || perPlane.length > 3 || perPlane.some(value => !Number.isInteger(value) || value <= 0)) return setError('Задайте от одного до трёх положительных целых этапов');
    if (!Number.isInteger(count) || count < 1 || count > 200) return setError('Количество итераций должно быть от 1 до 200');
    if (!Number.isInteger(randomSeed)) return setError('Seed должен быть целым числом');
    if (max * perPlane.reduce((sum, value) => sum + value, 0) > 100) return setError('На последнем этапе получится больше 100 спутников — уменьшите число плоскостей или спутников');

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setResults([]); setSelectedKey(null); setError(null); setMessage(null); setRunning(true);
    try {
      const completed = await analyticsApi.calculateOptimal(scenario, {
        minPlanes: min,
        maxPlanes: max,
        satellitesPerPlane: perPlane,
        iterations: count,
        seed: randomSeed,
        includeMetrics: true,
      }, stage => {
        setResults(previous => [...previous, stage]);
        setSelectedKey(previous => previous ?? stageKey(stage));
      }, controller.signal);
      const completedBest = [...completed].sort(compareStages)[0];
      if (completedBest) setSelectedKey(stageKey(completedBest));
      setMessage('Поиск завершён. Лучший найденный вариант отмечен ниже.');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') setMessage('Расчёт остановлен пользователем. Полученные этапы сохранены.');
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setRunning(false); }
    }
  };

  const perform = async (name: string, operation: () => Promise<void>, close = false) => {
    setAction(name); setError(null); setMessage(null);
    try { await operation(); if (close) onClose(); else setMessage('Конфигурация передана в текущую симуляцию.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setAction(null); }
  };

  if (!isOpen) return null;
  const selectedMetrics = selected ? metricsSummary(selected.metrics) : null;

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
    <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4"><div className="flex items-center gap-3"><Sparkles className="h-5 w-5 text-violet-400" /><div><h2 className="font-semibold text-white">Оптимизация деплоя</h2><p className="text-[11px] text-slate-400">Поиск лучшего расположения RAAN и фазирования для разных количеств плоскостей</p></div></div><button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button></div>

      <form onSubmit={event => void run(event)} className="grid grid-cols-[110px_110px_1fr_110px_100px_auto] items-end gap-3 border-b border-slate-800 p-5">
        {[[minPlanes, setMinPlanes, 'Мин. плоскостей'], [maxPlanes, setMaxPlanes, 'Макс. плоскостей'], [stageSpec, setStageSpec, 'Спутников/плоскость по этапам'], [iterations, setIterations, 'Итераций'], [seed, setSeed, 'Seed']] .map(([value, setter, label]) => <label key={String(label)} className="space-y-1 text-[10px] text-slate-400"><span>{String(label)}</span><input value={value as string} onChange={event => (setter as (value: string) => void)(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white" /></label>)}
        {running ? <button type="button" onClick={() => abortRef.current?.abort()} className="flex items-center justify-center gap-2 rounded-lg bg-rose-700 px-4 py-2 text-xs font-semibold text-white"><Square className="h-3 w-3" />Остановить</button> : <button disabled={!scenario} className="flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"><Sparkles className="h-3.5 w-3.5" />Рассчитать</button>}
      </form>

      <div className="grid min-h-0 flex-1 grid-cols-[380px_1fr]">
        <div className="overflow-y-auto border-r border-slate-800 p-4">
          {!scenario && <div className="rounded-xl border border-slate-800 p-6 text-center text-xs text-slate-500">Сначала загрузите конфигурацию.</div>}
          {running && <div className="mb-3 rounded-lg border border-violet-800/60 bg-violet-950/30 px-3 py-2 text-xs text-violet-300">Получено этапов: {results.length} из {expectedStages}. Следующий результат появится после завершения текущего этапа.</div>}
          {message && <div className="mb-3 rounded-lg border border-cyan-800/50 bg-cyan-950/30 px-3 py-2 text-xs text-cyan-300">{message}</div>}
          {error && <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">Ошибка: {error}</div>}
          <div className="space-y-2">{results.map(item => {
            const actualSatellites = item.scenario.design.satellites.length;
            const summary = metricsSummary(item.metrics);
            const isBest = stageKey(item) === (best ? stageKey(best) : '');
            const isSelected = stageKey(item) === selectedKey;
            return <button key={stageKey(item)} type="button" onClick={() => setSelectedKey(stageKey(item))} className={`w-full rounded-xl border p-3 text-left ${isSelected ? 'border-cyan-500/70 bg-cyan-950/30' : isBest ? 'border-emerald-700/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/50 hover:bg-slate-900'}`}><div className="flex items-center justify-between"><span className="text-xs font-semibold text-white">{item.requested_planes} плоск. · этап {item.stage}</span><span className={item.met_target ? 'text-[10px] text-emerald-400' : 'text-[10px] text-amber-400'}>{item.met_target ? 'цель достигнута' : 'ниже цели'}</span></div><div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-400"><span>{actualSatellites} спутников</span><span>{summary.minAvailability.toFixed(2)}% min</span><span>J={item.best_score.toFixed(1)}</span></div>{isBest && <div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-400"><Check className="h-3 w-3" />Лучший найденный вариант</div>}</button>;
          })}</div>
        </div>

        <div className="overflow-y-auto p-5">
          {!selected || !selectedMetrics ? <div className="flex h-full items-center justify-center text-xs text-slate-500">Запустите расчёт и выберите результат.</div> : <div className="space-y-5">
            <div className="flex items-start justify-between"><div><div className="text-[10px] uppercase tracking-wider text-slate-500">Выбранный вариант</div><h3 className="mt-1 text-base font-semibold text-white">{selected.requested_planes} плоскостей · этап {selected.stage}</h3><p className="text-[11px] text-slate-400">Фактически {selected.scenario.design.satellites.length} спутников, запрошено {selected.n_sat}</p></div><span className={`rounded-lg px-2.5 py-1 text-xs ${selected.met_target ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}>{selected.met_target ? 'Цель достигнута' : 'Цель не достигнута'}</span></div>
            <div className="grid grid-cols-4 gap-3">{[['Средняя доступность', `${selectedMetrics.meanAvailability.toFixed(2)}%`], ['Минимальная доступность', `${selectedMetrics.minAvailability.toFixed(2)}%`], ['Макс. перерыв', formatTimeSeconds(selectedMetrics.maxInterruption)], ['Средние хопы', selectedMetrics.meanHops.toFixed(2)]].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3"><div className="text-[10px] text-slate-500">{label}</div><div className="mt-1 font-mono text-sm text-cyan-300">{value}</div></div>)}</div>
            <div><div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Оптимальные плоскости</div><div className="overflow-hidden rounded-xl border border-slate-800"><table className="w-full text-xs"><thead className="bg-slate-900/80 text-slate-500"><tr><th className="px-3 py-2 text-left">ID</th><th className="px-3 py-2 text-right">RAAN</th><th className="px-3 py-2 text-right">Фазирование</th><th className="px-3 py-2 text-right">Спутников</th></tr></thead><tbody className="divide-y divide-slate-800">{selected.scenario.design.planes.map(plane => <tr key={plane.id} className="text-slate-300"><td className="px-3 py-2.5 font-medium text-white">{plane.id}</td><td className="px-3 py-2.5 text-right font-mono">{plane.raan_deg.toFixed(2)}°</td><td className="px-3 py-2.5 text-right font-mono">{plane.phase_deg.toFixed(2)}°</td><td className="px-3 py-2.5 text-right font-mono">{selected.scenario.design.satellites.filter(satellite => satellite.plane_id === plane.id).length}</td></tr>)}</tbody></table></div></div>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 p-3 text-[11px] text-slate-400"><span>Мин. спутников на плоскость: <b className="text-white">{selected.bounds.min_sats_per_plane}</b></span><span>Радиус зоны покрытия: <b className="text-white">{selected.bounds.footprint_radius_km.toFixed(0)} км</b></span><span>Расчётный шаг RAAN: <b className="text-white">{selected.bounds.raan_step_deg.toFixed(2)}°</b></span><span>Целевая доступность: <b className="text-white">{((scenario?.environment.target_availability ?? 0) * 100).toFixed(2)}%</b></span></div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-800 pt-4"><button type="button" disabled={action !== null} onClick={() => void perform('preview', () => onPreview(selected.scenario))} className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200 disabled:opacity-40"><Eye className="h-3.5 w-3.5" />Показать на модели</button><button type="button" onClick={() => onCompare(selected.scenario, `${selected.requested_planes} плоскостей · этап ${selected.stage}`)} className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200"><GitCompareArrows className="h-3.5 w-3.5" />Сравнить с исходной</button><button type="button" disabled={action !== null} onClick={() => void perform('apply', () => onApply(selected.scenario), true)} className="rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Применить</button><button type="button" disabled={action !== null} onClick={() => void perform('save', () => onSave(selected.scenario), true)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" />Сохранить как новую</button></div>
          </div>}
        </div>
      </div>
    </div>
  </div>;
};
