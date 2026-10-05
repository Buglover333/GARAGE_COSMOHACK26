import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Download, RefreshCw, X } from 'lucide-react';
import { analyticsApi } from '../api/analytics';
import { ScenarioDto } from '../api/simulation';
import { MetricsResponse } from '../types/analytics';
import { formatTimeSeconds } from '../utils/orbitalMechanics';

interface Props {
  isOpen: boolean;
  scenario: ScenarioDto | null;
  onClose: () => void;
}

const mean = (values: number[]) => values.length
  ? values.reduce((total, value) => total + value, 0) / values.length
  : 0;

export const MetricsModal = ({ isOpen, scenario, onClose }: Props) => {
  const [result, setResult] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeTimesteps, setIncludeTimesteps] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const calculate = async (withTimesteps: boolean) => {
    if (!scenario) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      setResult(await analyticsApi.calculateMetrics(scenario, withTimesteps, controller.signal));
      setIncludeTimesteps(withTimesteps);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (isOpen && scenario) void calculate(false);
    return () => abortRef.current?.abort();
    // A fresh calculation is required only when the modal is opened or its project changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, scenario?.meta.id]);

  const summary = useMemo(() => Object.entries(result?.summary ?? {}), [result]);
  const aggregates = useMemo(() => ({
    visibility: mean(summary.map(([, item]) => item.visibility_pct)),
    availability: mean(summary.map(([, item]) => item.gateway_availability_pct)),
    interruption: Math.max(0, ...summary.map(([, item]) => item.max_interruption_s)),
    hops: mean(summary.flatMap(([, item]) => item.avg_hops === null ? [] : [item.avg_hops])),
  }), [summary]);

  if (!isOpen) return null;

  const downloadCsv = async () => {
    if (!scenario) return;
    setDownloading(true);
    setError(null);
    try {
      const blob = await analyticsApi.downloadMetricsCsv(scenario, true);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `metrics_${scenario.meta.id}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-cyan-400" />
            <div><h2 className="font-semibold text-white">Метрики конфигурации</h2><p className="text-[11px] text-slate-400">{scenario?.meta.title ?? 'Проект не выбран'}</p></div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={!scenario || loading || downloading} onClick={() => void downloadCsv()} className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"><Download className="h-3.5 w-3.5" />{downloading ? 'Экспорт…' : 'CSV'}</button>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="overflow-y-auto p-6">
          {!scenario && <div className="rounded-xl border border-slate-800 p-8 text-center text-xs text-slate-500">Сначала создайте или загрузите конфигурацию.</div>}
          {loading && <div className="rounded-xl border border-cyan-900/60 bg-cyan-950/20 p-8 text-center text-xs text-cyan-300">Выполняется расчёт метрик за весь горизонт…</div>}
          {error && <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">Ошибка расчёта: {error}</div>}
          {result && !loading && (
            <div className="space-y-5">
              <div className="grid grid-cols-5 gap-3">
                {[
                  ['Средняя видимость', `${aggregates.visibility.toFixed(2)}%`],
                  ['Средняя доступность', `${aggregates.availability.toFixed(2)}%`],
                  ['Целевая доступность', `${((scenario?.environment.target_availability ?? 0) * 100).toFixed(2)}%`],
                  ['Макс. перерыв', formatTimeSeconds(aggregates.interruption)],
                  ['Среднее число хопов', aggregates.hops.toFixed(2)],
                ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3"><div className="text-[10px] text-slate-500">{label}</div><div className="mt-1 font-mono text-sm font-semibold text-cyan-300">{value}</div></div>)}
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-800">
                <table className="w-full text-xs">
                  <thead className="bg-slate-900/80 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Клиент</th><th className="px-3 py-2 text-right">Видимость</th><th className="px-3 py-2 text-right">Доступность</th><th className="px-3 py-2 text-right">Макс. перерыв</th><th className="px-3 py-2 text-right">Средние хопы</th><th className="px-3 py-2 text-right">Цель</th></tr></thead>
                  <tbody className="divide-y divide-slate-800">{summary.map(([clientId, item]) => {
                    const targetMet = item.gateway_availability_pct >= (scenario?.environment.target_availability ?? 0) * 100;
                    return <tr key={clientId} className="text-slate-300"><td className="px-3 py-2.5 font-medium text-white">{clientId}</td><td className="px-3 py-2.5 text-right font-mono">{item.visibility_pct.toFixed(2)}%</td><td className="px-3 py-2.5 text-right font-mono">{item.gateway_availability_pct.toFixed(2)}%</td><td className="px-3 py-2.5 text-right font-mono">{formatTimeSeconds(item.max_interruption_s)}</td><td className="px-3 py-2.5 text-right font-mono">{item.avg_hops?.toFixed(2) ?? '—'}</td><td className={`px-3 py-2.5 text-right font-semibold ${targetMet ? 'text-emerald-400' : 'text-rose-400'}`}>{targetMet ? 'Достигнута' : 'Не достигнута'}</td></tr>;
                  })}</tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-[11px] text-slate-500">{includeTimesteps ? `Получено временных строк: ${result.timesteps?.length ?? 0}` : 'Временные строки не загружены для ускорения расчёта'}</div>
                <button type="button" onClick={() => void calculate(!includeTimesteps)} className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"><RefreshCw className="h-3.5 w-3.5" />{includeTimesteps ? 'Скрыть детализацию' : 'Загрузить временные шаги'}</button>
              </div>

              {includeTimesteps && result.timesteps && <div className="max-h-64 overflow-auto rounded-xl border border-slate-800"><table className="w-full text-[11px]"><thead className="sticky top-0 bg-slate-900 text-slate-500"><tr><th className="px-3 py-2 text-left">Время</th><th className="px-3 py-2 text-left">Клиент</th><th className="px-3 py-2 text-left">Маршрут</th><th className="px-3 py-2 text-right">Хопы</th></tr></thead><tbody className="divide-y divide-slate-800">{result.timesteps.map((row, index) => <tr key={`${row.t_s}:${row.client_id}:${index}`} className="text-slate-300"><td className="px-3 py-2 font-mono">{formatTimeSeconds(row.t_s)}</td><td className="px-3 py-2">{row.client_id}</td><td className={row.has_path ? 'px-3 py-2 text-cyan-300' : 'px-3 py-2 text-rose-400'}>{row.has_path ? row.path.join(' → ') : row.visible ? 'Нет маршрута до шлюза' : 'Нет видимого спутника'}</td><td className="px-3 py-2 text-right font-mono">{row.hops ?? '—'}</td></tr>)}</tbody></table></div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

