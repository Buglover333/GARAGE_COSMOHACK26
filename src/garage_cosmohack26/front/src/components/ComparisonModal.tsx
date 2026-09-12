import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Download, GitCompareArrows, Plus, Trash2, Upload, X } from 'lucide-react';
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

const MAX_CONFIGS = 10;

const deltaClass = (value: number | null, lowerIsBetter = false) => {
  if (value === null || Math.abs(value) < 1e-9) return 'text-slate-400';
  return (lowerIsBetter ? value < 0 : value > 0) ? 'text-emerald-400' : 'text-rose-400';
};

// ---- Upload helpers -----------------------------------------------------

let uploadCounter = 0;
const nextUploadId = () => `up_${Date.now().toString(36)}_${uploadCounter++}`;

/** Accept either a ScenarioDto, or a wrapper { scenario: ScenarioDto }, or raw { meta, ... }. */
const coerceScenario = (raw: unknown, fallbackName: string): ScenarioDto => {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (obj.scenario && typeof obj.scenario === 'object') return obj.scenario as ScenarioDto;
    if (obj.meta && typeof obj.meta === 'object') return obj as unknown as ScenarioDto;
  }
  throw new Error(`Файл «${fallbackName}» не похож на сценарий (нет полей meta/scenario).`);
};

// ------------------------------------------------------------------------

export const ComparisonModal = ({
  isOpen,
  configs,
  activeScenario,
  candidateScenario = null,
  candidateLabel = 'Результат оптимизации',
  onClose,
}: Props) => {
  const [sources, setSources] = useState<string[]>(['', '']);
  const [result, setResult] = useState<FileComparisonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // id -> { label, scenario }  for every uploaded file
  const [uploads, setUploads] = useState<Record<string, { label: string; scenario: ScenarioDto }>>({});

  const options = useMemo<SourceOption[]>(() => [
    ...(activeScenario ? [{ value: 'active', label: `Текущая: ${activeScenario.meta.title}` }] : []),
    ...(candidateScenario ? [{ value: 'candidate', label: candidateLabel }] : []),
    ...configs.map(item => ({ value: `saved:${item.id}`, label: `Сохранённая: ${item.title || item.id}` })),
    ...Object.entries(uploads).map(([id, item]) => ({
      value: `uploaded:${id}`,
      label: `Файл: ${item.label}`,
    })),
  ], [activeScenario, candidateLabel, candidateScenario, configs, uploads]);

  useEffect(() => {
    if (!isOpen) return;
    const available = options.map(item => item.value);
    const pick = (exclude: string[]) => available.find(value => !exclude.includes(value)) ?? '';
    const first = activeScenario && available.includes('active') ? 'active' : pick([]);
    const second = candidateScenario && available.includes('candidate') ? 'candidate' : pick([first]);
    setSources([first, second]);
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
    if (source.startsWith('uploaded:')) {
      const id = source.slice('uploaded:'.length);
      const entry = uploads[id];
      if (!entry) throw new Error('Загруженный файл больше недоступен');
      return { name: `upload_${id}_${index}`, scenario: entry.scenario };
    }
    throw new Error('Выберите конфигурацию');
  };

  const selectedScenarios = async () => {
    const resolved = [];
    for (let i = 0; i < sources.length; i += 1) {
      resolved.push(await resolveSource(sources[i], i + 1));
    }
    return resolved;
  };

  const updateSource = (index: number, value: string) => {
    setSources(previous => {
      const next = [...previous];
      next[index] = value;
      return next;
    });
  };

  const addSource = () => {
    if (sources.length >= MAX_CONFIGS) return;
    setSources(previous => [...previous, '']);
  };

  const removeSource = (index: number) => {
    if (sources.length <= 2) return;
    setSources(previous => previous.filter((_, i) => i !== index));
  };

  // ---- File upload handling --------------------------------------------

  const ingestFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    const added: { id: string; label: string; scenario: ScenarioDto }[] = [];
    const failures: string[] = [];

    for (const file of list) {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const scenario = coerceScenario(parsed, file.name);
        added.push({ id: nextUploadId(), label: file.name, scenario });
      } catch (cause) {
        failures.push(`${file.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }

    if (added.length) {
      setUploads(prev => {
        const next = { ...prev };
        for (const item of added) next[item.id] = { label: item.label, scenario: item.scenario };
        return next;
      });

      // Auto-fill empty slots (or append, up to MAX_CONFIGS) with the new files.
      setSources(prev => {
        const next = [...prev];
        for (const item of added) {
          const value = `uploaded:${item.id}`;
          if (next.includes(value)) continue;
          const emptyIdx = next.findIndex(v => !v);
          if (emptyIdx !== -1) next[emptyIdx] = value;
          else if (next.length < MAX_CONFIGS) next.push(value);
        }
        return next;
      });
    }

    if (failures.length) setError(failures.join('\n'));
  };

  const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void ingestFiles(event.target.files);
    event.target.value = ''; // allow re-uploading the same file
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (event.dataTransfer?.files?.length) void ingestFiles(event.dataTransfer.files);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!dragActive) setDragActive(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // Only clear if we actually left the container
    if (event.currentTarget === event.target) setDragActive(false);
  };

  // ----------------------------------------------------------------------

  const filledSources = sources.filter(Boolean);
  const hasDuplicates = new Set(filledSources).size !== filledSources.length;
  const canCompare =
    sources.length >= 2
    && sources.every(Boolean)
    && !hasDuplicates
    && !loading;

  const compare = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCompare) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await analyticsApi.compareScenarios(await selectedScenarios(), controller.signal));
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
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

  const labelFor = (value: string) => options.find(option => option.value === value)?.label ?? value;

  const baselineName = result?.scenarios[0]; // unused but kept for parity
  const baselineLabel = labelFor(sources[0]); // unused but kept for parity

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
    <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <GitCompareArrows className="h-5 w-5 text-cyan-400" />
          <div>
            <h2 className="font-semibold text-white">Сравнение конфигураций</h2>
            <p className="text-[11px] text-slate-400">До {MAX_CONFIGS} конфигураций одновременно. Первая — базовая.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <button type="button" disabled={downloading} onClick={() => void downloadCsv()} className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40">
              <Download className="h-3.5 w-3.5" />{downloading ? 'Экспорт…' : 'CSV'}
            </button>
          )}
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
      </div>

      <form onSubmit={event => void compare(event)} className="space-y-3 border-b border-slate-800 p-6">
        {/* Drop zone + upload button */}
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={`flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2 text-xs transition-colors ${
            dragActive
              ? 'border-cyan-400 bg-cyan-950/30 text-cyan-200'
              : 'border-slate-700 bg-slate-900/40 text-slate-400'
          }`}
        >
          <span className="truncate">
            {dragActive ? 'Отпустите файлы, чтобы добавить' : 'Перетащите JSON-файлы сюда, затем добавьте конфигурацию для сравнения ниже'}
          </span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
          >
            <Upload className="h-3.5 w-3.5" />
            Загрузить файл
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            multiple
            className="hidden"
            onChange={onFileInputChange}
          />
        </div>

        <div className="space-y-2">
          {sources.map((source, index) => (
            <div key={index} className="grid grid-cols-[60px_1fr_auto] items-center gap-3">
              <span className="text-[11px] font-semibold text-slate-400">
                {index === 0 ? 'База' : `№${index + 1}`}
              </span>
              <select
                value={source}
                onChange={event => updateSource(index, event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
              >
                <option value="">Выберите конфигурацию</option>
                {options.map(item => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={sources.length <= 2}
                onClick={() => removeSource(index)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:text-rose-400 disabled:opacity-30 disabled:hover:text-slate-400"
                title="Удалить"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={sources.length >= MAX_CONFIGS}
            onClick={addSource}
            className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />Добавить конфигурацию ({sources.length}/{MAX_CONFIGS})
          </button>
          <button
            disabled={!canCompare}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {loading ? 'Расчёт…' : 'Сравнить'}
          </button>
        </div>

        {hasDuplicates && <div className="text-xs text-amber-400">Одна и та же конфигурация выбрана несколько раз.</div>}
      </form>

      <div className="overflow-y-auto p-6">
        {options.length < 2 && (
          <div className="rounded-xl border border-slate-800 p-8 text-center text-xs text-slate-500">
            Для сравнения нужны как минимум две конфигурации.
          </div>
        )}

        {error && (
          <div className="mb-4 whitespace-pre-line rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
            Ошибка сравнения: {error}
          </div>
        )}

        {result && (
          <div className="space-y-6">
            <div className={`grid gap-4 ${result.summaries.length <= 3 ? 'grid-cols-' + result.summaries.length : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'}`}>
              {result.summaries.map((item, index) => (
                <div key={item.name} className={`rounded-xl border p-4 ${index === 0 ? 'border-cyan-500/50 bg-cyan-950/20' : 'border-slate-800 bg-slate-900/50'}`}>
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {index === 0 ? 'Базовая' : `Конфигурация ${index + 1}`}
                    </div>
                  </div>
                  <div className="mt-1 truncate text-sm font-semibold text-white" title={labelFor(sources[index])}>
                    {labelFor(sources[index])}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <div className="text-slate-500">Ср. доступность</div>
                      <div className="mt-1 font-mono text-cyan-300">{item.mean_availability?.toFixed(2) ?? '—'}%</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Минимальная</div>
                      <div className="mt-1 font-mono text-white">{item.min_availability?.toFixed(2) ?? '—'}%</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Видимость</div>
                      <div className="mt-1 font-mono text-white">{item.mean_visibility?.toFixed(2) ?? '—'}%</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="overflow-auto rounded-xl border border-slate-800">
              <table className="w-full min-w-[900px] text-xs">
                <thead className="bg-slate-900/80 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-900/95 px-3 py-2 text-left">Клиент</th>
                    {result.summaries.map((item, index) => (
                      <th key={item.name} className="px-3 py-2 text-right" title={labelFor(sources[index])}>
                        <div className="flex flex-col items-end gap-0.5">
                          <span className={index === 0 ? 'text-cyan-300' : ''}>
                            {index === 0 ? 'База' : `№${index + 1}`}
                          </span>
                          <span className="max-w-[120px] truncate text-[9px] font-normal normal-case text-slate-500">
                            {labelFor(sources[index])}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {result.rows.map(row => {
                    const deltas = result.pairwise_vs_baseline.filter(item => item.client_id === row.client_id);
                    const metricValues = result.scenarios.map(name => metricsAt(row, name));
                    return (
                      <tr key={row.client_id} className="text-slate-300">
                        <td className="sticky left-0 z-10 bg-slate-950 px-3 py-2.5 font-medium text-white">
                          {row.client_id}
                        </td>
                        {metricValues.map((metric, index) => (
                          <td key={index} className="px-3 py-2.5 text-right">
                            {index === 0 ? (
                              <div className="font-mono text-white">{metric?.gateway_availability_pct.toFixed(2) ?? '—'}%</div>
                            ) : (
                              <div className="flex flex-col items-end gap-0.5">
                                <span className="font-mono text-white">{metric?.gateway_availability_pct.toFixed(2) ?? '—'}%</span>
                                {(() => {
                                  const d = deltas[index - 1];
                                  const delta = d?.availability_delta ?? null;
                                  return (
                                    <span className={`font-mono text-[10px] ${deltaClass(delta)}`}>
                                      {delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} п.п.`}
                                    </span>
                                  );
                                })()}
                              </div>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="overflow-auto rounded-xl border border-slate-800">
              <table className="w-full min-w-[900px] text-xs">
                <thead className="bg-slate-900/80 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-900/95 px-3 py-2 text-left">Клиент</th>
                    {result.summaries.map((item, index) => (
                      <th key={item.name} className="px-3 py-2 text-right" title={labelFor(sources[index])}>
                        <div className="flex flex-col items-end gap-0.5">
                          <span className={index === 0 ? 'text-cyan-300' : ''}>{index === 0 ? 'База' : `№${index + 1}`}</span>
                          <span className="text-[9px] font-normal normal-case text-slate-500">перерыв / хопы</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {result.rows.map(row => {
                    const metricValues = result.scenarios.map(name => metricsAt(row, name));
                    return (
                      <tr key={row.client_id} className="text-slate-300">
                        <td className="sticky left-0 z-10 bg-slate-950 px-3 py-2.5 font-medium text-white">{row.client_id}</td>
                        {metricValues.map((metric, index) => (
                          <td key={index} className="px-3 py-2.5 text-right font-mono">
                            {metric ? (
                              <>
                                <div>{formatTimeSeconds(metric.max_interruption_s)}</div>
                                <div className="text-[10px] text-slate-500">{metric.avg_hops?.toFixed(2) ?? '—'}</div>
                              </>
                            ) : '—'}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  </div>;
};