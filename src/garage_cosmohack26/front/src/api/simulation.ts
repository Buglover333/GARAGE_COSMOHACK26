import { CommunicationRoute, ConstellationConfig, GroundStation, Satellite } from '../types/simulation';
import { EARTH_RADIUS_SCENE, REAL_EARTH_RADIUS_KM, vector3ToLatLon } from '../utils/orbitalMechanics';

export interface PlaneDto { id: string; raan_deg: number; phase_deg: number }
interface SatelliteDto { id: string; plane_id: string; slot_deg: number; launch_batch: number }
interface GroundSiteDto { id: string; name: string; role: 'gateway' | 'client'; lat_deg: number; lon_deg: number }

export interface ScenarioDto {
  schema_version: 'cosmo-A-1.0';
  meta: { id: string; title: string };
  environment: {
    altitude_km: number;
    inclination_deg: number;
    earth_angle0_deg: number;
    horizon_s: number;
    step_s: number;
    min_elevation_deg: number;
    isl_range_km: number;
    target_availability: number;
  };
  design: {
    launch_stage: number;
    planes: PlaneDto[];
    satellites: SatelliteDto[];
  };
  ground_sites: GroundSiteDto[];
  failures: Array<Record<string, unknown>>;
  gateway_outages: Array<Record<string, unknown>>;
}

export interface ConfigSummaryDto {
  id: string;
  title: string;
  is_example: boolean;
  satellites: number;
  ground_sites: number;
  updated_at: number;
}

interface TelemetryDto {
  t_s: number;
  horizon_s: number;
  step_s: number;
  satellites: Array<{
    id: string;
    x_km: number;
    y_km: number;
    z_km: number;
    active: boolean;
    sunlit: boolean;
  }>;
}

interface RoutesDto {
  t_s: number;
  routes: Array<{
    gateway: string;
    client: string;
    path: string[];
    hops: number;
    total_range_km: number | null;
    propagation_ms: number | null;
    reachable: boolean;
  }>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { detail?: string | Array<{ msg?: string }> };
      if (typeof body.detail === 'string') message = body.detail;
      if (Array.isArray(body.detail)) message = body.detail.map(item => item.msg).filter(Boolean).join('; ') || message;
    } catch {
      // Keep the HTTP status when the server did not return JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const simulationApi = {
  getConfigs: () => request<ConfigSummaryDto[]>('/api/configs'),
  getConfig: (id: string) => request<ScenarioDto>(`/api/configs/${encodeURIComponent(id)}`),
  loadScenario: (id: string) => request<{ loaded: string }>(
    `/api/scenario/load/${encodeURIComponent(id)}`,
    { method: 'POST' },
  ),
  getScenario: () => request<{ meta: { config_id: string | null }; scenario: ScenarioDto }>('/api/scenario'),
  replaceScenario: (scenario: ScenarioDto) => request('/api/scenario', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scenario),
  }),
  saveScenario: (id: string, title: string) => request(
    `/api/configs?config_id=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}`,
    { method: 'POST' },
  ),
  getTelemetry: () => request<TelemetryDto>('/api/telemetry'),
  getRoutes: () => request<RoutesDto>('/api/routes'),
  patchScenario: (patch: Record<string, unknown>) => request('/api/scenario/patch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }),
};

export function toConfig(scenario: ScenarioDto): ConstellationConfig {
  const launched = scenario.design.satellites.filter(
    satellite => satellite.launch_batch <= scenario.design.launch_stage
  ).length;
  return {
    id: scenario.meta.id,
    name: scenario.meta.title || scenario.meta.id,
    fileName: `${scenario.meta.id}.json`,
    totalSatellites: scenario.design.satellites.length,
    planes: scenario.design.planes.length,
    satsPerPlane: scenario.design.planes.length
      ? Math.round(scenario.design.satellites.length / scenario.design.planes.length)
      : 0,
    altitudeKm: scenario.environment.altitude_km,
    inclinationDeg: scenario.environment.inclination_deg,
    earthAngle0Deg: scenario.environment.earth_angle0_deg,
    orbitPlanes: scenario.design.planes.map(plane => ({
      id: plane.id,
      raanDeg: plane.raan_deg,
      phaseDeg: plane.phase_deg,
    })),
    deploymentBatch: `${scenario.design.launch_stage} / 3`,
    launchedCount: launched,
    islEnabled: scenario.environment.isl_range_km > 0,
    failures: scenario.failures.flatMap(failure => {
      const satelliteId = failure.satellite_id;
      const startSeconds = failure.start_s;
      const endSeconds = failure.end_s;
      if (typeof satelliteId !== 'string' || typeof startSeconds !== 'number' || typeof endSeconds !== 'number') return [];
      return [{
        id: `${satelliteId}:${startSeconds}:${endSeconds}`,
        satelliteId,
        startSeconds,
        endSeconds,
      }];
    }),
  };
}

export function toStations(scenario: ScenarioDto): GroundStation[] {
  return scenario.ground_sites.map(site => ({
    id: site.id,
    name: site.name || site.id,
    label: site.name || site.id,
    type: site.role,
    lat: site.lat_deg,
    lon: site.lon_deg,
  }));
}

export function toSatellites(frame: TelemetryDto, scenario: ScenarioDto, route: CommunicationRoute | null): Satellite[] {
  const scale = EARTH_RADIUS_SCENE / REAL_EARTH_RADIUS_KM;
  const routeIds = new Set(route?.satelliteHops ?? []);
  const definitions = new Map(scenario.design.satellites.map(s => [s.id, s]));
  const planeIndexes = new Map(scenario.design.planes.map((p, index) => [p.id, index]));
  const slotsByPlane = new Map<string, string[]>();
  scenario.design.satellites.forEach(s => slotsByPlane.set(s.plane_id, [...(slotsByPlane.get(s.plane_id) ?? []), s.id]));

  return frame.satellites.map(item => {
    // Backend uses ECEF (X,Y,Z); the Three.js globe uses (X,Z,-Y).
    const position: [number, number, number] = [item.x_km * scale, item.z_km * scale, -item.y_km * scale];
    const coordinates = vector3ToLatLon(...position);
    const definition = definitions.get(item.id);
    return {
      id: item.id,
      name: item.id,
      planeIndex: planeIndexes.get(definition?.plane_id ?? '') ?? 0,
      satIndex: slotsByPlane.get(definition?.plane_id ?? '')?.indexOf(item.id) ?? 0,
      status: !item.active ? 'offline' : routeIds.has(item.id) ? 'in_route' : 'active',
      position,
      lat: coordinates.lat,
      lon: coordinates.lon,
      altitudeKm: scenario.environment.altitude_km,
      sunlit: item.sunlit,
    };
  });
}

export function toRoutes(frame: RoutesDto): CommunicationRoute[] {
  return frame.routes.map((route, index) => {
    const pathFromClient = route.path[0] === route.gateway ? [...route.path].reverse() : route.path;
    return {
      id: `${route.gateway}:${route.client}`,
      name: pathFromClient.length ? pathFromClient.join(' → ') : `${route.client} → ${route.gateway}`,
      clientStationId: route.client,
      gatewayStationId: route.gateway,
      satelliteHops: pathFromClient.filter(id => id !== route.client && id !== route.gateway),
      latencyMs: route.propagation_ms,
      totalRangeKm: route.total_range_km,
      status: route.reachable ? 'optimal' : 'offline',
      isPrimary: index === 0,
    };
  });
}
