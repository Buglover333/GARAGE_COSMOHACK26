import { ConstellationConfig } from '../types/simulation';

export const EARTH_RADIUS_SCENE = 5.0;
export const REAL_EARTH_RADIUS_KM = 6371.0;

export function latLonToVector3(lat: number, lon: number, radius: number): [number, number, number] {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return [
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ];
}

export function vector3ToLatLon(x: number, y: number, z: number): { lat: number; lon: number } {
  const radius = Math.sqrt(x * x + y * y + z * z);
  if (!radius) return { lat: 0, lon: 0 };
  const lat = 90 - (Math.acos(Math.max(-1, Math.min(1, y / radius))) * 180) / Math.PI;
  let lon = (Math.atan2(z, -x) * 180) / Math.PI - 180;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return { lat, lon };
}

export function generateOrbitPlanes(
  config: ConstellationConfig,
  segments = 96,
): Array<{ planeIndex: number; points: [number, number, number][] }> {
  const result: Array<{ planeIndex: number; points: [number, number, number][] }> = [];
  const radius = EARTH_RADIUS_SCENE * (1 + config.altitudeKm / REAL_EARTH_RADIUS_KM);
  const inclination = (config.inclinationDeg * Math.PI) / 180;
  for (let planeIndex = 0; planeIndex < config.planes; planeIndex += 1) {
    const raan = ((planeIndex * 360) / Math.max(config.planes, 1)) * Math.PI / 180;
    const points: [number, number, number][] = [];
    for (let segment = 0; segment <= segments; segment += 1) {
      const theta = (segment / segments) * Math.PI * 2;
      const xOrbital = radius * Math.cos(theta);
      const zOrbital = radius * Math.sin(theta);
      const xInclined = xOrbital;
      const yInclined = zOrbital * Math.sin(inclination);
      const zInclined = zOrbital * Math.cos(inclination);
      points.push([
        xInclined * Math.cos(raan) + zInclined * Math.sin(raan),
        yInclined,
        -xInclined * Math.sin(raan) + zInclined * Math.cos(raan),
      ]);
    }
    result.push({ planeIndex, points });
  }
  return result;
}

export function formatTimeSeconds(seconds: number): string {
  const normalized = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const remainder = normalized % 60;
  return [hours, minutes, remainder].map(value => value.toString().padStart(2, '0')).join(':');
}
