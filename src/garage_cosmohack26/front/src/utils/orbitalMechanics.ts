import { ConstellationConfig } from '../types/simulation';

export const EARTH_RADIUS_SCENE = 5.0;
export const REAL_EARTH_RADIUS_KM = 6371.0;
const SIDEREAL_DAY_SECONDS = 86164.09054;

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
  timeSeconds: number,
  segments = 96,
): Array<{ planeIndex: number; points: [number, number, number][] }> {
  const result: Array<{ planeIndex: number; points: [number, number, number][] }> = [];
  const radius = EARTH_RADIUS_SCENE * (1 + config.altitudeKm / REAL_EARTH_RADIUS_KM);
  const inclination = (config.inclinationDeg * Math.PI) / 180;
  const earthAngle = (config.earthAngle0Deg * Math.PI) / 180
    + (2 * Math.PI * timeSeconds) / SIDEREAL_DAY_SECONDS;
  const cosEarth = Math.cos(earthAngle);
  const sinEarth = Math.sin(earthAngle);
  for (let planeIndex = 0; planeIndex < config.orbitPlanes.length; planeIndex += 1) {
    const raan = config.orbitPlanes[planeIndex].raanDeg * Math.PI / 180;
    const cosRaan = Math.cos(raan);
    const sinRaan = Math.sin(raan);
    const points: [number, number, number][] = [];
    for (let segment = 0; segment <= segments; segment += 1) {
      const theta = (segment / segments) * Math.PI * 2;
      const cosPosition = Math.cos(theta);
      const sinPosition = Math.sin(theta);
      // Same inertial formula as back/geometry.py.
      const inertialX = radius * (cosRaan * cosPosition - sinRaan * sinPosition * Math.cos(inclination));
      const inertialY = radius * (sinRaan * cosPosition + cosRaan * sinPosition * Math.cos(inclination));
      const inertialZ = radius * sinPosition * Math.sin(inclination);
      // Convert ECI to the backend's Earth-fixed frame, then to Three.js (X, Z, -Y).
      const fixedX = inertialX * cosEarth + inertialY * sinEarth;
      const fixedY = -inertialX * sinEarth + inertialY * cosEarth;
      points.push([
        fixedX,
        inertialZ,
        -fixedY,
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
