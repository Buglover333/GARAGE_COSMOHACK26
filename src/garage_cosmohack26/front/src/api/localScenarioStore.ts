import { ConfigSummaryDto, ScenarioDto } from './simulation';

const STORAGE_KEY = 'cosmo.scenarios.v1';

interface StoredScenario {
  id: string;
  title: string;
  updated_at: number;
  scenario: ScenarioDto;
}

type StoreShape = Record<string, StoredScenario>;

function readStore(): StoreShape {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoreShape;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: StoreShape): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export const localScenarioStore = {
  list(): ConfigSummaryDto[] {
    const store = readStore();
    return Object.values(store)
      .map(item => ({
        id: item.id,
        title: item.title,
        is_example: false,
        satellites: item.scenario.design?.satellites?.length ?? 0,
        ground_sites: item.scenario.ground_sites?.length ?? 0,
        updated_at: item.updated_at,
      }))
      .sort((a, b) => b.updated_at - a.updated_at);
  },

  get(id: string): ScenarioDto {
    const store = readStore();
    const item = store[id];
    if (!item) throw new Error(`scenario ${id} not found in local storage`);
    return item.scenario;
  },

  has(id: string): boolean {
    return id in readStore();
  },

  save(scenario: ScenarioDto, title?: string): void {
    const store = readStore();
    store[scenario.meta.id] = {
      id: scenario.meta.id,
      title: title || scenario.meta.title || scenario.meta.id,
      updated_at: Date.now(),
      scenario,
    };
    writeStore(store);
  },

  delete(id: string): boolean {
    const store = readStore();
    if (!(id in store)) return false;
    delete store[id];
    writeStore(store);
    return true;
  },

  /** Serialize to a downloadable JSON blob. */
  exportJson(id: string): string {
    return JSON.stringify(this.get(id), null, 2);
  },

  /** Import from an uploaded JSON file. Returns the scenario id. */
  importJson(raw: string): ScenarioDto {
    const parsed = JSON.parse(raw) as ScenarioDto;
    if (!parsed?.meta?.id || !parsed.design || !parsed.environment) {
      throw new Error('Файл не является корректным сценарием cosmo-A-1.0');
    }
    this.save(parsed);
    return parsed;
  },
};