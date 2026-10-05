import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { FileUp, Plus, Save, Trash2, X } from 'lucide-react';
import { ScenarioDto } from '../api/simulation';

interface Props {
  isOpen: boolean;
  scenario: ScenarioDto | null;
  onClose: () => void;
  onSave: (scenario: ScenarioDto) => Promise<void>;
}

type Fields = Record<
  'id' | 'title' | 'altitude' | 'inclination' | 'earthAngle' | 'horizon' | 'step' |
  'minElevation' | 'islRange' | 'targetAvailability' | 'planesCount' | 'satellitesPerPlane' |
  'launchStage', string
>;
type PlaneDraft = { id: string; raan: string; phase: string };
type SatelliteDraft = { id: string; planeId: string; slot: string; launchBatch: string };
type SiteDraft = { id: string; name: string; role: 'gateway' | 'client'; lat: string; lon: string };
type FailureDraft = { satelliteId: string; start: string; end: string };
type GatewayOutageDraft = { gatewayId: string; start: string; end: string };

const blankFields: Fields = {
  id: '', title: '', altitude: '', inclination: '', earthAngle: '', horizon: '', step: '',
  minElevation: '', islRange: '', targetAvailability: '', planesCount: '',
  satellitesPerPlane: '', launchStage: '1',
};

const numeric = (value: string, label: string) => {
  const parsed = Number(value);
  if (!value.trim() || !Number.isFinite(parsed)) throw new Error(`Заполните поле «${label}»`);
  return parsed;
};

function scenarioToDraft(scenario: ScenarioDto) {
  const satellitesPerPlane = scenario.design.planes.length
    ? scenario.design.satellites.length / scenario.design.planes.length
    : 0;
  return {
    fields: {
      id: scenario.meta.id,
      title: scenario.meta.title,
      altitude: String(scenario.environment.altitude_km),
      inclination: String(scenario.environment.inclination_deg),
      earthAngle: String(scenario.environment.earth_angle0_deg),
      horizon: String(scenario.environment.horizon_s),
      step: String(scenario.environment.step_s),
      minElevation: String(scenario.environment.min_elevation_deg),
      islRange: String(scenario.environment.isl_range_km),
      targetAvailability: String(scenario.environment.target_availability * 100),
      planesCount: String(scenario.design.planes.length),
      satellitesPerPlane: Number.isInteger(satellitesPerPlane) ? String(satellitesPerPlane) : '',
      launchStage: String(scenario.design.launch_stage),
    } satisfies Fields,
    planes: scenario.design.planes.map(plane => ({ id: plane.id, raan: String(plane.raan_deg), phase: String(plane.phase_deg) })),
    satellites: scenario.design.satellites.map(satellite => ({ id: satellite.id, planeId: satellite.plane_id, slot: String(satellite.slot_deg), launchBatch: String(satellite.launch_batch) })),
    sites: scenario.ground_sites.map(site => ({ id: site.id, name: site.name, role: site.role, lat: String(site.lat_deg), lon: String(site.lon_deg) })),
    failures: (scenario.failures ?? []).map(failure => ({
      satelliteId: typeof failure.satellite_id === 'string' ? failure.satellite_id : '',
      start: typeof failure.start_s === 'number' ? String(failure.start_s) : '',
      end: typeof failure.end_s === 'number' ? String(failure.end_s) : '',
    })),
    gatewayOutages: (scenario.gateway_outages ?? []).map(outage => ({
      gatewayId: typeof outage.gateway_id === 'string' ? outage.gateway_id : '',
      start: typeof outage.start_s === 'number' ? String(outage.start_s) : '',
      end: typeof outage.end_s === 'number' ? String(outage.end_s) : '',
    })),
  };
}

export const CreateProjectModal = ({ isOpen, scenario, onClose, onSave }: Props) => {
  const [fields, setFields] = useState<Fields>(blankFields);
  const [planes, setPlanes] = useState<PlaneDraft[]>([]);
  const [satellites, setSatellites] = useState<SatelliteDraft[]>([]);
  const [sites, setSites] = useState<SiteDraft[]>([]);
  const [failures, setFailures] = useState<FailureDraft[]>([]);
  const [gatewayOutages, setGatewayOutages] = useState<GatewayOutageDraft[]>([]);
  const [loadedFileName, setLoadedFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fillFromScenario = (value: ScenarioDto | null) => {
    if (!value) {
      setFields(blankFields); setPlanes([]); setSatellites([]); setSites([]); setFailures([]); setGatewayOutages([]);
      return;
    }
    const draft = scenarioToDraft(value);
    setFields(draft.fields); setPlanes(draft.planes); setSatellites(draft.satellites); setSites(draft.sites); setFailures(draft.failures); setGatewayOutages(draft.gatewayOutages);
  };

  useEffect(() => {
    if (!isOpen) return;
    fillFromScenario(scenario);
    setLoadedFileName('');
    setError(null);
  }, [isOpen, scenario]);

  if (!isOpen) return null;

  const updateField = (key: keyof Fields, value: string) => setFields(previous => ({ ...previous, [key]: value }));
  const updateStructure = (key: 'planesCount' | 'satellitesPerPlane', value: string) => {
    const nextFields = { ...fields, [key]: value };
    setFields(nextFields);
    const count = Number(nextFields.planesCount);
    const perPlane = Number(nextFields.satellitesPerPlane);
    if (!Number.isInteger(count) || count < 0 || count > 100) return;
    const nextPlanes = Array.from({ length: count }, (_, index) => planes[index] ?? {
      id: `P${index + 1}`,
      raan: count ? String((index * 360) / count) : '',
      phase: '0',
    });
    setPlanes(nextPlanes);
    if (!Number.isInteger(perPlane) || perPlane < 1 || perPlane > 100) return;
    const total = count * perPlane;
    setSatellites(nextPlanes.flatMap((plane, planeIndex) => Array.from({ length: perPlane }, (_, slotIndex) => {
      const globalIndex = planeIndex * perPlane + slotIndex;
      return {
        id: `S${String(globalIndex + 1).padStart(2, '0')}`,
        planeId: plane.id,
        slot: String((slotIndex * 360) / perPlane),
        launchBatch: String(Math.min(3, Math.floor((globalIndex * 3) / total) + 1)),
      };
    })));
  };

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const parsed = JSON.parse(await file.text()) as ScenarioDto;
      if (parsed.schema_version !== 'cosmo-A-1.0' || !parsed.meta || !parsed.environment || !parsed.design || !Array.isArray(parsed.ground_sites)) {
        throw new Error('Файл не соответствует формату сценария cosmo-A-1.0');
      }
      fillFromScenario(parsed);
      setLoadedFileName(file.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось прочитать файл');
    } finally {
      event.target.value = '';
    }
  };

  const buildScenario = (): ScenarioDto => {
    const planeCount = numeric(fields.planesCount, 'Количество плоскостей');
    const perPlane = numeric(fields.satellitesPerPlane, 'Спутников на плоскость');
    const horizon = numeric(fields.horizon, 'Горизонт');
    const step = numeric(fields.step, 'Шаг');
    const launchStage = numeric(fields.launchStage, 'Этап развёртывания');
    if (!fields.id.trim() || !/^[a-zA-Z0-9_-]+$/.test(fields.id)) throw new Error('Код проекта: только латинские буквы, цифры, _ и -');
    if (!fields.title.trim()) throw new Error('Укажите название проекта');
    if (!Number.isInteger(planeCount) || planeCount < 1 || planes.length !== planeCount) throw new Error('Количество плоскостей должно быть целым и больше нуля');
    if (!Number.isInteger(perPlane) || perPlane < 1) throw new Error('Количество спутников на плоскость должно быть целым и больше нуля');
    if (!Number.isInteger(horizon) || !Number.isInteger(step) || horizon % step !== 0) throw new Error('Горизонт и шаг должны быть целыми; горизонт должен делиться на шаг');
    if (![1, 2, 3].includes(launchStage)) throw new Error('Этап развёртывания должен быть 1, 2 или 3');

    const parsedPlanes = planes.map(plane => {
      const raan = numeric(plane.raan, `${plane.id}: RAAN`);
      const phase = numeric(plane.phase, `${plane.id}: фаза`);
      if (!plane.id.trim()) throw new Error('У каждой плоскости должен быть ID');
      if (raan < 0 || raan >= 360 || phase < 0 || phase >= 360) throw new Error(`${plane.id}: углы должны находиться в диапазоне [0°, 360°)`);
      return { id: plane.id.trim(), raan_deg: raan, phase_deg: phase };
    });
    if (new Set(parsedPlanes.map(plane => plane.id)).size !== parsedPlanes.length) throw new Error('ID плоскостей должны быть уникальными');

    if (satellites.length !== planeCount * perPlane) throw new Error('Количество строк спутников не соответствует структуре группировки');
    const parsedSatellites = satellites.map(satellite => {
      const launchBatch = numeric(satellite.launchBatch, `${satellite.id}: очередь запуска`);
      if (!satellite.id.trim() || !parsedPlanes.some(plane => plane.id === satellite.planeId)) throw new Error(`${satellite.id || 'Спутник'}: выберите существующую плоскость`);
      if (![1, 2, 3].includes(launchBatch)) throw new Error(`${satellite.id}: очередь запуска должна быть 1, 2 или 3`);
      return { id: satellite.id.trim(), plane_id: satellite.planeId, slot_deg: numeric(satellite.slot, `${satellite.id}: слот`), launch_batch: launchBatch as 1 | 2 | 3 };
    });
    if (new Set(parsedSatellites.map(satellite => satellite.id)).size !== parsedSatellites.length) throw new Error('ID спутников должны быть уникальными');

    const groundSites = sites.map(site => ({
      id: site.id.trim(), name: site.name.trim(), role: site.role,
      lat_deg: numeric(site.lat, `${site.id}: широта`), lon_deg: numeric(site.lon, `${site.id}: долгота`),
    }));
    if (groundSites.some(site => !site.id)) throw new Error('У каждого наземного пункта должен быть ID');
    if (new Set(groundSites.map(site => site.id)).size !== groundSites.length) throw new Error('ID наземных пунктов должны быть уникальными');
    if (groundSites.some(site => site.lat_deg < -90 || site.lat_deg > 90 || site.lon_deg < -180 || site.lon_deg > 180)) throw new Error('Проверьте диапазоны широты и долготы наземных пунктов');
    if (!groundSites.some(site => site.role === 'client') || !groundSites.some(site => site.role === 'gateway')) throw new Error('Нужны как минимум один клиент и один шлюз');
    const parsedFailures = failures.map(failure => ({
      satellite_id: failure.satelliteId.trim(),
      start_s: numeric(failure.start, `${failure.satelliteId}: начало отказа`),
      end_s: numeric(failure.end, `${failure.satelliteId}: окончание отказа`),
    }));
    if (parsedFailures.some(failure => !parsedSatellites.some(satellite => satellite.id === failure.satellite_id))) throw new Error('В периодах отказа указан неизвестный спутник');
    if (parsedFailures.some(failure => failure.start_s < 0 || failure.start_s >= failure.end_s || failure.end_s > horizon)) throw new Error('Периоды отказов должны находиться внутри расчётного горизонта');
    const parsedGatewayOutages = gatewayOutages.map(outage => ({
      gateway_id: outage.gatewayId.trim(),
      start_s: numeric(outage.start, `${outage.gatewayId}: начало недоступности`),
      end_s: numeric(outage.end, `${outage.gatewayId}: окончание недоступности`),
    }));
    if (parsedGatewayOutages.some(outage => !groundSites.some(site => site.role === 'gateway' && site.id === outage.gateway_id))) throw new Error('В периодах недоступности указан неизвестный шлюз');
    if (parsedGatewayOutages.some(outage => outage.start_s < 0 || outage.start_s >= outage.end_s || outage.end_s > horizon)) throw new Error('Периоды недоступности шлюзов должны находиться внутри расчётного горизонта');

    return {
      schema_version: 'cosmo-A-1.0',
      meta: { id: fields.id.trim(), title: fields.title.trim() },
      environment: {
        altitude_km: numeric(fields.altitude, 'Высота'), inclination_deg: numeric(fields.inclination, 'Наклонение'),
        earth_angle0_deg: numeric(fields.earthAngle, 'Начальный угол Земли'), horizon_s: horizon, step_s: step,
        min_elevation_deg: numeric(fields.minElevation, 'Минимальный угол места'), isl_range_km: numeric(fields.islRange, 'Дальность ISL'),
        target_availability: numeric(fields.targetAvailability, 'Целевая доступность') / 100,
      },
      design: { launch_stage: launchStage as 1 | 2 | 3, planes: parsedPlanes, satellites: parsedSatellites },
      ground_sites: groundSites,
      failures: parsedFailures,
      gateway_outages: parsedGatewayOutages,
    };
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null); setSaving(true);
    try { await onSave(buildScenario()); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };

  const field = (key: keyof Fields, label: string, placeholder = '') => <label className="space-y-1 text-[11px] text-slate-400">
    <span>{label}</span><input value={fields[key]} onChange={event => key === 'planesCount' || key === 'satellitesPerPlane' ? updateStructure(key, event.target.value) : updateField(key, event.target.value)} placeholder={placeholder} type={key === 'id' || key === 'title' ? 'text' : 'number'} className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500" />
  </label>;

  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
    <form onSubmit={submit} className="w-full max-w-4xl max-h-[94vh] flex flex-col rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
        <div><h2 className="font-semibold text-white">Конфигурация проекта</h2><p className="text-[11px] text-slate-400">Загрузите файл или заполните и измените параметры вручную</p></div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-6 pb-4 border-b border-slate-800">
        <label className="h-20 rounded-xl border border-dashed border-slate-700 hover:border-cyan-500 flex items-center justify-center gap-3 cursor-pointer text-slate-400">
          <FileUp className="w-6 h-6 text-cyan-400" /><div><div className="text-sm text-slate-200">Загрузить конфигурацию из JSON</div><div className="text-[11px]">{loadedFileName || 'Данные из файла заполнят форму ниже и останутся редактируемыми'}</div></div>
          <input type="file" accept="application/json,.json" onChange={event => void readFile(event)} className="hidden" />
        </label>
      </div>
      <div className="p-6 space-y-6 overflow-y-auto">
        <section><h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-cyan-400">Проект и расчёт</h3><div className="grid grid-cols-3 gap-3">
          {field('id', 'Код проекта', 'my_project')}{field('title', 'Название')}{field('launchStage', 'Этап развёртывания: 1–3')}
          {field('altitude', 'Высота, км')}{field('inclination', 'Наклонение, °')}{field('earthAngle', 'Начальный угол Земли, °')}
          {field('horizon', 'Горизонт, сек')}{field('step', 'Шаг, сек')}{field('targetAvailability', 'Целевая доступность, %')}
          {field('minElevation', 'Мин. угол места, °')}{field('islRange', 'Дальность ISL, км')}
        </div></section>

        <section><div className="flex items-end gap-3 mb-3"><h3 className="flex-1 text-xs font-semibold uppercase tracking-wider text-cyan-400">Группировка и плоскости</h3><div className="w-44">{field('planesCount', 'Количество плоскостей')}</div><div className="w-44">{field('satellitesPerPlane', 'Спутников на плоскость')}</div></div>
          <div className="grid grid-cols-[1fr_150px_150px] gap-2 px-3 pb-1 text-[10px] uppercase text-slate-500"><span>ID</span><span>RAAN, °</span><span>Фаза, °</span></div>
          <div className="space-y-2">{planes.map((plane, index) => <div key={index} className="grid grid-cols-[1fr_150px_150px] gap-2 rounded-xl bg-slate-900/60 border border-slate-800 p-2">
            {(['id', 'raan', 'phase'] as const).map(key => <input key={key} type={key === 'id' ? 'text' : 'number'} value={plane[key]} onChange={event => {
              const value = event.target.value;
              if (key === 'id') setSatellites(previous => previous.map(satellite => satellite.planeId === plane.id ? { ...satellite, planeId: value } : satellite));
              setPlanes(previous => previous.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
            }} className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white" />)}
          </div>)}</div>
          <details className="mt-3 rounded-xl border border-slate-800 bg-slate-900/30">
            <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-slate-300">Спутники ({satellites.length})</summary>
            <div className="max-h-72 overflow-y-auto border-t border-slate-800 p-3 space-y-2">
              <div className="grid grid-cols-[1fr_1fr_120px_100px] gap-2 px-2 text-[10px] uppercase text-slate-500"><span>ID</span><span>Плоскость</span><span>Слот, °</span><span>Очередь</span></div>
              {satellites.map((satellite, index) => <div key={index} className="grid grid-cols-[1fr_1fr_120px_100px] gap-2">
                <input value={satellite.id} onChange={event => setSatellites(previous => previous.map((item, i) => i === index ? { ...item, id: event.target.value } : item))} className="rounded-lg bg-slate-950 border border-slate-700 px-2 py-2 text-xs text-white" />
                <select value={satellite.planeId} onChange={event => setSatellites(previous => previous.map((item, i) => i === index ? { ...item, planeId: event.target.value } : item))} className="rounded-lg bg-slate-950 border border-slate-700 px-2 text-xs text-white">{planes.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select>
                <input type="number" value={satellite.slot} onChange={event => setSatellites(previous => previous.map((item, i) => i === index ? { ...item, slot: event.target.value } : item))} className="rounded-lg bg-slate-950 border border-slate-700 px-2 py-2 text-xs text-white" />
                <select value={satellite.launchBatch} onChange={event => setSatellites(previous => previous.map((item, i) => i === index ? { ...item, launchBatch: event.target.value } : item))} className="rounded-lg bg-slate-950 border border-slate-700 px-2 text-xs text-white"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>
              </div>)}
            </div>
          </details>
        </section>

        <section><div className="flex justify-between items-center mb-3"><h3 className="text-xs font-semibold uppercase tracking-wider text-cyan-400">Наземные пункты</h3><button type="button" onClick={() => setSites(previous => [...previous, { id: '', name: '', role: 'client', lat: '', lon: '' }])} className="text-xs text-cyan-300"><Plus className="inline w-3.5 h-3.5" /> Добавить</button></div>
          <div className="space-y-2">{sites.map((site, index) => <div key={index} className="grid grid-cols-[100px_1fr_110px_100px_100px_30px] gap-2 rounded-xl bg-slate-900/60 border border-slate-800 p-2">
            {(['id', 'name'] as const).map(key => <input key={key} value={site[key]} placeholder={key.toUpperCase()} onChange={event => setSites(previous => previous.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item))} className="rounded-lg bg-slate-950 border border-slate-700 px-2 py-2 text-xs text-white" />)}
            <select value={site.role} onChange={event => setSites(previous => previous.map((item, i) => i === index ? { ...item, role: event.target.value as SiteDraft['role'] } : item))} className="rounded-lg bg-slate-950 border border-slate-700 px-2 text-xs text-white"><option value="client">client</option><option value="gateway">gateway</option></select>
            {(['lat', 'lon'] as const).map(key => <input key={key} type="number" value={site[key]} placeholder={key} onChange={event => setSites(previous => previous.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item))} className="rounded-lg bg-slate-950 border border-slate-700 px-2 py-2 text-xs text-white" />)}
            <button type="button" onClick={() => setSites(previous => previous.filter((_, i) => i !== index))} className="text-rose-400"><Trash2 className="w-4 h-4" /></button>
          </div>)}</div>
        </section>

        <section><div className="flex justify-between items-center mb-3"><h3 className="text-xs font-semibold uppercase tracking-wider text-cyan-400">Периоды отказов</h3><button type="button" onClick={() => setFailures(previous => [...previous, { satelliteId: '', start: '', end: '' }])} className="text-xs text-cyan-300"><Plus className="inline w-3.5 h-3.5" /> Добавить</button></div>
          {failures.length === 0 ? <div className="rounded-xl border border-slate-800 p-4 text-center text-xs text-slate-500">Отказы не заданы</div> : <div className="space-y-2">{failures.map((failure, index) => <div key={index} className="grid grid-cols-[1fr_150px_150px_30px] gap-2 rounded-xl bg-slate-900/60 border border-slate-800 p-2">
            {(['satelliteId', 'start', 'end'] as const).map(key => <input key={key} type={key === 'satelliteId' ? 'text' : 'number'} value={failure[key]} placeholder={key === 'satelliteId' ? 'ID спутника' : key === 'start' ? 'Начало, сек' : 'Конец, сек'} onChange={event => setFailures(previous => previous.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item))} className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white" />)}
            <button type="button" onClick={() => setFailures(previous => previous.filter((_, i) => i !== index))} className="text-rose-400"><Trash2 className="w-4 h-4" /></button>
          </div>)}</div>}
        </section>
        <section><div className="flex justify-between items-center mb-3"><h3 className="text-xs font-semibold uppercase tracking-wider text-cyan-400">Недоступность шлюзов</h3><button type="button" onClick={() => setGatewayOutages(previous => [...previous, { gatewayId: '', start: '', end: '' }])} className="text-xs text-cyan-300"><Plus className="inline w-3.5 h-3.5" /> Добавить</button></div>
          {gatewayOutages.length === 0 ? <div className="rounded-xl border border-slate-800 p-4 text-center text-xs text-slate-500">Периоды недоступности не заданы</div> : <div className="space-y-2">{gatewayOutages.map((outage, index) => <div key={index} className="grid grid-cols-[1fr_150px_150px_30px] gap-2 rounded-xl bg-slate-900/60 border border-slate-800 p-2">
            {(['gatewayId', 'start', 'end'] as const).map(key => <input key={key} type={key === 'gatewayId' ? 'text' : 'number'} value={outage[key]} placeholder={key === 'gatewayId' ? 'ID шлюза' : key === 'start' ? 'Начало, сек' : 'Конец, сек'} onChange={event => setGatewayOutages(previous => previous.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item))} className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white" />)}
            <button type="button" onClick={() => setGatewayOutages(previous => previous.filter((_, i) => i !== index))} className="text-rose-400"><Trash2 className="w-4 h-4" /></button>
          </div>)}</div>}
        </section>
        {error && <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">{error}</div>}
      </div>
      <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-800"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs text-slate-300 bg-slate-800">Отмена</button><button disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 disabled:opacity-50"><Save className="w-3.5 h-3.5" />{saving ? 'Сохранение…' : 'Сохранить и запустить'}</button></div>
    </form>
  </div>;
};
