import { classifyRings, VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { distance, distanceToSegment, lerp, midpoint, pointInRing, ringArea, ringCenter, LatLng } from '../utils/geo';
import { fetchWithTimeout } from '../utils/net';

/** Кусок улицы длиной до MAX_SEGMENT метров — минимальная единица закрашивания. */
export type Segment = {
  id: string; // по координатам середины — не зависит от того, как данные порезаны на тайлы
  wayId: number;
  a: LatLng;
  b: LatLng;
  length: number;
};

export type Street = {
  wayId: number;
  name: string | null;
  segmentIds: string[];
  parkId: number | null; // дорожка или улица внутри парка
};

/** Парк — отдельная зона: свой процент пройденных дорожек и статус «захвачен». */
export type Park = {
  id: number;
  /** Стабильный ключ (по центру) — для сохранения прогресса между загрузками района. */
  key: string;
  name: string | null;
  pieces: LatLng[][]; // контур, разрезанный по тайлам
  center: LatLng;
  areaM2: number;
  segmentIds: string[];
};

/** Место на карте (кафе, магазин, памятник…) — для подсказок к квесту. */
export type Poi = { name: string; cls: string; sub: string; p: LatLng };

export type Area = {
  center: LatLng;
  radius: number;
  loadedAt: number;
  streets: Street[];
  segments: Segment[];
  parks: Park[];
  pois: Poi[];
};

/** Компактный вид для кэша: координаты [lat, lon, lat, lon, ...]. */
export type RawWay = { id: number; name: string | null; coords: number[]; park?: number };
export type RawPark = { id: number; name: string | null; pieces: number[][] };
export type RawPoi = [name: string, cls: string, sub: string, lat: number, lon: number];

export type RawArea = {
  center: LatLng;
  radius: number;
  loadedAt: number;
  ways: RawWay[];
  parks: RawPark[];
  pois: RawPoi[];
};

export const AREA_RADIUS = 1200; // м
const MAX_SEGMENT = 30; // м
const NAME_RADIUS = 15; // м — насколько далеко может быть линия с названием от линии улицы
const MIN_PARK_M2 = 4000; // скверы меньше — не отдельная зона

/*
 * Улицы берём из векторных тайлов OpenFreeMap: это данные OpenStreetMap в схеме OpenMapTiles,
 * раздаются через CDN, бесплатно и без ключа. Публичные серверы Overpass для приложения
 * не годятся — они часто перегружены и отвечают десятки секунд.
 */
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const Z = 14; // на этом зуме в тайлах есть все улицы и дорожки

// Что считаем «улицей» для закрашивания. Тротуары (path/footway) и лестницы в городе не берём:
// они идут вдоль проезжей части и раздували бы процент. Внутри парков — берём, это и есть аллеи.
const ROAD_CLASSES = new Set(['minor', 'tertiary', 'secondary', 'primary', 'track']);
const PATH_SUBCLASSES = new Set(['pedestrian', 'path', 'cycleway', 'bridleway']);
const PARK_ONLY_SUBCLASSES = new Set(['footway', 'steps']);

// Места, которые помогают найти то, что нужно в задании. Остановки, парковки и т. п. не берём.
const POI_SKIP = new Set(['bus', 'railway', 'parking', 'fuel', 'car', 'bicycle_parking', 'atm', 'toilets', 'entrance']);

type Kind = 'road' | 'parkPath' | null;
function walkKind(p: Record<string, unknown>): Kind {
  if (p.brunnel === 'tunnel') return null;
  if (ROAD_CLASSES.has(p.class as string)) return 'road';
  if (p.class !== 'path') return null;
  if (PATH_SUBCLASSES.has(p.subclass as string)) return 'road';
  if (PARK_ONLY_SUBCLASSES.has(p.subclass as string)) return 'parkPath';
  return null;
}

let tileUrlCache: string | null = null;

/** Адрес тайлов содержит версию данных — берём актуальный из TileJSON. */
async function tileUrl(): Promise<string> {
  if (tileUrlCache) return tileUrlCache;
  const res = await fetchWithTimeout(TILEJSON);
  if (!res.ok) throw new Error(`OpenFreeMap ${res.status}`);
  const j = await res.json();
  tileUrlCache = j.tiles[0] as string;
  return tileUrlCache;
}

function lonToX(lon: number, n: number) {
  return ((lon + 180) / 360) * n;
}
function latToY(lat: number, n: number) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
}

type Pt = { x: number; y: number };
type Line = { pts: LatLng[]; name: string | null; kind: Kind };

/** Перевод координат тайла в широту/долготу. */
function projector(tx: number, ty: number, ext: number) {
  const n = 2 ** Z;
  return (px: number, py: number): LatLng => {
    const x = tx + px / ext;
    const y = ty + py / ext;
    return {
      latitude: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
      longitude: (x / n) * 360 - 180,
    };
  };
}

const nameOf = (p: Record<string, unknown>) => ((p['name:ru'] as string) ?? (p.name as string) ?? null) || null;

/**
 * Достаёт линии слоя из тайла. Берём только те отрезки, середина которых внутри самого тайла
 * (тайлы заходят друг на друга буфером) и внутри радиуса района.
 */
function readLines(vt: VectorTile, layer: string, tx: number, ty: number, center: LatLng, radius: number): Line[] {
  const L = vt.layers[layer];
  if (!L) return [];
  const ext = L.extent;
  const toLatLng = projector(tx, ty, ext);
  const out: Line[] = [];
  for (let i = 0; i < L.length; i++) {
    const f = L.feature(i);
    if (f.type !== 2) continue; // только линии
    const props = f.properties as Record<string, unknown>;
    const kind = layer === 'transportation' ? walkKind(props) : 'road';
    if (!kind) continue;
    const name = nameOf(props);
    for (const part of f.loadGeometry()) {
      let run: LatLng[] | null = null;
      for (let k = 0; k < part.length - 1; k++) {
        const mx = (part[k].x + part[k + 1].x) / 2;
        const my = (part[k].y + part[k + 1].y) / 2;
        const a = toLatLng(part[k].x, part[k].y);
        const b = toLatLng(part[k + 1].x, part[k + 1].y);
        const inside = mx >= 0 && mx < ext && my >= 0 && my < ext && distance(center, midpoint(a, b)) <= radius;
        if (!inside) {
          run = null;
          continue;
        }
        if (!run) {
          run = [a];
          out.push({ pts: run, name, kind });
        }
        run.push(b);
      }
    }
  }
  return out;
}

/** Обрезка многоугольника по квадрату тайла (Сазерленд — Ходжмен) — куски соседних тайлов стыкуются без нахлёста. */
function clipToTile(ring: Pt[], ext: number): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p.x >= 0, (a, b) => ({ x: 0, y: a.y + ((b.y - a.y) * (0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= ext, (a, b) => ({ x: ext, y: a.y + ((b.y - a.y) * (ext - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= 0, (a, b) => ({ x: a.x + ((b.x - a.x) * (0 - a.y)) / (b.y - a.y), y: 0 })],
    [(p) => p.y <= ext, (a, b) => ({ x: a.x + ((b.x - a.x) * (ext - a.y)) / (b.y - a.y), y: ext })],
  ];
  let out = ring;
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cross(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}

/** Контуры парков из слоя landcover (в OpenMapTiles городские парки лежат там, без названий). */
function readParkPieces(vt: VectorTile, tx: number, ty: number, center: LatLng, radius: number): LatLng[][] {
  const L = vt.layers.landcover;
  if (!L) return [];
  const ext = L.extent;
  const toLatLng = projector(tx, ty, ext);
  const out: LatLng[][] = [];
  for (let i = 0; i < L.length; i++) {
    const f = L.feature(i);
    if (f.type !== 3 || f.properties.subclass !== 'park') continue;
    // classifyRings делит кольца на многоугольники [внешнее, ...дыры]; дыры не используем
    for (const [ring] of classifyRings(f.loadGeometry())) {
      const clipped = clipToTile(ring, ext);
      if (clipped.length < 3) continue;
      const geo = clipped.map((p) => toLatLng(p.x, p.y));
      if (distance(center, ringCenter(geo)) > radius + 500) continue;
      out.push(geo.map((p) => ({ latitude: +p.latitude.toFixed(6), longitude: +p.longitude.toFixed(6) })));
    }
  }
  return out;
}

function readPois(vt: VectorTile, tx: number, ty: number, center: LatLng, radius: number): RawPoi[] {
  const L = vt.layers.poi;
  if (!L) return [];
  const ext = L.extent;
  const toLatLng = projector(tx, ty, ext);
  const out: RawPoi[] = [];
  for (let i = 0; i < L.length; i++) {
    const f = L.feature(i);
    if (f.type !== 1) continue;
    const p = f.properties as Record<string, unknown>;
    const name = nameOf(p);
    const cls = String(p.class ?? '');
    if (!name || POI_SKIP.has(cls)) continue;
    const g = f.loadGeometry()[0]?.[0];
    if (!g || g.x < 0 || g.x >= ext || g.y < 0 || g.y >= ext) continue;
    const ll = toLatLng(g.x, g.y);
    // Точки парков берём и чуть дальше района — по ним называем парки на краю
    const isPark = cls === 'park' || p.subclass === 'park' || p.subclass === 'garden';
    if (distance(center, ll) > radius + (isPark ? 1500 : 0)) continue;
    out.push([name, cls, String(p.subclass ?? ''), +ll.latitude.toFixed(6), +ll.longitude.toFixed(6)]);
  }
  return out;
}

async function fetchTile(url: string): Promise<VectorTile> {
  const res = await fetchWithTimeout(url, {}, 20000);
  if (!res.ok) throw new Error(`Тайл ${res.status}`);
  return new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
}

const bbox = (ring: LatLng[]) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; // prettier-ignore
  for (const p of ring) {
    a = Math.min(a, p.latitude);
    b = Math.min(b, p.longitude);
    c = Math.max(c, p.latitude);
    d = Math.max(d, p.longitude);
  }
  return { minLat: a, minLon: b, maxLat: c, maxLon: d };
};

/** Склеиваем куски одного парка из соседних тайлов: куски, которые касаются друг друга. */
function groupPieces(pieces: LatLng[][]): LatLng[][][] {
  const boxes = pieces.map(bbox);
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const EPS = 0.00003; // ~3 м
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) {
      const A = boxes[i];
      const B = boxes[j];
      if (A.maxLat + EPS < B.minLat || B.maxLat + EPS < A.minLat || A.maxLon + EPS < B.minLon || B.maxLon + EPS < A.minLon) continue;
      // Касаются ли контуры: есть ли вершина одного рядом с ребром другого
      const touch = pieces[i].some((p) =>
        pieces[j].some((q, k) => distanceToSegment(p, q, pieces[j][(k + 1) % pieces[j].length]) < 4),
      );
      if (touch) parent[find(i)] = find(j);
    }
  const groups = new Map<number, LatLng[][]>();
  pieces.forEach((p, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(p));
  return [...groups.values()];
}

/** Скачивает улицы, парки и места вокруг точки. */
export async function fetchRawArea(center: LatLng, radius = AREA_RADIUS): Promise<RawArea> {
  const template = await tileUrl();
  const n = 2 ** Z;
  const dLat = radius / 111320;
  const dLon = radius / (111320 * Math.cos((center.latitude * Math.PI) / 180));
  const x0 = Math.floor(lonToX(center.longitude - dLon, n));
  const x1 = Math.floor(lonToX(center.longitude + dLon, n));
  const y0 = Math.floor(latToY(center.latitude + dLat, n));
  const y1 = Math.floor(latToY(center.latitude - dLat, n));

  const jobs: Promise<{ roads: Line[]; names: Line[]; parks: LatLng[][]; pois: RawPoi[] }>[] = [];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      const url = template.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y));
      jobs.push(
        fetchTile(url).then((vt) => ({
          roads: readLines(vt, 'transportation', x, y, center, radius),
          names: readLines(vt, 'transportation_name', x, y, center, radius),
          parks: readParkPieces(vt, x, y, center, radius),
          pois: readPois(vt, x, y, center, radius),
        })),
      );
    }
  const tiles = await Promise.all(jobs);
  const allPois = tiles.flatMap((t) => t.pois);

  // Парки: склеиваем куски, отбрасываем мелкие, название берём у точки «парк» внутри контура
  const parks: RawPark[] = [];
  const parkPois = allPois.filter((p) => p[1] === 'park' || p[2] === 'park' || p[2] === 'garden');
  const pois = allPois.filter((p) => distance(center, { latitude: p[3], longitude: p[4] }) <= radius);
  for (const group of groupPieces(tiles.flatMap((t) => t.parks))) {
    const area = group.reduce((s, r) => s + ringArea(r), 0);
    if (area < MIN_PARK_M2) continue;
    const named = parkPois.find((p) => group.some((r) => pointInRing({ latitude: p[3], longitude: p[4] }, r)));
    parks.push({
      id: parks.length + 1,
      name: named?.[0] ?? null,
      pieces: group.map((r) => r.flatMap((p) => [p.latitude, p.longitude])),
    });
  }
  const parkRings = parks.map((p) => ({ id: p.id, rings: p.pieces.map(unpack), box: bbox(p.pieces.flatMap(unpack)) }));
  const parkAt = (p: LatLng): number | undefined =>
    parkRings.find(
      (pr) =>
        p.latitude >= pr.box.minLat &&
        p.latitude <= pr.box.maxLat &&
        p.longitude >= pr.box.minLon &&
        p.longitude <= pr.box.maxLon &&
        pr.rings.some((r) => pointInRing(p, r)),
    )?.id;

  // Названия улиц лежат в отдельном слое — привязываем их к улицам по близости.
  const nameSegs: { a: LatLng; b: LatLng; name: string }[] = [];
  for (const t of tiles)
    for (const l of t.names)
      if (l.name) for (let k = 0; k < l.pts.length - 1; k++) nameSegs.push({ a: l.pts[k], b: l.pts[k + 1], name: l.name });
  const CELL = 0.002;
  const grid = new Map<string, typeof nameSegs>();
  for (const s of nameSegs) {
    const m = midpoint(s.a, s.b);
    const key = `${Math.floor(m.longitude / CELL)},${Math.floor(m.latitude / CELL)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(s);
  }
  const nameAt = (p: LatLng): string | null => {
    const cx = Math.floor(p.longitude / CELL);
    const cy = Math.floor(p.latitude / CELL);
    let best: string | null = null;
    let bestD = NAME_RADIUS;
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (const s of grid.get(`${x},${y}`) ?? []) {
          const d = distanceToSegment(p, s.a, s.b);
          if (d < bestD) {
            bestD = d;
            best = s.name;
          }
        }
    return best;
  };

  const ways: RawWay[] = [];
  let id = 1;
  for (const t of tiles)
    for (const l of t.roads) {
      const mid = l.pts[Math.floor(l.pts.length / 2)];
      const park = parkAt(mid);
      if (l.kind === 'parkPath' && !park) continue; // тротуар вне парка
      const coords: number[] = [];
      for (const p of l.pts) coords.push(+p.latitude.toFixed(6), +p.longitude.toFixed(6));
      ways.push({ id: id++, name: l.name ?? nameAt(mid), coords, ...(park ? { park } : {}) });
    }
  return { center, radius, loadedAt: Date.now(), ways, parks, pois };
}

function unpack(c: number[]): LatLng[] {
  const pts: LatLng[] = [];
  for (let i = 0; i < c.length; i += 2) pts.push({ latitude: c[i], longitude: c[i + 1] });
  return pts;
}

/** Режет улицы на короткие отрезки. Детерминированно — id отрезков не меняются между запусками. */
export function buildArea(raw: RawArea): Area {
  const streets: Street[] = [];
  const segments: Segment[] = [];
  const seen = new Set<string>();
  const parkSegs = new Map<number, string[]>();

  for (const w of raw.ways) {
    const pts = unpack(w.coords);
    const ids: string[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const len = distance(p, q);
      const parts = Math.max(1, Math.ceil(len / MAX_SEGMENT));
      for (let k = 0; k < parts; k++) {
        const a = lerp(p, q, k / parts);
        const b = lerp(p, q, (k + 1) / parts);
        const m = midpoint(a, b);
        // id по середине отрезка с точностью ~1 м: переживает перезагрузку района
        const id = `${Math.round(m.latitude * 1e5)}_${Math.round(m.longitude * 1e5)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        segments.push({ id, wayId: w.id, a, b, length: len / parts });
        ids.push(id);
      }
    }
    if (!ids.length) continue;
    streets.push({ wayId: w.id, name: w.name, segmentIds: ids, parkId: w.park ?? null });
    if (w.park) (parkSegs.get(w.park) ?? parkSegs.set(w.park, []).get(w.park)!).push(...ids);
  }

  const parks: Park[] = (raw.parks ?? []).map((p) => {
    const pieces = p.pieces.map(unpack);
    const areaM2 = pieces.reduce((s, r) => s + ringArea(r), 0);
    // Центр — центр самого большого куска
    const biggest = pieces.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a));
    const c = ringCenter(biggest);
    const key = c.latitude.toFixed(4) + ',' + c.longitude.toFixed(4);
    return { id: p.id, key, name: p.name, pieces, center: c, areaM2, segmentIds: parkSegs.get(p.id) ?? [] };
  });

  const pois: Poi[] = (raw.pois ?? []).map(([name, cls, sub, lat, lon]) => ({ name, cls, sub, p: { latitude: lat, longitude: lon } }));

  return { center: raw.center, radius: raw.radius, loadedAt: raw.loadedAt, streets, segments, parks, pois };
}

/** В каком парке точка (null — не в парке). */
export function parkAtPoint(area: Area, p: LatLng): Park | null {
  return area.parks.find((pk) => pk.pieces.some((r) => pointInRing(p, r))) ?? null;
}
