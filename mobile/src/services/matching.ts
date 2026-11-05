import { distance, distanceToSegment, lerp, LatLng } from '../utils/geo';
import { Segment } from './osm';

/** Точка трека должна быть не дальше этого от оси улицы. */
const MATCH_RADIUS = 20; // м
/** Соседние отрезки (перекрёстки) ближе этого тоже засчитываем. */
const NEAR_RADIUS = 8; // м
/** Если между точками GPS больше — считаем, что это прыжок, и не интерполируем. */
const MAX_GAP = 120; // м
const STEP = 8; // м — шаг интерполяции между точками GPS

const CELL = 0.001; // ~100 м по широте

/** Сетка для быстрого поиска отрезков рядом с точкой. */
export class SegmentIndex {
  private grid = new Map<string, Segment[]>();

  constructor(segments: Segment[]) {
    for (const s of segments) {
      const minX = Math.floor(Math.min(s.a.longitude, s.b.longitude) / CELL);
      const maxX = Math.floor(Math.max(s.a.longitude, s.b.longitude) / CELL);
      const minY = Math.floor(Math.min(s.a.latitude, s.b.latitude) / CELL);
      const maxY = Math.floor(Math.max(s.a.latitude, s.b.latitude) / CELL);
      for (let x = minX; x <= maxX; x++)
        for (let y = minY; y <= maxY; y++) {
          const key = `${x},${y}`;
          const list = this.grid.get(key);
          if (list) list.push(s);
          else this.grid.set(key, [s]);
        }
    }
  }

  near(p: LatLng): Segment[] {
    const cx = Math.floor(p.longitude / CELL);
    const cy = Math.floor(p.latitude / CELL);
    const out = new Set<Segment>();
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (const s of this.grid.get(`${x},${y}`) ?? []) out.add(s);
    return [...out];
  }
}

function matchPoint(index: SegmentIndex, p: LatLng, out: Set<string>) {
  let best: Segment | null = null;
  let bestD = Infinity;
  for (const s of index.near(p)) {
    const d = distanceToSegment(p, s.a, s.b);
    if (d <= NEAR_RADIUS) out.add(s.id);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (best && bestD <= MATCH_RADIUS) out.add(best.id);
}

/**
 * Какие отрезки покрывает шаг трека от prev до cur.
 * Между точками GPS добавляем промежуточные, чтобы быстрый шаг не пропускал отрезки.
 */
export function matchStep(index: SegmentIndex, prev: LatLng | null, cur: LatLng): Set<string> {
  const out = new Set<string>();
  if (prev) {
    const gap = distance(prev, cur);
    if (gap <= MAX_GAP) {
      const n = Math.floor(gap / STEP);
      for (let i = 1; i < n; i++) matchPoint(index, lerp(prev, cur, i / n), out);
    }
  }
  matchPoint(index, cur, out);
  return out;
}
