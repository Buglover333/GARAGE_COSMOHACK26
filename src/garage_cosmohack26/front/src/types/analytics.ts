import { ScenarioDto } from '../api/simulation';

export interface ClientMetrics {
  visibility_pct: number;
  gateway_availability_pct: number;
  max_interruption_s: number;
  avg_hops: number | null;
}

export interface MetricsTimestep {
  t_s: number;
  client_id: string;
  visible: boolean;
  has_path: boolean;
  path: string[];
  hops: number | null;
}

export interface MetricsResponse {
  summary: Record<string, ClientMetrics>;
  timesteps?: MetricsTimestep[];
}

export interface ComparisonSummary {
  name: string;
  mean_availability: number | null;
  min_availability: number | null;
  mean_visibility: number | null;
}

export interface ComparisonRow {
  client_id: string;
  [scenarioName: string]: string | ClientMetrics;
}

export interface ComparisonDelta {
  client_id: string;
  baseline: string;
  other: string;
  availability_delta: number | null;
  visibility_delta: number | null;
  max_interruption_delta_s: number | null;
}

export interface FileComparisonResponse {
  scenarios: string[];
  clients: string[];
  rows: ComparisonRow[];
  summaries: ComparisonSummary[];
  pairwise_vs_baseline: ComparisonDelta[];
}

export interface OptimizationBounds {
  footprint_half_angle_deg: number;
  footprint_radius_km: number;
  min_sats_per_plane: number;
  sats_per_plane_used: number;
  sats_total_used: number;
  raan_step_deg: number;
}

export interface OptimizationStage {
  requested_planes: number;
  stage: number;
  n_sat: number;
  scenario: ScenarioDto;
  metrics?: Record<string, ClientMetrics>;
  bounds: OptimizationBounds;
  best_score: number;
  met_target: boolean;
}

export interface OptimizationOptions {
  minPlanes: number;
  maxPlanes: number;
  satellitesPerPlane: number[];
  iterations: number;
  seed: number;
  includeMetrics?: boolean;
}

