import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  drainWalkQueue,
  isBackgroundWalkRunning,
  onWalkPoints,
  startBackgroundWalk,
  stopBackgroundWalk,
} from '../services/backgroundWalk';
import { SegmentIndex, matchStep } from '../services/matching';
import { Area, buildArea, fetchRawArea, AREA_RADIUS, parkAtPoint } from '../services/osm';
import {
  activeOption,
  Difficulty,
  distanceToQuest,
  generateQuest,
  MAX_SWAPS,
  Quest,
  QUEST_RADIUS,
  streetCoverage,
  todayKey,
} from '../services/quest';
import { ensureLocationPermission, getHere, watchWalk } from '../services/tracker';
import { QuestRecord, WalkRecord } from '../services/stats';
import { fetchWeather, Weather } from '../services/weather';
import { distance, LatLng } from '../utils/geo';
import { makeThumbnail, savePhotoToAlbum } from '../services/photos';
import { storage } from './storage';

const WEATHER_TTL = 30 * 60 * 1000;

type Walk = {
  track: LatLng[];
  newSegments: number;
  meters: number;
  points: number;
  startedAt: number;
  percentBefore: number;
  /** Запись идёт в фоне (уведомление в шторке, работает при выключенном экране). */
  background: boolean;
};

export type ParkStat = { percent: number; visited: boolean; captured: boolean };
/** Парк «захвачен», когда пройдено столько его дорожек. */
export const PARK_CAPTURE = 0.8;

type Progress = {
  ready: boolean;
  status: string | null; // что сейчас происходит / последняя ошибка
  here: LatLng | null;
  area: Area | null;
  covered: Set<string>;
  percent: number;
  /** Прогресс по паркам: ключ парка → доля пройденных дорожек и статус «захвачен». */
  parkStats: Map<string, ParkStat>;
  points: number;
  weather: Weather | null;
  quest: Quest | null;
  walk: Walk | null;
  walks: WalkRecord[];
  questHistory: QuestRecord[];
  /** Итоги только что завершённой прогулки — для карточки-сводки. */
  lastSummary: WalkRecord | null;
  dismissSummary: () => void;
  startWalk: () => Promise<void>;
  stopWalk: () => Promise<void>;
  /** Ручная точка трека — для проверки на эмуляторе (долгое нажатие на карту). */
  addSimulatedPoint: (p: LatLng) => void;
  reloadArea: () => Promise<void>;
  completeQuest: (photoUri: string) => Promise<{ ok: boolean; message: string }>;
  /** Выбрать сложность квеста дня (null — вернуться к выбору). */
  chooseQuest: (d: Difficulty | null) => void;
  /** Заменить задание, если на месте нет нужного. false — замены закончились. */
  swapQuestTask: () => boolean;
  resetAll: () => Promise<void>;
};

const Ctx = createContext<Progress | null>(null);

export function useProgress() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProgress вне ProgressProvider');
  return v;
}

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<string | null>('Определяем, где вы…');
  const [here, setHere] = useState<LatLng | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [covered, setCovered] = useState<Set<string>>(new Set());
  const [points, setPoints] = useState(0);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [quest, setQuest] = useState<Quest | null>(null);
  const [walk, setWalk] = useState<Walk | null>(null);
  const [walks, setWalks] = useState<WalkRecord[]>([]);
  const [questHistory, setQuestHistory] = useState<QuestRecord[]>([]);
  const [lastSummary, setLastSummary] = useState<WalkRecord | null>(null);

  const index = useMemo(() => (area ? new SegmentIndex(area.segments) : null), [area]);

  // Рефы — чтобы колбэк GPS всегда видел свежие данные.
  const indexRef = useRef(index);
  const areaRef = useRef(area);
  const [visitedParks, setVisitedParks] = useState<Set<string>>(new Set());
  const visitedParksRef = useRef(visitedParks);
  const coveredRef = useRef(covered);
  const pointsRef = useRef(points);
  const weatherRef = useRef(weather);
  const lastPointRef = useRef<LatLng | null>(null);
  const walkRef = useRef<Walk | null>(null);
  const percentRef = useRef(0);
  const walksRef = useRef<WalkRecord[]>([]);
  const stopWatchRef = useRef<(() => void) | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  indexRef.current = index;
  areaRef.current = area;
  visitedParksRef.current = visitedParks;
  coveredRef.current = covered;
  pointsRef.current = points;
  weatherRef.current = weather;
  walkRef.current = walk;
  walksRef.current = walks;

  const percent = useMemo(() => {
    if (!area || !area.segments.length) return 0;
    let total = 0;
    let done = 0;
    for (const s of area.segments) {
      total += s.length;
      if (covered.has(s.id)) done += s.length;
    }
    return (done / total) * 100;
  }, [area, covered]);
  percentRef.current = percent;

  const parkStats = useMemo(() => {
    const out = new Map<string, ParkStat>();
    if (!area) return out;
    const byId = new Map(area.segments.map((s) => [s.id, s]));
    for (const pk of area.parks) {
      let total = 0;
      let done = 0;
      for (const id of pk.segmentIds) {
        const s = byId.get(id);
        if (!s) continue;
        total += s.length;
        if (covered.has(id)) done += s.length;
      }
      const visited = visitedParks.has(pk.key);
      // В сквере без дорожек достаточно побывать
      const p = total > 0 ? done / total : visited ? 1 : 0;
      out.set(pk.key, { percent: p, visited, captured: p >= PARK_CAPTURE });
    }
    return out;
  }, [area, covered, visitedParks]);

  const loadAreaFor = useCallback(async (p: LatLng, force: boolean) => {
    const cached = force ? null : await storage.loadArea();
    if (cached && distance(cached.center, p) < cached.radius * 0.5) {
      setArea(buildArea(cached));
      return;
    }
    setStatus('Загружаем улицы из OpenStreetMap…');
    const raw = await fetchRawArea(p, AREA_RADIUS);
    await storage.saveArea(raw);
    setArea(buildArea(raw));
  }, []);

  const loadWeatherFor = useCallback(async (p: LatLng) => {
    const cached = await storage.loadWeather();
    if (cached && Date.now() - cached.fetchedAt < WEATHER_TTL) {
      setWeather(cached);
      return cached;
    }
    try {
      const w = await fetchWeather(p);
      await storage.saveWeather(w);
      setWeather(w);
      return w;
    } catch (e) {
      console.warn('Погода не загрузилась:', String((e as Error)?.message ?? e));
      setWeather(cached);
      return cached;
    }
  }, []);

  // Старт: сохранённый прогресс → геолокация → район → погода.
  useEffect(() => {
    (async () => {
      setCovered(await storage.loadCovered());
      setPoints(await storage.loadPoints());
      setQuest(await storage.loadQuest());
      setWalks(await storage.loadWalks());
      setQuestHistory(await storage.loadQuestHistory());
      setVisitedParks(await storage.loadVisitedParks());
      if (!(await ensureLocationPermission())) {
        setStatus('Нет доступа к геолокации. Разрешите его в настройках телефона.');
        return;
      }
      try {
        const p = await getHere();
        setHere(p);
        // Погода грузится параллельно и не держит надпись про улицы
        const weatherDone = loadWeatherFor(p);
        try {
          await loadAreaFor(p, false);
          setStatus(null);
        } catch (e) {
          setStatus('Не удалось загрузить улицы: ' + String((e as Error).message ?? e) + '. Нажмите ⟳.');
        }
        await weatherDone; // квест создаётся после погоды; при ошибке погоды — без неё
      } catch (e) {
        setStatus('Не удалось определить положение: ' + String((e as Error).message ?? e));
      } finally {
        setReady(true);
      }
    })();
  }, [loadAreaFor, loadWeatherFor]);

  // Квест дня: один на дату, создаётся, когда есть район и положение.
  useEffect(() => {
    if (!ready || !area || !here) return; // ждём и погоду, чтобы квест учитывал её
    if (quest && quest.date === todayKey()) return;
    const q = generateQuest(area, covered, here, weather);
    if (q) {
      setQuest(q);
      storage.saveQuest(q);
    }
    // covered нарочно не в зависимостях: квест не должен меняться от каждого шага
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, area, here, weather, quest]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) return;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      storage.saveCovered(coveredRef.current);
      storage.savePoints(pointsRef.current);
      const w = walkRef.current;
      if (w) storage.saveActiveWalk({ ...w, track: w.track.slice(-2000) });
    }, 4000);
  }, []);

  /** Обработать пачку точек трека разом: закрасить улицы, отметить парки, посчитать метры и очки. */
  const processPoints = useCallback(
    (pts: LatLng[]) => {
      if (!pts.length) return;
      const idx = indexRef.current;
      const ar = areaRef.current;
      let parks = visitedParksRef.current;
      let cov = coveredRef.current;
      let prev = lastPointRef.current;
      let added = 0;
      let meters = 0;
      for (const p of pts) {
        const pk = ar ? parkAtPoint(ar, p) : null;
        if (pk && !parks.has(pk.key)) parks = new Set(parks).add(pk.key);
        if (prev) {
          const step = distance(prev, p);
          if (step < 120) meters += step; // больше — скачок GPS или пропуск, не считаем
        }
        if (idx) {
          for (const id of matchStep(idx, prev, p)) {
            if (cov.has(id)) continue;
            if (cov === coveredRef.current) cov = new Set(cov);
            cov.add(id);
            added++;
          }
        }
        prev = p;
      }
      lastPointRef.current = prev;
      setHere(prev);
      if (parks !== visitedParksRef.current) {
        visitedParksRef.current = parks;
        setVisitedParks(parks);
        storage.saveVisitedParks(parks);
      }
      const gained = added * (weatherRef.current?.isBad ? 2 : 1);
      if (added) {
        coveredRef.current = cov;
        setCovered(cov);
        pointsRef.current += gained;
        setPoints(pointsRef.current);
      }
      const w = walkRef.current;
      if (w) {
        const next: Walk = {
          ...w,
          track: [...w.track, ...pts],
          newSegments: w.newSegments + added,
          points: w.points + gained,
          meters: w.meters + meters,
        };
        walkRef.current = next;
        setWalk(next);
      }
      scheduleSave();
    },
    [scheduleSave],
  );

  /** Забрать точки, которые фоновая запись накопила (в т. ч. пока экран был выключен). */
  const draining = useRef(false);
  const drain = useCallback(async () => {
    if (draining.current || !walkRef.current || !indexRef.current) return;
    draining.current = true;
    try {
      const q = await drainWalkQueue();
      processPoints(q.map(([latitude, longitude]) => ({ latitude, longitude })));
    } finally {
      draining.current = false;
    }
  }, [processPoints]);

  // Новые точки из фоновой задачи, возврат в приложение, готовность района — во всех случаях забираем очередь
  useEffect(() => onWalkPoints(() => void drain()), [drain]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void drain());
    return () => sub.remove();
  }, [drain]);
  useEffect(() => {
    if (index && walk) void drain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, walk?.startedAt]);

  // Восстановление прогулки, если приложение закрыли или система выгрузила его во время записи
  useEffect(() => {
    (async () => {
      const saved = await storage.loadActiveWalk();
      const running = await isBackgroundWalkRunning();
      if (saved) {
        walkRef.current = saved;
        lastPointRef.current = saved.track[saved.track.length - 1] ?? null;
        setWalk(saved);
        // Фоновая запись могла остановиться (например, после перезагрузки телефона) — запускаем снова
        if (saved.background && !running) {
          const r = await startBackgroundWalk().catch(() => ({ ok: false as const, reason: '' }));
          if (!r.ok) stopWatchRef.current = await watchWalk((p) => processPoints([p]));
        } else if (!saved.background) {
          stopWatchRef.current = await watchWalk((p) => processPoints([p]));
        }
      } else if (running) {
        await stopBackgroundWalk(); // осиротевшая запись без прогулки
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startWalk = useCallback(async () => {
    if (walkRef.current) return;
    if (!(await ensureLocationPermission())) {
      setStatus('Нет доступа к геолокации.');
      return;
    }
    let background = false;
    try {
      const r = await startBackgroundWalk();
      background = r.ok;
      if (!r.ok) setStatus(`Прогулка пишется только при открытом приложении: ${r.reason}.`);
    } catch (e) {
      setStatus('Фоновая запись недоступна: ' + String((e as Error).message ?? e));
    }
    lastPointRef.current = null;
    setLastSummary(null);
    const w: Walk = {
      track: [],
      newSegments: 0,
      meters: 0,
      points: 0,
      startedAt: Date.now(),
      percentBefore: percentRef.current,
      background,
    };
    walkRef.current = w;
    setWalk(w);
    storage.saveActiveWalk(w);
    // Без фона (Expo Go или запрет «Разрешить всегда») — пишем, пока приложение открыто
    if (!background) stopWatchRef.current = await watchWalk((p) => processPoints([p]));
  }, [processPoints]);

  const stopWalk = useCallback(async () => {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
    await stopBackgroundWalk().catch(() => undefined);
    // Последние точки, которые успели накопиться
    const q = await drainWalkQueue();
    processPoints(q.map(([latitude, longitude]) => ({ latitude, longitude })));
    lastPointRef.current = null;
    const w = walkRef.current;
    walkRef.current = null;
    setWalk(null);
    storage.clearActiveWalk();
    if (w && (w.meters >= 20 || w.newSegments > 0)) {
      const rec: WalkRecord = {
        startedAt: w.startedAt,
        endedAt: Date.now(),
        meters: w.meters,
        newSegments: w.newSegments,
        points: w.points,
        percentBefore: w.percentBefore,
        percentAfter: percentRef.current,
      };
      const next = [rec, ...walksRef.current];
      walksRef.current = next;
      setWalks(next);
      storage.saveWalks(next);
      setLastSummary(rec);
    }
    storage.saveCovered(coveredRef.current);
    storage.savePoints(pointsRef.current);
  }, [processPoints]);

  // Закрытие экрана не останавливает фоновую запись — только запись «при открытом приложении»
  useEffect(() => () => stopWatchRef.current?.(), []);

  const reloadArea = useCallback(async () => {
    try {
      const p = await getHere();
      setHere(p);
      await loadAreaFor(p, true);
      setStatus(null);
    } catch (e) {
      setStatus('Не удалось обновить район: ' + String((e as Error).message ?? e));
    }
  }, [loadAreaFor]);

  const updateQuest = useCallback((q: Quest) => {
    setQuest(q);
    storage.saveQuest(q);
  }, []);

  const chooseQuest = useCallback(
    (d: Difficulty | null) => {
      if (quest && !quest.completedAt) updateQuest({ ...quest, chosen: d });
    },
    [quest, updateQuest],
  );

  /** «Здесь такого нет» — берём следующее запасное задание, место остаётся тем же. */
  const swapQuestTask = useCallback(() => {
    const o = activeOption(quest);
    if (!quest || !o || quest.swaps >= MAX_SWAPS || !o.spareTasks.length) return false;
    const [next, ...rest] = o.spareTasks;
    const options = quest.options.map((x) => (x === o ? { ...o, task: next, spareTasks: rest } : x));
    updateQuest({ ...quest, options, swaps: quest.swaps + 1 });
    return true;
  }, [quest, updateQuest]);

  const completeQuest = useCallback(
    async (photoUri: string) => {
      const o = activeOption(quest);
      if (!quest || !o) return { ok: false, message: 'Сначала выберите квест.' };
      if (quest.completedAt) return { ok: false, message: 'Квест уже выполнен.' };
      const p = await getHere(true);
      setHere(p);
      // Подменённую геолокацию (приложения «фейковый GPS») не засчитываем
      if (p.mocked) return { ok: false, message: 'Похоже, на телефоне включена подмена геолокации. Отключите её, чтобы засчитать квест.' };
      const d = distanceToQuest(o, p, area);
      if (d > QUEST_RADIUS) {
        return {
          ok: false,
          message: `До цели ещё ${Math.round(d)} м. Подойди ближе (до ${QUEST_RADIUS} м) и сфотографируй снова.`,
        };
      }
      if (o.needCoverage > 0) {
        const cov = streetCoverage(o, area, coveredRef.current);
        if (cov < o.needCoverage) {
          return {
            ok: false,
            message: `Улица пройдена на ${Math.round(cov * 100)}%, нужно ${Math.round(o.needCoverage * 100)}%. Включите прогулку и пройдите её дальше.`,
          };
        }
      }
      // Фото — в альбом «Тропа» в галерее (не пропадёт из кэша камеры) и миниатюра для карты
      const [galleryUri, thumb] = await Promise.all([
        savePhotoToAlbum(photoUri).catch(() => null),
        makeThumbnail(photoUri).catch(() => null),
      ]);
      const finalUri = galleryUri ?? photoUri;
      const done = { ...quest, completedAt: Date.now(), photoUri: finalUri };
      updateQuest(done);
      pointsRef.current += o.points;
      setPoints(pointsRef.current);
      await storage.savePoints(pointsRef.current);
      const rec: QuestRecord = {
        date: quest.date,
        completedAt: done.completedAt,
        streetName: o.streetName,
        task: o.task,
        points: o.points,
        difficulty: o.difficulty,
        photoUri: finalUri,
        thumb,
        lat: p.latitude,
        lon: p.longitude,
        inGallery: !!galleryUri,
      };
      setQuestHistory((h) => {
        const next = [rec, ...h];
        storage.saveQuestHistory(next);
        return next;
      });
      return {
        ok: true,
        message: `Квест выполнен! +${o.points} очков` + (galleryUri ? `
Фото сохранено в альбом «Тропа».` : `
Фото не удалось сохранить в галерею — нет разрешения.`),
      };
    },
    [quest, area, updateQuest],
  );

  const resetAll = useCallback(async () => {
    await stopWalk();
    await storage.reset();
    const empty = new Set<string>();
    coveredRef.current = empty;
    pointsRef.current = 0;
    setCovered(empty);
    setPoints(0);
    setQuest(null);
    walksRef.current = [];
    setWalks([]);
    setQuestHistory([]);
    setLastSummary(null);
    setVisitedParks(new Set());
    if (here) await Promise.all([loadAreaFor(here, true), loadWeatherFor(here)]);
  }, [stopWalk, here, loadAreaFor, loadWeatherFor]);

  const value: Progress = {
    ready,
    status,
    here,
    area,
    covered,
    percent,
    parkStats,
    points,
    weather,
    quest,
    walk,
    walks,
    questHistory,
    lastSummary,
    dismissSummary: () => setLastSummary(null),
    startWalk,
    stopWalk,
    addSimulatedPoint: (p: LatLng) => processPoints([p]),
    reloadArea,
    completeQuest,
    chooseQuest,
    swapQuestTask,
    resetAll,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
