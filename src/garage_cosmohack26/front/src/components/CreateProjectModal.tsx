import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { FileUp, Plus, X } from 'lucide-react';
import { ScenarioDto } from '../api/simulation';

interface Props {
  isOpen: boolean;
  initialMode: 'manual' | 'file';
  onClose: () => void;
  onCreate: (scenario: ScenarioDto) => Promise<void>;
}

type ManualFields = Record<'id' | 'title' | 'planes' | 'satellitesPerPlane' | 'altitude' | 'inclination' | 'phase' | 'earthAngle' | 'horizon' | 'step' | 'minElevation' | 'islRange' | 'targetAvailability' | 'gatewayName' | 'gatewayLat' | 'gatewayLon' | 'clientName' | 'clientLat' | 'clientLon', string>;

const blankFields: ManualFields = {
  id: '', title: '', planes: '', satellitesPerPlane: '', altitude: '', inclination: '', phase: '', earthAngle: '',
  horizon: '', step: '', minElevation: '', islRange: '', targetAvailability: '', gatewayName: '', gatewayLat: '',
  gatewayLon: '', clientName: '', clientLat: '', clientLon: '',
};

const number = (value: string, label: string) => {
  const parsed = Number(value);
  if (!value.trim() || !Number.isFinite(parsed)) throw new Error(`Заполните поле «${label}»`);
  return parsed;
};

function buildScenario(fields: ManualFields): ScenarioDto {
  const planesCount = number(fields.planes, 'Плоскости');
  const perPlane = number(fields.satellitesPerPlane, 'Спутников на плоскость');
  const horizon = number(fields.horizon, 'Горизонт');
  const step = number(fields.step, 'Шаг');
  const phase = number(fields.phase, 'Межплоскостная фаза');
  if (!Number.isInteger(planesCount) || planesCount < 1) throw new Error('Количество плоскостей должно быть целым и больше нуля');
  if (!Number.isInteger(perPlane) || perPlane < 1) throw new Error('Количество спутников должно быть целым и больше нуля');
  if (horizon % step !== 0) throw new Error('Горизонт должен делиться на шаг без остатка');
  if (!fields.id.trim() || !/^[a-zA-Z0-9_-]+$/.test(fields.id)) throw new Error('Код проекта: только латинские буквы, цифры, _ и -');
  if (!fields.title.trim()) throw new Error('Укажите название проекта');

  const planes = Array.from({ length: planesCount }, (_, index) => ({
    id: `P${index + 1}`,
    raan_deg: (index * 360) / planesCount,
    phase_deg: (index * phase) % 360,
  }));
  const satellites = planes.flatMap((plane, planeIndex) => Array.from({ length: perPlane }, (_, slotIndex) => ({
    id: `S${String(planeIndex * perPlane + slotIndex + 1).padStart(2, '0')}`,
    plane_id: plane.id,
    slot_deg: (slotIndex * 360) / perPlane,
    launch_batch: 1,
  })));

  return {
    schema_version: 'cosmo-A-1.0',
    meta: { id: fields.id.trim(), title: fields.title.trim() },
    environment: {
      altitude_km: number(fields.altitude, 'Высота'),
      inclination_deg: number(fields.inclination, 'Наклонение'),
      earth_angle0_deg: number(fields.earthAngle, 'Начальный угол Земли'),
      horizon_s: horizon,
      step_s: step,
      min_elevation_deg: number(fields.minElevation, 'Минимальный угол'),
      isl_range_km: number(fields.islRange, 'Дальность ISL'),
      target_availability: number(fields.targetAvailability, 'Целевая доступность') / 100,
    },
    design: { launch_stage: 1, planes, satellites },
    ground_sites: [
      { id: 'G1', name: fields.gatewayName.trim() || 'G1', role: 'gateway', lat_deg: number(fields.gatewayLat, 'Широта шлюза'), lon_deg: number(fields.gatewayLon, 'Долгота шлюза') },
      { id: 'C1', name: fields.clientName.trim() || 'C1', role: 'client', lat_deg: number(fields.clientLat, 'Широта клиента'), lon_deg: number(fields.clientLon, 'Долгота клиента') },
    ],
    failures: [],
    gateway_outages: [],
  };
}

export const CreateProjectModal = ({ isOpen, initialMode, onClose, onCreate }: Props) => {
  const [mode, setMode] = useState(initialMode);
  const [fields, setFields] = useState<ManualFields>(blankFields);
  const [fileScenario, setFileScenario] = useState<ScenarioDto | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (isOpen) { setMode(initialMode); setError(null); } }, [initialMode, isOpen]);
  if (!isOpen) return null;

  const update = (key: keyof ManualFields, value: string) => setFields(previous => ({ ...previous, [key]: value }));
  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError(null);
    setFileScenario(null);
    setFileName(file?.name ?? '');
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as ScenarioDto;
      if (parsed.schema_version !== 'cosmo-A-1.0' || !parsed.meta?.id || !parsed.environment || !parsed.design) {
        throw new Error('Файл не соответствует формату сценария cosmo-A-1.0');
      }
      setFileScenario(parsed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось прочитать файл');
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const scenario = mode === 'manual' ? buildScenario(fields) : fileScenario;
      if (!scenario) throw new Error('Выберите JSON-файл проекта');
      await onCreate(scenario);
      setFields(blankFields);
      setFileScenario(null);
      setFileName('');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const inputs: Array<[keyof ManualFields, string, string]> = [
    ['id', 'Код проекта', 'my_constellation'], ['title', 'Название', 'Название проекта'],
    ['planes', 'Орбитальных плоскостей', '6'], ['satellitesPerPlane', 'Спутников на плоскость', '8'],
    ['altitude', 'Высота, км', '550'], ['inclination', 'Наклонение, °', '53'],
    ['phase', 'Межплоскостная фаза, °', '20'], ['earthAngle', 'Начальный угол Земли, °', '0'],
    ['horizon', 'Горизонт, сек', '86400'], ['step', 'Шаг, сек', '120'],
    ['minElevation', 'Мин. угол места, °', '10'], ['islRange', 'Дальность ISL, км', '3000'],
    ['targetAvailability', 'Целевая доступность, %', '90'],
    ['gatewayName', 'Название шлюза', 'Основной шлюз'], ['gatewayLat', 'Широта шлюза', ''],
    ['gatewayLon', 'Долгота шлюза', ''], ['clientName', 'Название клиента', 'Наземный терминал'],
    ['clientLat', 'Широта клиента', ''], ['clientLon', 'Долгота клиента', ''],
  ];

  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
    <form onSubmit={submit} className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
        <h2 className="font-semibold text-white">Создание проекта</h2>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex p-1 mx-6 mt-4 rounded-xl bg-slate-900 border border-slate-800">
        <button type="button" onClick={() => setMode('manual')} className={`flex-1 py-2 rounded-lg text-xs ${mode === 'manual' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}><Plus className="inline w-3.5 h-3.5 mr-1" />Вручную</button>
        <button type="button" onClick={() => setMode('file')} className={`flex-1 py-2 rounded-lg text-xs ${mode === 'file' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}><FileUp className="inline w-3.5 h-3.5 mr-1" />Из файла</button>
      </div>
      <div className="p-6 overflow-y-auto">
        {mode === 'manual' ? <div className="grid grid-cols-2 gap-3">
          {inputs.map(([key, label, placeholder]) => <label key={key} className="space-y-1 text-[11px] text-slate-400">
            <span>{label}</span>
            <input value={fields[key]} onChange={event => update(key, event.target.value)} placeholder={placeholder} type={key === 'id' || key === 'title' || key.endsWith('Name') ? 'text' : 'number'} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500" />
          </label>)}
        </div> : <label className="min-h-44 rounded-xl border border-dashed border-slate-700 hover:border-cyan-500 flex flex-col items-center justify-center gap-3 cursor-pointer text-slate-400">
          <FileUp className="w-8 h-8 text-cyan-400" />
          <span className="text-sm">{fileName || 'Выберите JSON-файл сценария'}</span>
          {fileScenario && <span className="text-xs text-emerald-400">{fileScenario.meta.title || fileScenario.meta.id}</span>}
          <input type="file" accept="application/json,.json" onChange={event => void readFile(event)} className="hidden" />
        </label>}
        {error && <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">{error}</div>}
      </div>
      <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-800">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs text-slate-300 bg-slate-800">Отмена</button>
        <button disabled={submitting} className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 disabled:opacity-50">{submitting ? 'Создание…' : 'Создать проект'}</button>
      </div>
    </form>
  </div>;
};
