import { ScenarioDto } from './simulation';
import {
  FileComparisonResponse,
  MetricsResponse,
  OptimizationOptions,
  OptimizationStage,
} from '../types/analytics';

interface NamedScenario {
  name: string;
  scenario: ScenarioDto;
}

const scenarioFile = (scenario: ScenarioDto, name = scenario.meta.id) => new File(
  [JSON.stringify(scenario)],
  `${name.replace(/[^a-zA-Z0-9_-]+/g, '_')}.json`,
  { type: 'application/json' },
);

async function responseError(response: Response): Promise<Error> {
  let message = `${response.status} ${response.statusText}`;
  try {
    const body = await response.json() as { detail?: string | Array<{ msg?: string }> };
    if (typeof body.detail === 'string') message = body.detail;
    if (Array.isArray(body.detail)) {
      message = body.detail.map(item => item.msg).filter(Boolean).join('; ') || message;
    }
  } catch {
    // Preserve the HTTP status for non-JSON errors.
  }
  return new Error(message);
}

export const analyticsApi = {
  async calculateMetrics(
    scenario: ScenarioDto,
    includeTimesteps = false,
    signal?: AbortSignal,
  ): Promise<MetricsResponse> {
    const form = new FormData();
    form.append('file', scenarioFile(scenario));
    const response = await fetch(
      `/api/metrics?fmt=json&include_timesteps=${includeTimesteps}`,
      { method: 'POST', body: form, signal },
    );
    if (!response.ok) throw await responseError(response);
    return response.json() as Promise<MetricsResponse>;
  },

  async downloadMetricsCsv(scenario: ScenarioDto, includeTimesteps = true): Promise<Blob> {
    const form = new FormData();
    form.append('file', scenarioFile(scenario));
    const response = await fetch(
      `/api/metrics?fmt=csv&include_timesteps=${includeTimesteps}`,
      { method: 'POST', body: form },
    );
    if (!response.ok) throw await responseError(response);
    return response.blob();
  },

  async compareScenarios(scenarios: NamedScenario[], signal?: AbortSignal): Promise<FileComparisonResponse> {
    const form = new FormData();
    scenarios.forEach(item => form.append('files', scenarioFile(item.scenario, item.name)));
    const response = await fetch('/api/compare?fmt=json', {
      method: 'POST',
      body: form,
      signal,
    });
    if (!response.ok) throw await responseError(response);
    return response.json() as Promise<FileComparisonResponse>;
  },

  async downloadComparisonCsv(scenarios: NamedScenario[]): Promise<Blob> {
    const form = new FormData();
    scenarios.forEach(item => form.append('files', scenarioFile(item.scenario, item.name)));
    const response = await fetch('/api/compare?fmt=csv', { method: 'POST', body: form });
    if (!response.ok) throw await responseError(response);
    return response.blob();
  },

  async calculateOptimal(
    baseScenario: ScenarioDto,
    options: OptimizationOptions,
    onStage: (stage: OptimizationStage) => void,
    signal?: AbortSignal,
  ): Promise<OptimizationStage[]> {
    const stages: OptimizationStage[] = [];

    for (let planes = options.minPlanes; planes <= options.maxPlanes; planes += 1) {
      if (signal?.aborted) throw new DOMException('Расчёт отменён', 'AbortError');
      const form = new FormData();
      form.append('base_file', scenarioFile(baseScenario, `${baseScenario.meta.id}_base`));
      form.append('satellites_per_plane', JSON.stringify(options.satellitesPerPlane));
      form.append('planes', String(planes));
      form.append('iterations', String(options.iterations));
      form.append('seed', String(options.seed));
      form.append('include_metrics', String(options.includeMetrics ?? true));

      const response = await fetch('/api/calculate_optimal', {
        method: 'POST',
        body: form,
        signal,
      });
      if (!response.ok) throw await responseError(response);
      if (!response.body) throw new Error('Бэкенд не вернул поток результатов');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const consumeLine = (line: string) => {
        if (!line.trim()) return;
        const payload = JSON.parse(line) as Omit<OptimizationStage, 'requested_planes'> | { done: true };
        if ('done' in payload) return;
        const stage: OptimizationStage = { ...payload, requested_planes: planes };
        stages.push(stage);
        onStage(stage);
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(consumeLine);
        if (done) break;
      }
      consumeLine(buffer);
    }

    return stages;
  },
};
