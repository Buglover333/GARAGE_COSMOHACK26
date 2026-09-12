import { FormEvent, useEffect, useState } from 'react';
import { Orbit, Save, X } from 'lucide-react';
import { PlaneDto, ScenarioDto } from '../api/simulation';

interface Props {
  isOpen: boolean;
  scenario: ScenarioDto | null;
  onClose: () => void;
  onSave: (planes: PlaneDto[]) => Promise<void>;
}

type PlaneDraft = { id: string; raan: string; phase: string };

export const PlaneEditorModal = ({ isOpen, scenario, onClose, onSave }: Props) => {
  const [planes, setPlanes] = useState<PlaneDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !scenario) return;
    setPlanes(scenario.design.planes.map(plane => ({
      id: plane.id,
      raan: String(plane.raan_deg),
      phase: String(plane.phase_deg),
    })));
    setError(null);
  }, [isOpen, scenario]);

  if (!isOpen || !scenario) return null;

  const updatePlane = (index: number, field: 'raan' | 'phase', value: string) => {
    setPlanes(previous => previous.map((plane, planeIndex) =>
      planeIndex === index ? { ...plane, [field]: value } : plane
    ));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = planes.map(plane => {
        const raan = Number(plane.raan);
        const phase = Number(plane.phase);
        if (!plane.raan.trim() || !Number.isFinite(raan) || raan < 0 || raan >= 360) {
          throw new Error(`${plane.id}: RAAN должен находиться в диапазоне от 0° до 360°`);
        }
        if (!plane.phase.trim() || !Number.isFinite(phase) || phase < 0 || phase >= 360) {
          throw new Error(`${plane.id}: фазирование должно находиться в диапазоне от 0° до 360°`);
        }
        return { id: plane.id, raan_deg: raan, phase_deg: phase };
      });
      await onSave(updated);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
    <form onSubmit={submit} className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Orbit className="w-4 h-4 text-cyan-400" />
          <div>
            <h2 className="font-semibold text-white">Орбитальные плоскости</h2>
            <p className="text-[11px] text-slate-400">RAAN и фазирование задаются независимо для каждой плоскости</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-[1fr_140px_140px] gap-3 px-6 py-2.5 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
        <span>Плоскость</span><span>RAAN, °</span><span>Фаза, °</span>
      </div>
      <div className="p-6 pt-3 space-y-2 overflow-y-auto">
        {planes.map((plane, index) => <div key={plane.id} className="grid grid-cols-[1fr_140px_140px] gap-3 items-center rounded-xl bg-slate-900/70 border border-slate-800 px-3 py-2">
          <span className="font-mono-data font-semibold text-white">{plane.id}</span>
          <input
            type="number"
            min="0"
            max="359.999"
            step="any"
            value={plane.raan}
            onChange={event => updatePlane(index, 'raan', event.target.value)}
            className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs font-mono-data text-white outline-none focus:border-cyan-500"
          />
          <input
            type="number"
            min="0"
            max="359.999"
            step="any"
            value={plane.phase}
            onChange={event => updatePlane(index, 'phase', event.target.value)}
            className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs font-mono-data text-white outline-none focus:border-cyan-500"
          />
        </div>)}
        {error && <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">{error}</div>}
      </div>

      <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-800">
        <span className="text-[11px] text-slate-500">После сохранения расчёт начнётся с нулевого шага.</span>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs text-slate-300 bg-slate-800">Отмена</button>
          <button disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 disabled:opacity-50">
            <Save className="w-3.5 h-3.5" />{saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </form>
  </div>;
};
