import { distance, distanceToSegment, LatLng } from '../utils/geo';
import { Area, parkAtPoint, Poi } from './osm';
import { QuestOption } from './quest';

/** Подписи для классов мест из OpenStreetMap. */
const LABELS: Record<string, string> = {
  cafe: 'кафе',
  restaurant: 'ресторан',
  fast_food: 'фастфуд',
  bar: 'бар',
  beer: 'бар',
  ice_cream: 'мороженое',
  bakery: 'пекарня',
  shop: 'магазин',
  grocery: 'продукты',
  clothing_store: 'одежда',
  alcohol_shop: 'магазин',
  florist: 'цветы',
  attraction: 'достопримечательность',
  museum: 'музей',
  art_gallery: 'галерея',
  theatre: 'театр',
  cinema: 'кинотеатр',
  place_of_worship: 'храм',
  monument: 'памятник',
  castle: 'замок',
  library: 'библиотека',
  park: 'парк',
  playground: 'детская площадка',
  information: 'инфо',
  lodging: 'гостиница',
  pharmacy: 'аптека',
  bank: 'банк',
  office: 'офис',
  school: 'школа',
  college: 'колледж',
  hospital: 'медицина',
  post: 'почта',
  town_hall: 'учреждение',
  sports: 'спорт',
  stadium: 'стадион',
  zoo: 'зоопарк',
  veterinary: 'ветклиника',
  hairdresser: 'парикмахерская',
  beauty: 'салон красоты',
  convenience: 'магазин у дома',
  supermarket: 'супермаркет',
  books: 'книги',
  kindergarten: 'детский сад',
  dentist: 'стоматология',
  clinic: 'клиника',
  laundry: 'прачечная',
  fitness: 'фитнес',
  swimming: 'бассейн',
  community_centre: 'дом культуры',
  arts_centre: 'арт-центр',
  fountain: 'фонтан',
  memorial: 'мемориал',
  artwork: 'арт-объект',
  viewpoint: 'смотровая площадка',
};

export function poiLabel(p: Poi): string {
  // Сначала уточнённый тип (subclass), потом общий; незнакомое — просто «место»
  return LABELS[p.sub] ?? LABELS[p.cls] ?? 'место';
}

/** Какие места подходят под слова в задании — их подсвечиваем. */
const TASK_HINTS: { re: RegExp; cls: string[] }[] = [
  { re: /кафе|магазин|вывеск/i, cls: ['cafe', 'restaurant', 'fast_food', 'bar', 'bakery', 'ice_cream', 'shop', 'grocery', 'clothing_store', 'florist', 'alcohol_shop'] },
  { re: /старое здание|деталь дома|лепнин|кладк/i, cls: ['attraction', 'museum', 'place_of_worship', 'monument', 'castle', 'theatre', 'town_hall', 'library'] },
  { re: /скульптур|памятник|беседк|фонтан|пруд|вод/i, cls: ['attraction', 'monument', 'park'] },
  { re: /надпись|рисунок|граффити/i, cls: ['art_gallery', 'attraction', 'museum'] },
  { re: /скамейк|вид/i, cls: ['park', 'attraction', 'playground'] },
];

export type NearbyPlace = { id: string; poi: Poi; label: string; dist: number; relevant: boolean };

const SEARCH_RADIUS = 250; // м от цели (для сложного — от любой точки улицы)

/** Места вокруг цели квеста: сначала подходящие под задание, потом ближайшие. */
export function placesNear(o: QuestOption, area: Area | null, limit = 10): NearbyPlace[] {
  if (!area) return [];
  const byId = new Map(area.segments.map((s) => [s.id, s]));
  const along = o.needCoverage > 0 ? o.segmentIds.map((id) => byId.get(id)).filter((s) => !!s) : [];
  const hint = TASK_HINTS.filter((h) => h.re.test(o.task)).flatMap((h) => h.cls);
  const distTo = (p: LatLng) => {
    if (!along.length) return distance(p, o.target);
    let best = Infinity;
    for (const s of along) best = Math.min(best, distanceToSegment(p, s!.a, s!.b));
    return best;
  };
  // В парковом квесте — только то, что внутри самого парка
  const inPark = (p: LatLng) => !o.parkKey || parkAtPoint(area, p)?.key === o.parkKey;
  return area.pois
    .map((poi) => ({ poi, dist: o.parkKey && inPark(poi.p) ? 0 : distTo(poi.p) }))
    .filter((x) => (o.parkKey ? inPark(x.poi.p) : x.dist <= SEARCH_RADIUS))
    .map((x) => ({
      id: `${x.poi.p.latitude},${x.poi.p.longitude},${x.poi.name}`,
      poi: x.poi,
      label: poiLabel(x.poi),
      dist: x.dist,
      relevant: hint.includes(x.poi.cls) || hint.includes(x.poi.sub),
    }))
    .sort((a, b) => Number(b.relevant) - Number(a.relevant) || a.dist - b.dist)
    .slice(0, limit);
}
