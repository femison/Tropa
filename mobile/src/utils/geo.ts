export type LatLng = { latitude: number; longitude: number };

const R = 6371000; // радиус Земли, м
const toRad = (d: number) => (d * Math.PI) / 180;

/** Расстояние между двумя точками, м (гаверсинус). */
export function distance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Расстояние от точки p до отрезка a–b, м.
 * На масштабах улиц достаточно локальной плоской проекции вокруг p.
 */
export function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = Math.cos(toRad(p.latitude)) * ((Math.PI * R) / 180);
  const ky = (Math.PI * R) / 180;
  const ax = (a.longitude - p.longitude) * kx;
  const ay = (a.latitude - p.latitude) * ky;
  const bx = (b.longitude - p.longitude) * kx;
  const by = (b.latitude - p.latitude) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.sqrt(cx * cx + cy * cy);
}

/** Точка на доле t (0..1) пути от a к b. */
export function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

export function midpoint(a: LatLng, b: LatLng): LatLng {
  return lerp(a, b, 0.5);
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} м` : `${(m / 1000).toFixed(1)} км`;
}

/** Точка внутри многоугольника (луч вправо). */
export function pointInRing(p: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.latitude > p.latitude !== b.latitude > p.latitude &&
      p.longitude < ((b.longitude - a.longitude) * (p.latitude - a.latitude)) / (b.latitude - a.latitude) + a.longitude
    )
      inside = !inside;
  }
  return inside;
}

/** Площадь многоугольника, м² (локальная плоская проекция). */
export function ringArea(ring: LatLng[]): number {
  if (ring.length < 3) return 0;
  const lat0 = (ring[0].latitude * Math.PI) / 180;
  const kx = Math.cos(lat0) * 111320;
  const ky = 110540;
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    s += ring[j].longitude * kx * (ring[i].latitude * ky) - ring[i].longitude * kx * (ring[j].latitude * ky);
  return Math.abs(s / 2);
}

/** Центр масс вершин — для подписи зоны. */
export function ringCenter(ring: LatLng[]): LatLng {
  let la = 0;
  let lo = 0;
  for (const p of ring) {
    la += p.latitude;
    lo += p.longitude;
  }
  return { latitude: la / ring.length, longitude: lo / ring.length };
}
