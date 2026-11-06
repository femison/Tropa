import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { PermissionsAndroid, Platform } from 'react-native';
import { colors } from '../theme';

/*
 * Запись прогулки в фоне. Android держит запись как foreground-сервис с постоянным уведомлением
 * в шторке — так она продолжается при выключенном экране и даже если система выгрузит приложение.
 * Точки складываются в очередь в AsyncStorage; приложение забирает их, когда оно открыто.
 */

export const WALK_TASK = 'tropa-walk';
const QUEUE_KEY = 'tropa.walkQueue.v1';
const MAX_QUEUE = 20000;
/** Точки с погрешностью хуже этой отбрасываем — они закрасят чужие улицы. */
const MAX_ACCURACY = 35; // м

/** Точка трека: широта, долгота, время (мс). */
export type TrackPoint = [number, number, number];

const listeners = new Set<() => void>();
let chain: Promise<unknown> = Promise.resolve();

/** Очередь меняем строго по одному, чтобы параллельные записи не затёрли друг друга. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function readQueue(): Promise<TrackPoint[]> {
  try {
    const s = await AsyncStorage.getItem(QUEUE_KEY);
    return s ? (JSON.parse(s) as TrackPoint[]) : [];
  } catch {
    return [];
  }
}

// Задачу нужно объявить при запуске JS — этот файл импортируется в index.ts.
TaskManager.defineTask(WALK_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const locations = (data as { locations?: Location.LocationObject[] }).locations ?? [];
  const pts: TrackPoint[] = [];
  for (const l of locations) {
    if (l.mocked) continue; // подменённая геолокация не закрашивает улицы
    if (l.coords.accuracy != null && l.coords.accuracy > MAX_ACCURACY) continue;
    pts.push([+l.coords.latitude.toFixed(6), +l.coords.longitude.toFixed(6), l.timestamp]);
  }
  if (!pts.length) return;
  await serial(async () => {
    const q = await readQueue();
    q.push(...pts);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
  });
  listeners.forEach((f) => f());
});

/** Подписка на новые точки (работает, пока приложение живо). */
export function onWalkPoints(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Забрать накопленные точки (и очистить очередь). */
export function drainWalkQueue(): Promise<TrackPoint[]> {
  return serial(async () => {
    const q = await readQueue();
    if (q.length) await AsyncStorage.removeItem(QUEUE_KEY);
    return q;
  });
}

export async function clearWalkQueue() {
  await serial(() => AsyncStorage.removeItem(QUEUE_KEY));
}

export type BackgroundStart = { ok: true } | { ok: false; reason: string };

/**
 * Запуск фоновой записи. Нужны разрешения: геолокация «Разрешить всегда» и (Android 13+) уведомления.
 * Если фон запретили — вернём ok:false, и прогулка пойдёт только при открытом приложении.
 */
export async function startBackgroundWalk(): Promise<BackgroundStart> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { ok: false, reason: 'нет доступа к геолокации' };
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    // Без этого разрешения сервис работает, но уведомления в шторке не видно
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) return { ok: false, reason: 'фоновая геолокация не разрешена («Разрешить всегда»)' };
  await clearWalkQueue();
  await Location.startLocationUpdatesAsync(WALK_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    distanceInterval: 5,
    timeInterval: 3000,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Тропа — идёт прогулка 🚶',
      notificationBody: 'Улицы закрашиваются, даже когда экран выключен. Нажмите, чтобы открыть.',
      notificationColor: colors.walked,
      killServiceOnDestroy: false,
    },
  });
  return { ok: true };
}

export async function isBackgroundWalkRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(WALK_TASK);
  } catch {
    return false;
  }
}

export async function stopBackgroundWalk() {
  if (await isBackgroundWalkRunning()) await Location.stopLocationUpdatesAsync(WALK_TASK);
}
