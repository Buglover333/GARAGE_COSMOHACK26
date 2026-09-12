import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Download, GitCompareArrows, X } from 'lucide-react';
import { analyticsApi } from '../api/analytics';
import { ConfigSummaryDto, ScenarioDto, simulationApi } from '../api/simulation';
import { ClientMetrics, FileComparisonResponse } from '../types/analytics';
import { formatTimeSeconds } from '../utils/orbitalMechanics';

interface Props {
  isOpen: boolean;
  configs: ConfigSummaryDto[];
  activeScenario: ScenarioDto | null;
  candidateScenario?: ScenarioDto | null;
  candidateLabel?: string;
  onClose: () => void;
}

interface SourceOption { value: string; label: string }

const deltaClass = (value: number | null, lowerIsBetter = false) => {
  if (value === null || Math.abs(value) < 1e-9) return 'text-slate-400';
  return (lowerIsBetter ? value < 0 : value > 0) ? 'text-emerald-400' : 'text-rose-400';
};
export const ComparisonModal = ({
  isOpen,
  configs,
  activeScenario,
  candidateScenario = null,
  candidateLabel = 'Результат оптимизации',
  onClose,
}: Props) => {
  const [sourceA, setSourceA] = useState('');
  const [sourceB, setSourceB] = useState('');
  const [result, setResult] = useState<FileComparisonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const options = useMemo<SourceOption[]>(() => [
    ...(activeScenario ? [{ value: 'active', label: `Текущая: ${activeScenario.meta.title}` }] : []),
    ...(candidateScenario ? [{ value: 'candidate', label: candidateLabel }] : []),
    ...configs.map(item => ({ value: `saved:${item.id}`, label: `Сохранённая: ${item.title || item.id}` })),
  ], [activeScenario, candidateLabel, candidateScenario, configs]);

  useEffect(() => {
    if (!isOpen) return;
    const first = activeScenario ? 'active' : options[0]?.value ?? '';
    const second = candidateScenario ? 'candidate' : options.find(item => item.value !== first)?.value ?? '';
    setSourceA(first);
    setSourceB(second);
    setResult(null);
    setError(null);
    return () => abortRef.current?.abort();
  }, [isOpen, activeScenario, candidateScenario, options]);

  const resolveSource = async (source: string, index: number) => {
    if (source === 'active' && activeScenario) {
      return { name: `current_${activeScenario.meta.id}_${index}`, scenario: activeScenario };
    }
    if (source === 'candidate' && candidateScenario) {
      return { name: `optimized_${candidateScenario.meta.id}_${index}`, scenario: candidateScenario };
    }
    if (source.startsWith('saved:')) {
      const id = source.slice('saved:'.length);
      return { name: `saved_${id}_${index}`, scenario: await simulationApi.getConfig(id) };
    }
    throw new Error('Выберите конфигурацию');
  };

  const selectedScenarios = () => Promise.all([resolveSource(sourceA, 1), resolveSource(sourceB, 2)]);

  const compare = async (event: FormEvent) => {
    event.preventDefault();
    if (!sourceA || !sourceB || sourceA === sourceB) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await analyticsApi.compareScenarios(await selectedScenarios(), controller.signal));
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setLoading(false); }
    }
  };

  const downloadCsv = async () => {
    setDownloading(true);
    setError(null);
    try {
      const blob = await analyticsApi.downloadComparisonCsv(await selectedScenarios());
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'comparison.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDownloading(false);
    }
  };

  if (!isOpen) return null;

  const metricsAt = (row: Record<string, string | ClientMetrics>, name: string) => {
    const value = row[name];
    return typeof value === 'string' ? null : value;
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
    <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-3"><GitCompareArrows className="h-5 w-5 text-cyan-400" /><div><h2 className="font-semibold text-white">Сравнение конфигураций</h2><p className="text-[11px] text-slate-400">Текущие, сохранённые и рассчитанные сценарии</p></div></div>
        <div className="flex items-center gap-2">{result && <button type="button" disabled={downloading} onClick={() => void downloadCsv()} className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"><Download className="h-3.5 w-3.5" />{downloading ? 'Экспорт…' : 'CSV'}</button>}<button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button></div>
      </div>

      <form onSubmit={event => void compare(event)} className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-3 border-b border-slate-800 p-6">
        <label className="space-y-1 text-[11px] text-slate-400"><span>Конфигурация A</span><select value={sourceA} onChange={event => setSourceA(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"><option value="">Выберите конфигурацию</option>{options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <span className="pb-2 text-xs text-slate-600">и</span>
        <label className="space-y-1 text-[11px] text-slate-400"><span>Конфигурация B</span><select value={sourceB} onChange={event => setSourceB(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"><option value="">Выберите конфигурацию</option>{options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <button disabled={loading || !sourceA || !sourceB || sourceA === sourceB} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{loading ? 'Расчёт…' : 'Сравнить'}</button>
      </form>

      <div className="overflow-y-auto p-6">
        {options.length < 2 && <div className="rounded-xl border border-slate-800 p-8 text-center text-xs text-slate-500">Для сравнения нужны как минимум две конфигурации.</div>}
        {sourceA && sourceA === sourceB && <div className="mb-4 text-xs text-amber-400">Выберите две разные конфигурации.</div>}
        {error && <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">Ошибка сравнения: {error}</div>}
        {result && <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">{result.summaries.map((item, index) => <div key={item.name} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"><div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Конфигурация {index === 0 ? 'A' : 'B'}</div><div className="mt-1 truncate text-sm font-semibold text-white">{options.find(option => option.value === (index === 0 ? sourceA : sourceB))?.label}</div><div className="mt-3 grid grid-cols-3 gap-3 text-xs"><div><div className="text-slate-500">Средняя доступность</div><div className="mt-1 font-mono text-cyan-300">{item.mean_availability?.toFixed(2) ?? '—'}%</div></div><div><div className="text-slate-500">Минимальная</div><div className="mt-1 font-mono text-white">{item.min_availability?.toFixed(2) ?? '—'}%</div></div><div><div className="text-slate-500">Видимость</div><div className="mt-1 font-mono text-white">{item.mean_visibility?.toFixed(2) ?? '—'}%</div></div></div></div>)}</div>
          <div className="overflow-auto rounded-xl border border-slate-800"><table className="w-full min-w-[800px] text-xs"><thead className="bg-slate-900/80 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Клиент</th><th className="px-3 py-2 text-right">Доступность A</th><th className="px-3 py-2 text-right">Доступность B</th><th className="px-3 py-2 text-right">Δ доступности</th><th className="px-3 py-2 text-right">Видимость A / B</th><th className="px-3 py-2 text-right">Макс. перерыв A / B</th><th className="px-3 py-2 text-right">Δ перерыва</th><th className="px-3 py-2 text-right">Хопы A / B</th></tr></thead><tbody className="divide-y divide-slate-800">{result.rows.map(row => {
            const metricA = metricsAt(row, result.scenarios[0]);
            const metricB = metricsAt(row, result.scenarios[1]);
            const delta = result.pairwise_vs_baseline.find(item => item.client_id === row.client_id);
            return <tr key={row.client_id} className="text-slate-300"><td className="px-3 py-2.5 font-medium text-white">{row.client_id}</td><td className="px-3 py-2.5 text-right font-mono">{metricA?.gateway_availability_pct.toFixed(2) ?? '—'}%</td><td className="px-3 py-2.5 text-right font-mono">{metricB?.gateway_availability_pct.toFixed(2) ?? '—'}%</td><td className={`px-3 py-2.5 text-right font-mono ${deltaClass(delta?.availability_delta ?? null)}`}>{delta?.availability_delta?.toFixed(2) ?? '—'} п.п.</td><td className="px-3 py-2.5 text-right font-mono">{metricA?.visibility_pct.toFixed(2) ?? '—'} / {metricB?.visibility_pct.toFixed(2) ?? '—'}%</td><td className="px-3 py-2.5 text-right font-mono">{metricA ? formatTimeSeconds(metricA.max_interruption_s) : '—'} / {metricB ? formatTimeSeconds(metricB.max_interruption_s) : '—'}</td><td className={`px-3 py-2.5 text-right font-mono ${deltaClass(delta?.max_interruption_delta_s ?? null, true)}`}>{delta?.max_interruption_delta_s?.toFixed(0) ?? '—'} с</td><td className="px-3 py-2.5 text-right font-mono">{metricA?.avg_hops?.toFixed(2) ?? '—'} / {metricB?.avg_hops?.toFixed(2) ?? '—'}</td></tr>;
          })}</tbody></table></div>
        </div>}
      </div>
    </div>
  </div>;
};
