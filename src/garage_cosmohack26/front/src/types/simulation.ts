export type SatelliteStatus = 'active' | 'in_route' | 'offline';

export interface Satellite {
  id: string;
  name: string;
  planeIndex: number;
  satIndex: number;
  status: SatelliteStatus;
  position: [number, number, number]; // 3D coordinates in scene units
  lat: number;
  lon: number;
  altitudeKm: number;
  sunlit: boolean;
}

export interface GroundStation {
  id: string;
  name: string;
  type: 'client' | 'gateway';
  lat: number;
  lon: number;
  label: string;
  position?: [number, number, number];
}

export interface FailureEvent {
  id: string;
  satelliteId: string;
  startSeconds: number; // e.g. 10:00 = 36000
  endSeconds: number;   // e.g. 12:00 = 43200
}

export interface ConstellationConfig {
  id: string;
  name: string;
  fileName: string;
  totalSatellites: number;
  planes: number;
  satsPerPlane: number;
  altitudeKm: number;
  inclinationDeg: number;
  raanSpreadDeg: number;
  phasingDeg: number;
  deploymentBatch: string;
  launchedCount: number;
  islEnabled: boolean; // Inter-satellite links
  failures: FailureEvent[];
}

export interface CommunicationRoute {
  id: string;
  name: string;
  clientStationId: string;
  gatewayStationId: string;
  satelliteHops: string[]; // e.g. ['SAT-12', 'SAT-18']
  latencyMs: number | null;
  totalRangeKm: number | null;
  status: 'optimal' | 'alternate' | 'degraded' | 'offline';
  isPrimary: boolean;
}

export interface SimulationTime {
  timeSeconds: number; // 0 to 86400
  isPlaying: boolean;
  speed: 1 | 5 | 10 | 50 | 100;
  horizonSeconds: number;
}

export interface TimelineEvent {
  id: string;
  timeSeconds: number;
  timeFormatted: string;
  title: string;
  description: string;
  type: 'anomaly' | 'handover' | 'aos' | 'los' | 'maintenance';
  severity: 'info' | 'warning' | 'critical';
  satelliteId?: string;
  stationId?: string;
}

export interface SceneLayers {
  showOrbits: boolean;
  showCoverageCones: boolean;
  showLabels: boolean;
}
