import { FormEvent, useEffect, useState } from 'react';
import { GitCompareArrows, X } from 'lucide-react';
import { ComparisonDto, ConfigSummaryDto, simulationApi } from '../api/simulation';

interface Props {
  isOpen: boolean;
  configs: ConfigSummaryDto[];
  activeConfigId: string | null;
  onClose: () => void;
}

const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(2)}%`;
const number = (value: number | null, suffix = '') => value === null ? '—' : `${value.toFixed(2)}${suffix}`;

const deltaClass = (value: number | null, lowerIsBetter = false) => {
  if (value === null || Math.abs(value) < 1e-9) return 'text-slate-400';
  const isBetter = lowerIsBetter ? value < 0 : value > 0;
  return isBetter ? 'text-emerald-400' : 'text-rose-400';
};

export const ComparisonModal = ({ isOpen, configs, activeConfigId, onClose }: Props) => {
  const [configA, setConfigA] = useState('');
  const [configB, setConfigB] = useState('');
  const [result, setResult] = useState<ComparisonDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const first = configs.some(item => item.id === activeConfigId) ? activeConfigId! : configs[0]?.id ?? '';
    const second = configs.find(item => item.id !== first)?.id ?? '';
    setConfigA(first);
    setConfigB(second);
    setResult(null);
    setError(null);
  }, [isOpen, configs, activeConfigId]);

  if (!isOpen) return null;

  const compare = async (event: FormEvent) => {
    event.preventDefault();
    if (!configA || !configB || configA === configB) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await simulationApi.compareConfigs(configA, configB));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <GitCompareArrows className="h-5 w-5 text-cyan-400" />
            <div>
              <h2 className="font-semibold text-white">Сравнение конфигураций</h2>
              <p className="text-[11px] text-slate-400">Сопоставление доступности и качества маршрутов за весь горизонт</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={event => void compare(event)} className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-3 border-b border-slate-800 p-6">
          <label className="space-y-1 text-[11px] text-slate-400">
            <span>Конфигурация A</span>
            <select value={configA} onChange={event => setConfigA(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white">
              <option value="">Выберите конфигурацию</option>
              {configs.map(item => <option key={item.id} value={item.id}>{item.title || item.id}</option>)}
            </select>
          </label>
          <span className="pb-2 text-xs text-slate-600">и</span>
          <label className="space-y-1 text-[11px] text-slate-400">
            <span>Конфигурация B</span>
            <select value={configB} onChange={event => setConfigB(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white">
              <option value="">Выберите конфигурацию</option>
              {configs.map(item => <option key={item.id} value={item.id}>{item.title || item.id}</option>)}
            </select>
          </label>
          <button disabled={loading || !configA || !configB || configA === configB} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
            {loading ? 'Расчёт…' : 'Сравнить'}
          </button>
        </form>

        <div className="overflow-y-auto p-6">
          {configs.length < 2 && <div className="rounded-xl border border-slate-800 p-8 text-center text-xs text-slate-500">Для сравнения нужны как минимум две сохранённые конфигурации.</div>}
          {configA && configA === configB && <div className="mb-4 text-xs text-amber-400">Выберите две разные конфигурации.</div>}
          {error && <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">Ошибка сравнения: {error}</div>}
          {result && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                {[result.a, result.b].map((item, index) => (
                  <div key={item.config_id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Конфигурация {index === 0 ? 'A' : 'B'}</div>
                    <div className="mt-1 text-sm font-semibold text-white">{item.meta.title || item.config_id}</div>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                      <div><div className="text-slate-500">Доступность</div><div className="mt-1 font-mono text-cyan-300">{percent(item.summary.mean_coverage)}</div></div>
                      <div><div className="text-slate-500">Цель</div><div className="mt-1 font-mono text-white">{percent(item.summary.target)}</div></div>
                      <div><div className="text-slate-500">Ниже цели</div><div className="mt-1 font-mono text-white">{item.summary.clients_below_target.length}</div></div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-800">
                <table className="w-full text-xs">
                  <thead className="bg-slate-900/80 text-[10px] uppercase text-slate-500">
                    <tr><th className="px-3 py-2 text-left">Клиент</th><th className="px-3 py-2 text-right">Доступность A</th><th className="px-3 py-2 text-right">Доступность B</th><th className="px-3 py-2 text-right">Δ доступности</th><th className="px-3 py-2 text-right">Макс. разрыв A</th><th className="px-3 py-2 text-right">Макс. разрыв B</th><th className="px-3 py-2 text-right">Δ разрыва</th><th className="px-3 py-2 text-right">Задержка A / B</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {result.deltas.map(row => (
                      <tr key={row.client_id} className="text-slate-300">
                        <td className="px-3 py-2.5 font-medium text-white">{row.client_id}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{percent(row.coverage_a)}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{percent(row.coverage_b)}</td>
                        <td className={`px-3 py-2.5 text-right font-mono ${deltaClass(row.coverage_delta)}`}>{percent(row.coverage_delta)}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{number(row.max_gap_a_s, ' с')}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{number(row.max_gap_b_s, ' с')}</td>
                        <td className={`px-3 py-2.5 text-right font-mono ${deltaClass(row.max_gap_delta_s, true)}`}>{number(row.max_gap_delta_s, ' с')}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{number(row.mean_delay_a_ms)} / {number(row.mean_delay_b_ms)} мс</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
