import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Eye, GitCompareArrows, Plus, Save, Sparkles, Square, Trash2, Upload, X } from 'lucide-react';
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

interface GroundSiteDraft {
  id: string;
  name: string;
  role: 'gateway' | 'client';
  lat_deg: string;
  lon_deg: string;
}

const MAX_STAGES = 10;
const MIN_STAGES = 1;

// Module-level cache so results survive modal close/reopen.
let cachedResults: OptimizationStage[] = [];
let cachedBase: ScenarioDto | null = null;
let cachedBaseName: string | null = null;

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

const siteToDraft = (site: ScenarioDto['ground_sites'][number]): GroundSiteDraft => ({
  id: site.id,
  name: site.name ?? site.id,
  role: site.role,
  lat_deg: String(site.lat_deg),
  lon_deg: String(site.lon_deg),
});

const draftToSite = (draft: GroundSiteDraft) => ({
  id: draft.id.trim(),
  name: draft.name.trim() || draft.id.trim(),
  role: draft.role,
  lat_deg: Number(draft.lat_deg),
  lon_deg: Number(draft.lon_deg),
});

export const OptimizationModal = ({ isOpen, scenario, onClose, onPreview, onApply, onSave, onCompare }: Props) => {
  const [minPlanes, setMinPlanes] = useState('2');
  const [maxPlanes, setMaxPlanes] = useState('5');
  const [stageCount, setStageCount] = useState(3);
  const [stageSats, setStageSats] = useState<string[]>(['4', '4', '4']);
  const [iterations, setIterations] = useState('30');
  const [seed, setSeed] = useState('0');
  const [baseScenario, setBaseScenario] = useState<ScenarioDto | null>(cachedBase);
  const [baseName, setBaseName] = useState<string | null>(cachedBaseName);
  const [results, setResults] = useState<OptimizationStage[]>(cachedResults);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showBaseEditor, setShowBaseEditor] = useState(false);
  const [sitesDraft, setSitesDraft] = useState<GroundSiteDraft[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persist results to module cache whenever they change.
  useEffect(() => { cachedResults = results; }, [results]);
  useEffect(() => { cachedBase = baseScenario; }, [baseScenario]);
  useEffect(() => { cachedBaseName = baseName; }, [baseName]);

  // Seed base scenario + editor state when the modal opens or the base changes.
  useEffect(() => {
    if (!isOpen) return;
    // If no cached upload, fall back to the live scenario.
    const effective = cachedBase ?? scenario;
    if (effective && !cachedBase) {
      setBaseScenario(effective);
      setBaseName(effective.meta.title || effective.meta.id);
    }
    if (effective) {
      setSitesDraft(effective.ground_sites.map(siteToDraft));
    }
    const currentPlanes = Math.max(1, effective?.design.planes.length ?? 3);
    const satsPerPlane = Math.max(3, Math.ceil((effective?.design.satellites.length ?? currentPlanes * 12) / currentPlanes));
    const base = Math.floor(satsPerPlane / 3);
    const remainder = satsPerPlane % 3;
    setMinPlanes(String(Math.max(1, currentPlanes - 1)));
    setMaxPlanes(String(Math.min(8, currentPlanes + 2)));
    setStageSats([0, 1, 2].map(index => String(Math.max(1, base + (index < remainder ? 1 : 0)))));
    setStageCount(3);
    setError(null);
    setMessage(null);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, scenario]);

  // ------------------------------------------------------------------
  // Environment editing
  // ------------------------------------------------------------------
  const updateEnvironment = (key: keyof ScenarioDto['environment'], value: string) => {
    if (!baseScenario) return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    setBaseScenario({ ...baseScenario, environment: { ...baseScenario.environment, [key]: numeric } });
  };

  // ------------------------------------------------------------------
  // Ground-site editing
  // ------------------------------------------------------------------
  const updateSite = (index: number, patch: Partial<GroundSiteDraft>) => {
    setSitesDraft(previous => {
      const next = [...previous];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const addSite = () => {
    setSitesDraft(previous => [
      ...previous,
      { id: `site_${previous.length + 1}`, name: '', role: 'client', lat_deg: '0', lon_deg: '0' },
    ]);
  };

  const removeSite = (index: number) => {
    setSitesDraft(previous => previous.filter((_, i) => i !== index));
  };

  const commitSites = () => {
    if (!baseScenario) return;
    const parsed = sitesDraft.map(draftToSite);
    const invalid = parsed.find(site => !site.id || !Number.isFinite(site.lat_deg) || !Number.isFinite(site.lon_deg));
    if (invalid) {
      setError('Проверьте идентификаторы, широту и долготу наземных станций');
      return;
    }
    setBaseScenario({ ...baseScenario, ground_sites: parsed });
    setError(null);
    setMessage('Наземные станции обновлены');
  };

  // ------------------------------------------------------------------
  // Upload / discard
  // ------------------------------------------------------------------
  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as Partial<ScenarioDto>;
      if (!parsed.environment || !Array.isArray(parsed.ground_sites) || !parsed.design) {
        setError('Файл должен содержать поля "environment", "design" и "ground_sites"');
        return;
      }
      setBaseScenario(parsed as ScenarioDto);
      setBaseName(file.name);
      setSitesDraft(parsed.ground_sites.map(siteToDraft));
      setError(null);
      setMessage(`Базовый сценарий загружен: ${file.name}`);
    } catch (cause) {
      setError(cause instanceof Error ? `Не удалось прочитать файл: ${cause.message}` : 'Не удалось прочитать файл');
    }
  };

  const resetBase = () => {
    if (!scenario) return;
    setBaseScenario(scenario);
    setBaseName(scenario.meta.title || scenario.meta.id);
    setSitesDraft(scenario.ground_sites.map(siteToDraft));
    setMessage(null);
  };

  const discardResults = () => {
    setResults([]);
    setSelectedKey(null);
    cachedResults = [];
    setMessage('Результаты очищены');
  };

  const changeStageCount = (next: number) => {
    const clamped = Math.max(MIN_STAGES, Math.min(MAX_STAGES, Math.floor(next) || MIN_STAGES));
    setStageCount(clamped);
    setStageSats(previous => {
      if (clamped === previous.length) return previous;
      if (clamped < previous.length) return previous.slice(0, clamped);
      const last = previous[previous.length - 1] ?? '4';
      return [...previous, ...Array.from({ length: clamped - previous.length }, () => last)];
    });
  };

  const selected = results.find(item => stageKey(item) === selectedKey) ?? null;
  const best = useMemo(() => [...results].sort(compareStages)[0] ?? null, [results]);
  const expectedStages = (() => {
    const min = Number(minPlanes); const max = Number(maxPlanes);
    return Number.isInteger(min) && Number.isInteger(max) && max >= min
      ? (max - min + 1) * stageCount
      : 0;
  })();

  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (!baseScenario) return;
    const min = Number(minPlanes); const max = Number(maxPlanes); const count = Number(iterations); const randomSeed = Number(seed);
    const perPlane = stageSats.map(item => Number(item.trim())).filter(value => Number.isFinite(value));
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) return setError('Проверьте диапазон количества плоскостей');
    if (max > 12) return setError('На фронтенде поиск ограничен двенадцатью плоскостями');
    if (perPlane.length < 1 || perPlane.length > MAX_STAGES || perPlane.some(value => !Number.isInteger(value) || value <= 0)) return setError(`Задайте от одного до ${MAX_STAGES} положительных целых этапов`);
    if (!Number.isInteger(count) || count < 1 || count > 200) return setError('Количество итераций должно быть от 1 до 200');
    if (!Number.isInteger(randomSeed)) return setError('Seed должен быть целым числом');
    if (max * perPlane.reduce((sum, value) => sum + value, 0) > 100) return setError('На последнем этапе получится больше 100 спутников');

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // Keep previous results — they're only cleared by "Очистить результаты".
    setSelectedKey(null); setError(null); setMessage(null); setRunning(true);
    try {
      const completed = await analyticsApi.calculateOptimal(baseScenario, {
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
      setMessage('Поиск завершён. Результаты сохранены — очистите их вручную, когда закончите.');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') setMessage('Расчёт остановлен. Промежуточные результаты сохранены.');
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
    <div className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-violet-400" />
          <div>
            <h2 className="font-semibold text-white">Оптимизация деплоя</h2>
            <p className="text-[11px] text-slate-400">Поиск лучшего расположения RAAN и фазирования для разных количеств плоскостей</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
      </div>

      {/* Base-scenario banner */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/40 px-5 py-2.5">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700">
            <Upload className="h-3.5 w-3.5" />Загрузить базовый сценарий
          </button>
          <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={event => void handleUpload(event)} className="hidden" />
          <button type="button" onClick={() => setShowBaseEditor(previous => !previous)} className={`rounded-lg border px-3 py-1.5 text-xs ${showBaseEditor ? 'border-cyan-500/60 bg-cyan-950/40 text-cyan-300' : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>
            {showBaseEditor ? 'Скрыть редактор' : 'Редактировать параметры'}
          </button>
          <div className="text-[11px] text-slate-400">
            {baseScenario
              ? <>База: <span className="font-mono text-cyan-300">{baseName}</span></>
              : <span className="text-amber-400">Нет базового сценария</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {baseName !== (scenario?.meta.title || scenario?.meta.id) && scenario && (
            <button type="button" onClick={resetBase} className="text-[11px] text-slate-400 hover:text-white">Вернуться к текущему</button>
          )}
          {results.length > 0 && (
            <button type="button" onClick={discardResults} className="flex items-center gap-1 text-[11px] text-rose-300 hover:text-rose-200">
              <Trash2 className="h-3 w-3" />Очистить результаты ({results.length})
            </button>
          )}
        </div>
      </div>

      {/* Base scenario editor */}
      {showBaseEditor && baseScenario && (
        <div className="border-b border-slate-800 bg-slate-900/20 px-5 py-4 space-y-4 max-h-[40vh] overflow-y-auto">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Параметры среды</div>
            <div className="grid grid-cols-4 gap-3">
              {([
                ['altitude_km', 'Высота, км'],
                ['inclination_deg', 'Наклонение, °'],
                ['earth_angle0_deg', 'Нач. угол Земли, °'],
                ['horizon_s', 'Горизонт, с'],
                ['step_s', 'Шаг, с'],
                ['min_elevation_deg', 'Мин. угол места, °'],
                ['isl_range_km', 'Радиус МСС, км'],
                ['target_availability', 'Целевая доступность (0-1)'],
              ] as Array<[keyof ScenarioDto['environment'], string]>).map(([key, label]) => (
                <label key={String(key)} className="space-y-1 text-[10px] text-slate-400">
                  <span>{label}</span>
                  <input
                    value={String(baseScenario.environment[key])}
                    onChange={event => updateEnvironment(key, event.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Наземные станции ({sitesDraft.length})</div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={addSite} className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700">
                  <Plus className="h-3 w-3" />Добавить
                </button>
                <button type="button" onClick={commitSites} className="rounded-lg bg-cyan-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-cyan-600">
                  Применить станции
                </button>
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900/95 text-slate-500">
                  <tr>
                    <th className="px-2 py-2 text-left">ID</th>
                    <th className="px-2 py-2 text-left">Имя</th>
                    <th className="px-2 py-2 text-left">Роль</th>
                    <th className="px-2 py-2 text-right">Широта</th>
                    <th className="px-2 py-2 text-right">Долгота</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {sitesDraft.map((site, index) => (
                    <tr key={index} className="text-slate-300">
                      <td className="px-2 py-1.5"><input value={site.id} onChange={event => updateSite(index, { id: event.target.value })} className="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" /></td>
                      <td className="px-2 py-1.5"><input value={site.name} onChange={event => updateSite(index, { name: event.target.value })} className="w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" /></td>
                      <td className="px-2 py-1.5">
                        <select value={site.role} onChange={event => updateSite(index, { role: event.target.value as 'gateway' | 'client' })} className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white">
                          <option value="client">client</option>
                          <option value="gateway">gateway</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5"><input value={site.lat_deg} onChange={event => updateSite(index, { lat_deg: event.target.value })} className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right text-xs text-white" /></td>
                      <td className="px-2 py-1.5"><input value={site.lon_deg} onChange={event => updateSite(index, { lon_deg: event.target.value })} className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right text-xs text-white" /></td>
                      <td className="px-2 py-1.5"><button type="button" onClick={() => removeSite(index)} className="text-slate-500 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={event => void run(event)} className="grid grid-cols-[100px_100px_90px_1fr_100px_90px_auto] items-end gap-3 border-b border-slate-800 p-5">
        <label className="space-y-1 text-[10px] text-slate-400"><span>Мин. плоскостей</span><input value={minPlanes} onChange={event => setMinPlanes(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white" /></label>
        <label className="space-y-1 text-[10px] text-slate-400"><span>Макс. плоскостей</span><input value={maxPlanes} onChange={event => setMaxPlanes(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white" /></label>
        <label className="space-y-1 text-[10px] text-slate-400"><span>Этапов</span><input type="number" min={MIN_STAGES} max={MAX_STAGES} value={stageCount} onChange={event => changeStageCount(Number(event.target.value))} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white" /></label>

        <div className="space-y-1 text-[10px] text-slate-400">
          <div className="flex items-center gap-2"><span>Спутников на плоскость по этапам</span><span className="text-slate-500">(этап 1 → … → этап {stageCount})</span></div>
          <div className="flex flex-wrap items-center gap-2">
            {stageSats.map((value, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2">
                  <span className="text-[10px] font-semibold text-cyan-400">Э{index + 1}</span>
                  <input value={value} onChange={event => setStageSats(previous => { const next = [...previous]; next[index] = event.target.value; return next; })} className="w-12 bg-transparent text-xs text-white outline-none" />
                </div>
                {index < stageSats.length - 1 && <span className="text-slate-600">→</span>}
              </div>
            ))}
          </div>
        </div>

        <label className="space-y-1 text-[10px] text-slate-400"><span>Итераций</span><input value={iterations} onChange={event => setIterations(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white" /></label>
        <label className="space-y-1 text-[10px] text-slate-400"><span>Seed</span><input value={seed} onChange={event => setSeed(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white" /></label>

        {running
          ? <button type="button" onClick={() => abortRef.current?.abort()} className="flex items-center justify-center gap-2 rounded-lg bg-rose-700 px-4 py-2 text-xs font-semibold text-white"><Square className="h-3 w-3" />Остановить</button>
          : <button disabled={!baseScenario} className="flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"><Sparkles className="h-3.5 w-3.5" />Рассчитать</button>}
      </form>

      <div className="grid min-h-0 flex-1 grid-cols-[380px_1fr]">
        <div className="overflow-y-auto border-r border-slate-800 p-4">
          {!baseScenario && <div className="rounded-xl border border-slate-800 p-6 text-center text-xs text-slate-500">Загрузите базовый сценарий или откройте проект.</div>}
          {running && <div className="mb-3 rounded-lg border border-violet-800/60 bg-violet-950/30 px-3 py-2 text-xs text-violet-300">Получено этапов: {results.length} из {expectedStages}. Результаты можно просматривать по мере поступления.</div>}
          {message && <div className="mb-3 rounded-lg border border-cyan-800/50 bg-cyan-950/30 px-3 py-2 text-xs text-cyan-300">{message}</div>}
          {error && <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">Ошибка: {error}</div>}
          <div className="space-y-2">
            {results.map(item => {
              const actualSatellites = item.scenario.design.satellites.length;
              const summary = metricsSummary(item.metrics);
              const isBest = stageKey(item) === (best ? stageKey(best) : '');
              const isSelected = stageKey(item) === selectedKey;
              return (
                <button key={stageKey(item)} type="button" onClick={() => setSelectedKey(stageKey(item))} className={`w-full rounded-xl border p-3 text-left ${isSelected ? 'border-cyan-500/70 bg-cyan-950/30' : isBest ? 'border-emerald-700/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/50 hover:bg-slate-900'}`}>
                  <div className="flex items-center justify-between"><span className="text-xs font-semibold text-white">{item.requested_planes} плоск. · этап {item.stage}</span><span className={item.met_target ? 'text-[10px] text-emerald-400' : 'text-[10px] text-amber-400'}>{item.met_target ? 'цель достигнута' : 'ниже цели'}</span></div>
                  <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-400"><span>{actualSatellites} спутников</span><span>{summary.minAvailability.toFixed(2)}% min</span><span>J={item.best_score.toFixed(1)}</span></div>
                  {isBest && <div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-400"><Check className="h-3 w-3" />Лучший найденный вариант</div>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-y-auto p-5">
          {!selected || !selectedMetrics
            ? <div className="flex h-full items-center justify-center text-xs text-slate-500">вычисляем оптимальную конфигурацию ...</div>
            : <div className="space-y-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Выбранный вариант</div>
                    <h3 className="mt-1 text-base font-semibold text-white">{selected.requested_planes} плоскостей · этап {selected.stage}</h3>
                    <p className="text-[11px] text-slate-400">Фактически {selected.scenario.design.satellites.length} спутников, запрошено {selected.n_sat}</p>
                  </div>
                  <span className={`rounded-lg px-2.5 py-1 text-xs ${selected.met_target ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}>{selected.met_target ? 'Цель достигнута' : 'Цель не достигнута'}</span>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {[['Средняя доступность', `${selectedMetrics.meanAvailability.toFixed(2)}%`], ['Минимальная доступность', `${selectedMetrics.minAvailability.toFixed(2)}%`], ['Макс. перерыв', formatTimeSeconds(selectedMetrics.maxInterruption)], ['Средние хопы', selectedMetrics.meanHops.toFixed(2)]].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3"><div className="text-[10px] text-slate-500">{label}</div><div className="mt-1 font-mono text-sm text-cyan-300">{value}</div></div>
                  ))}
                </div>
                <div>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Оптимальные плоскости</div>
                  <div className="overflow-hidden rounded-xl border border-slate-800">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-900/80 text-slate-500"><tr><th className="px-3 py-2 text-left">ID</th><th className="px-3 py-2 text-right">RAAN</th><th className="px-3 py-2 text-right">Фазирование</th><th className="px-3 py-2 text-right">Спутников</th></tr></thead>
                      <tbody className="divide-y divide-slate-800">
                        {selected.scenario.design.planes.map(plane => (
                          <tr key={plane.id} className="text-slate-300">
                            <td className="px-3 py-2.5 font-medium text-white">{plane.id}</td>
                            <td className="px-3 py-2.5 text-right font-mono">{plane.raan_deg.toFixed(2)}°</td>
                            <td className="px-3 py-2.5 text-right font-mono">{plane.phase_deg.toFixed(2)}°</td>
                            <td className="px-3 py-2.5 text-right font-mono">{selected.scenario.design.satellites.filter(satellite => satellite.plane_id === plane.id).length}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 p-3 text-[11px] text-slate-400">
                  <span>Мин. спутников на плоскость: <b className="text-white">{selected.bounds.min_sats_per_plane}</b></span>
                  <span>Радиус зоны покрытия: <b className="text-white">{selected.bounds.footprint_radius_km.toFixed(0)} км</b></span>
                  <span>Расчётный шаг RAAN: <b className="text-white">{selected.bounds.raan_step_deg.toFixed(2)}°</b></span>
                  <span>Целевая доступность: <b className="text-white">{((baseScenario?.environment.target_availability ?? 0) * 100).toFixed(2)}%</b></span>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-slate-800 pt-4">
                  <button type="button" disabled={action !== null} onClick={() => void perform('preview', () => onPreview(selected.scenario))} className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200 disabled:opacity-40"><Eye className="h-3.5 w-3.5" />Показать на модели</button>
                  <button type="button" onClick={() => onCompare(selected.scenario, `${selected.requested_planes} плоскостей · этап ${selected.stage}`)} className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200"><GitCompareArrows className="h-3.5 w-3.5" />Сравнить с исходной</button>
                  <button type="button" disabled={action !== null} onClick={() => void perform('apply', () => onApply(selected.scenario), true)} className="rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Применить</button>
                  <button type="button" disabled={action !== null} onClick={() => void perform('save', () => onSave(selected.scenario), true)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" />Сохранить как новую</button>
                </div>
              </div>}
        </div>
      </div>
    </div>
  </div>;
};