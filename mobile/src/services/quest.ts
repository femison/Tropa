import { distance, distanceToSegment, midpoint, LatLng } from '../utils/geo';
import { Area, Park, parkAtPoint, Segment } from './osm';
import { Condition, Weather } from './weather';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'park';

export const DIFFICULTY: Record<Difficulty, { label: string; emoji: string; points: number; hint: string }> = {
  easy: { label: 'Простой', emoji: '🟢', points: 30, hint: 'рядом, до 600 м' },
  medium: { label: 'Средний', emoji: '🟡', points: 60, hint: '600 м – 1,2 км' },
  hard: { label: 'Сложный', emoji: '🔴', points: 120, hint: 'пройти улицу целиком' },
  park: { label: 'В парке', emoji: '🌳', points: 50, hint: 'зайти в парк' },
};

/** Насколько близко к цели нужно сделать фото. */
export const QUEST_RADIUS = 60; // м
/** Сколько улицы нужно пройти в сложном квесте. */
export const HARD_COVERAGE = 0.7;
/** Сколько раз в день можно заменить задание, если на месте нет нужного. */
export const MAX_SWAPS = 2;

export type QuestOption = {
  difficulty: Difficulty;
  streetName: string | null;
  /** Отрезки целевой улицы — id геометрические, переживают перезагрузку района. */
  segmentIds: string[];
  streetLength: number; // м
  target: LatLng;
  task: string;
  /** Запасные задания для кнопки «Здесь такого нет». Первое выполнимо почти везде. */
  spareTasks: string[];
  points: number;
  /** Доля улицы, которую нужно пройти (0 — только дойти и сфотографировать). */
  needCoverage: number;
  /** Парковый квест: ключ парка — фото засчитывается в любом месте внутри него. */
  parkKey?: string;
};

export type Quest = {
  date: string; // YYYY-MM-DD, локальная дата
  short: boolean; // опасная погода — только короткий квест рядом
  doubled: boolean; // непогода — очки ×2
  weather: Pick<Weather, 'condition' | 'description' | 'emoji' | 'temperature' | 'severeReason'> | null;
  options: QuestOption[];
  chosen: Difficulty | null;
  swaps: number;
  completedAt: number | null;
  photoUri: string | null;
};

export function activeOption(q: Quest | null): QuestOption | null {
  if (!q || !q.chosen) return null;
  return q.options.find((o) => o.difficulty === q.chosen) ?? null;
}

export function todayKey(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Детерминированный ГПСЧ: один и тот же квест в течение дня. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// ——— Задания ———
// Формулировки нарочно общие («найди самое…», «что-нибудь…»), чтобы их можно было выполнить
// почти на любой улице. Конкретный предмет может не найтись — для этого есть замена задания.

/** Есть почти на любой улице — всегда идёт первым запасным заданием. */
const ALWAYS_POSSIBLE = 'Сфотографируй табличку с названием улицы или номером дома.';

const UNIVERSAL = [
  'Найди самую интересную дверь или подъезд и сфотографируй.',
  'Найди что-нибудь красное и сними это.',
  'Сфотографируй самое большое дерево поблизости.',
  'Найди окно, которое выделяется среди остальных.',
  'Сними вид вдоль улицы — так, чтобы было видно, куда она уходит.',
  'Найди надпись, рисунок или граффити на стене.',
  'Сфотографируй самый необычный балкон.',
  'Найди скамейку и сними вид, который с неё открывается.',
  'Сними деталь дома: кирпичную кладку, лепнину, наличник или старую вывеску.',
  'Найди фонарь и сфотографируй его так, чтобы было видно небо.',
  'Сфотографируй вывеску самого маленького магазина или кафе поблизости.',
  'Сними что-нибудь круглое.',
  'Найди самый яркий цвет на этой улице.',
  'Сфотографируй небо между домами.',
  'Найди люк, решётку или забор с узором.',
  'Сними то, чего ты раньше здесь никогда не замечал.',
  'Найди самое старое здание поблизости.',
  'Сфотографируй что-нибудь, что растёт не там, где должно.',
  'Найди номер дома с самой большой цифрой, которую увидишь.',
  'Сними улицу с необычного ракурса — снизу вверх.',
];

const BY_WEATHER: Record<Condition, string[]> = {
  clear: [
    'Сфотографируй самую длинную тень.',
    'Найди солнечный блик в окне или витрине.',
    'Сними место, где тень и солнце делят улицу пополам.',
  ],
  cloudy: [
    'Сфотографируй облако необычной формы над улицей.',
    'Найди самое уютное окно в пасмурный день.',
  ],
  fog: [
    'Сфотографируй, как туман прячет конец улицы.',
    'Найди силуэт дома или дерева в тумане.',
  ],
  rain: [
    'Найди отражение в луже и сфотографируй его.',
    'Сними капли на стекле, листе или перилах.',
    'Найди самый яркий зонт или навес.',
  ],
  snow: [
    'Найди самые интересные следы на снегу.',
    'Сфотографируй снежную шапку на необычном предмете.',
    'Найди сосульку, сугроб или снеговика.',
  ],
  storm: [],
};

const PARK_TASKS = [
  'Найди самое большое или самое старое дерево в парке.',
  'Сфотографируй скамейку, с которой открывается лучший вид.',
  'Сними аллею так, чтобы она уходила вдаль.',
  'Найди птицу, белку или следы животных (только издалека!).',
  'Найди дерево с необычной корой или изогнутым стволом.',
  'Сфотографируй воду в парке: пруд, фонтан, ручей или хотя бы лужу.',
  'Найди скульптуру, беседку, фонарь или табличку с названием парка.',
  'Сними листья, ветки или цветы трёх разных цветов.',
  'Найди самое тихое место в парке и сфотографируй его.',
  'Сфотографируй небо сквозь кроны деревьев.',
];

const PARK_BY_WEATHER: Partial<Record<Condition, string[]>> = {
  snow: ['Найди в парке самую ровную снежную поляну или следы лыж.', 'Сфотографируй ёлку или куст под снегом.'],
  rain: ['Найди в парке капли на листьях или паутине.', 'Сфотографируй отражение деревьев в луже.'],
  fog: ['Сфотографируй, как туман прячет деревья в парке.'],
  clear: ['Найди в парке солнечные лучи сквозь листву.'],
};

const HARD_TASKS = [
  'Пройди улицу от начала до конца и сфотографируй самое интересное место на ней.',
  'Пройди улицу и сними место, которое понравилось больше всего.',
  'Пройди улицу целиком и сфотографируй, чем она заканчивается.',
];

function pickTasks(rnd: () => number, difficulty: Difficulty, cond: Condition): { task: string; spare: string[] } {
  const weather = BY_WEATHER[cond] ?? [];
  let pool: string[];
  const parkWeather = PARK_BY_WEATHER[cond] ?? [];
  if (difficulty === 'hard') pool = HARD_TASKS;
  else if (difficulty === 'park') pool = parkWeather.length && rnd() < 0.4 ? parkWeather : PARK_TASKS;
  else pool = weather.length && rnd() < 0.5 ? weather : UNIVERSAL;
  const task = pool[Math.floor(rnd() * pool.length)];
  const rest = (difficulty === 'park' ? [...parkWeather, ...PARK_TASKS] : [...weather, ...UNIVERSAL]).filter((t) => t !== task);
  // В парке «всегда выполнимое» — самое большое дерево, в городе — табличка с адресом
  const sure = difficulty === 'park' ? PARK_TASKS[0] : ALWAYS_POSSIBLE;
  if (sure !== task) rest.splice(rest.indexOf(sure) >>> 0, rest.includes(sure) ? 1 : 0);
  const spare = sure === task ? [] : [sure];
  while (spare.length <= MAX_SWAPS && rest.length) spare.push(rest.splice(Math.floor(rnd() * rest.length), 1)[0]);
  return { task, spare };
}

// ——— Выбор места ———

type StreetInfo = { name: string | null; segs: Segment[]; length: number; uncovered: number; mid: LatLng };

function streetInfos(area: Area, covered: Set<string>): StreetInfo[] {
  const byId = new Map(area.segments.map((s) => [s.id, s]));
  return area.streets.map((st) => {
    const segs = st.segmentIds.map((id) => byId.get(id)!).filter(Boolean);
    let length = 0;
    let unc = 0;
    for (const s of segs) {
      length += s.length;
      if (!covered.has(s.id)) unc += s.length;
    }
    const m = segs[Math.floor(segs.length / 2)];
    return { name: st.name, segs, length, uncovered: length ? unc / length : 0, mid: midpoint(m.a, m.b) };
  });
}

function makeOption(
  d: Difficulty,
  st: StreetInfo,
  target: LatLng,
  rnd: () => number,
  cond: Condition,
  doubled: boolean,
): QuestOption {
  const { task, spare } = pickTasks(rnd, d, cond);
  return {
    difficulty: d,
    streetName: st.name,
    segmentIds: st.segs.map((s) => s.id),
    streetLength: st.length,
    target,
    task,
    spareTasks: spare,
    points: DIFFICULTY[d].points * (doubled ? 2 : 1),
    needCoverage: d === 'hard' ? HARD_COVERAGE : 0,
  };
}

/** Простой/средний: точка на серой улице в заданном кольце расстояний. */
function pickPoint(
  infos: StreetInfo[],
  covered: Set<string>,
  here: LatLng,
  [minR, maxR]: [number, number],
  used: Set<StreetInfo>,
  rnd: () => number,
  allowCovered: boolean,
): { st: StreetInfo; target: LatLng } | null {
  const named: { st: StreetInfo; target: LatLng }[] = [];
  const any: { st: StreetInfo; target: LatLng }[] = [];
  for (const st of infos) {
    if (used.has(st)) continue;
    const gray = st.uncovered > 2 / 3;
    if (!gray && !allowCovered) continue;
    for (const s of st.segs) {
      if (covered.has(s.id) && !allowCovered) continue;
      const p = midpoint(s.a, s.b);
      const d = distance(here, p);
      if (d < minR || d > maxR) continue;
      (st.name ? named : any).push({ st, target: p });
    }
  }
  const pool = named.length ? named : any;
  return pool.length ? pool[Math.floor(rnd() * pool.length)] : null;
}

/** Сложный: серая улица длиной от 250 м — её нужно пройти почти целиком. */
function pickStreet(infos: StreetInfo[], here: LatLng, used: Set<StreetInfo>, rnd: () => number) {
  // В тайлах улица приходит кусками — склеиваем куски с одним названием в целую улицу
  const usedNames = new Set([...used].map((u) => u.name).filter(Boolean));
  const byName = new Map<string, StreetInfo[]>();
  const unnamed: StreetInfo[] = [];
  for (const st of infos) {
    if (used.has(st)) continue;
    if (!st.name) unnamed.push(st);
    else if (!usedNames.has(st.name)) (byName.get(st.name) ?? byName.set(st.name, []).get(st.name)!).push(st);
  }
  const merged: StreetInfo[] = [...unnamed];
  for (const [name, parts] of byName) {
    const segs = parts.flatMap((p) => p.segs);
    const length = parts.reduce((s, p) => s + p.length, 0);
    const uncovered = parts.reduce((s, p) => s + p.uncovered * p.length, 0) / (length || 1);
    const m = segs[Math.floor(segs.length / 2)];
    merged.push({ name, segs, length, uncovered, mid: midpoint(m.a, m.b) });
  }
  const pool = merged.filter((st) => {
    if (st.length < 250 || st.length > 1800 || st.uncovered < 0.8) return false;
    const d = distance(here, st.mid);
    return d >= 200 && d <= 1200;
  });
  const named = pool.filter((st) => st.name);
  const list = named.length ? named : pool;
  if (!list.length) return null;
  const st = list[Math.floor(rnd() * list.length)];
  // Метка — ближайшая к вам точка улицы: оттуда удобно начинать
  let target = st.segs[0].a;
  for (const s of st.segs) if (distance(here, s.a) < distance(here, target)) target = s.a;
  return { st, target };
}

/**
 * Квест дня: три варианта на выбор — простой, средний, сложный.
 * Все ведут в серую (непройденную) часть карты. В опасную погоду — только простой и рядом.
 */
export function generateQuest(
  area: Area,
  covered: Set<string>,
  here: LatLng,
  weather: Weather | null,
  date = todayKey(),
): Quest | null {
  const rnd = seeded(date + ':' + area.center.latitude.toFixed(3) + area.center.longitude.toFixed(3));
  const short = weather?.isSevere ?? false;
  const doubled = weather?.isBad ?? false;
  const cond = weather?.condition ?? 'cloudy';
  const infos = streetInfos(area, covered);
  const used = new Set<StreetInfo>();
  const options: QuestOption[] = [];

  const easy =
    pickPoint(infos, covered, here, short ? [0, 300] : [150, 600], used, rnd, false) ??
    pickPoint(infos, covered, here, short ? [0, 400] : [0, 800], used, rnd, short);
  if (easy) {
    used.add(easy.st);
    options.push(makeOption('easy', easy.st, easy.target, rnd, short ? 'cloudy' : cond, doubled));
  }
  if (!short) {
    const medium = pickPoint(infos, covered, here, [600, 1200], used, rnd, false);
    if (medium) {
      used.add(medium.st);
      options.push(makeOption('medium', medium.st, medium.target, rnd, cond, doubled));
    }
    const hard = pickStreet(infos, here, used, rnd);
    if (hard) options.push(makeOption('hard', hard.st, hard.target, rnd, cond, doubled));
    const pk = pickPark(area, covered, here, rnd);
    if (pk) {
      const { task, spare } = pickTasks(rnd, 'park', cond);
      options.push({
        difficulty: 'park',
        streetName: pk.park.name ?? 'Парк без названия',
        segmentIds: pk.park.segmentIds,
        streetLength: 0,
        target: pk.target,
        task,
        spareTasks: spare,
        points: DIFFICULTY.park.points * (doubled ? 2 : 1),
        needCoverage: 0,
        parkKey: pk.park.key,
      });
    }
  }
  if (!options.length) return null;

  return {
    date,
    short,
    doubled,
    weather: weather
      ? {
          condition: weather.condition,
          description: weather.description,
          emoji: weather.emoji,
          temperature: weather.temperature,
          severeReason: weather.severeReason,
        }
      : null,
    options,
    chosen: null,
    swaps: 0,
    completedAt: null,
    photoUri: null,
  };
}

/** Парк для паркового квеста: в пределах 1,5 км, ещё не пройденный, крупные и с названием — в приоритете. */
function pickPark(area: Area, covered: Set<string>, here: LatLng, rnd: () => number): { park: Park; target: LatLng } | null {
  const byId = new Map(area.segments.map((s) => [s.id, s]));
  const scored = area.parks
    .map((park) => {
      let total = 0;
      let done = 0;
      let entry: LatLng | null = null;
      let entryD = Infinity;
      for (const id of park.segmentIds) {
        const s = byId.get(id);
        if (!s) continue;
        total += s.length;
        if (covered.has(id)) done += s.length;
        const d = distance(here, s.a);
        if (d < entryD) {
          entryD = d;
          entry = s.a;
        }
      }
      // Метка — ближайшая к вам дорожка парка, а если дорожек нет — центр
      const target = entry ?? park.center;
      const d = distance(here, target);
      const fresh = total ? 1 - done / total : 1;
      return { park, target, d, score: fresh * Math.log10(park.areaM2) + (park.name ? 1 : 0) + rnd() };
    })
    .filter((x) => x.d <= 1500 && x.park.areaM2 >= 8000 && x.score > 1);
  scored.sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

/** Доля целевой улицы, которую вы уже прошли (по длине). */
export function streetCoverage(o: QuestOption, area: Area | null, covered: Set<string>): number {
  if (!area) return 0;
  const byId = new Map(area.segments.map((s) => [s.id, s]));
  let total = 0;
  let done = 0;
  for (const id of o.segmentIds) {
    const s = byId.get(id);
    if (!s) continue;
    total += s.length;
    if (covered.has(id)) done += s.length;
  }
  return total ? done / total : 0;
}

/** Расстояние от точки до цели: для сложного — до любой точки улицы. */
export function distanceToQuest(o: QuestOption, p: LatLng, area: Area | null): number {
  if (o.parkKey && area) {
    const inPark = parkAtPoint(area, p);
    if (inPark?.key === o.parkKey) return 0; // в любом месте парка
  }
  if (o.needCoverage > 0 && area) {
    const byId = new Map(area.segments.map((s) => [s.id, s]));
    let best = Infinity;
    for (const id of o.segmentIds) {
      const s = byId.get(id);
      if (s) best = Math.min(best, distanceToSegment(p, s.a, s.b));
    }
    if (best < Infinity) return best;
  }
  return distance(p, o.target);
}
