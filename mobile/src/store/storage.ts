import AsyncStorage from '@react-native-async-storage/async-storage';
import { RawArea } from '../services/osm';
import { Quest } from '../services/quest';
import { QuestRecord, WalkRecord } from '../services/stats';
import { Weather } from '../services/weather';

/** Прогресс — то, что стирает «Сбросить прогресс». */
const KEYS = {
  area: 'tropa.area.v3',
  covered: 'tropa.covered.v2',
  points: 'tropa.points.v1',
  quest: 'tropa.quest.v4',
  weather: 'tropa.weather.v1',
  walks: 'tropa.walks.v1',
  quests: 'tropa.quests.v1',
  parks: 'tropa.visitedParks.v1',
} as const;

/** Настройки и онбординг сбросом прогресса не трогаем. */
const SETTINGS_KEY = 'tropa.settings.v1';
const ONBOARDED_KEY = 'tropa.onboarded.v1';

export type MapProvider = 'yandex' | 'osm';
export type Settings = { mapProvider: MapProvider | null };

async function read<T>(key: string): Promise<T | null> {
  try {
    const s = await AsyncStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

async function write(key: string, value: unknown) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Не удалось сохранить', key, e);
  }
}

export const storage = {
  loadArea: () => read<RawArea>(KEYS.area),
  saveArea: (a: RawArea) => write(KEYS.area, a),
  loadCovered: async () => new Set((await read<string[]>(KEYS.covered)) ?? []),
  saveCovered: (s: Set<string>) => write(KEYS.covered, [...s]),
  loadPoints: async () => (await read<number>(KEYS.points)) ?? 0,
  savePoints: (n: number) => write(KEYS.points, n),
  loadQuest: () => read<Quest>(KEYS.quest),
  saveQuest: (q: Quest) => write(KEYS.quest, q),
  loadWeather: () => read<Weather>(KEYS.weather),
  saveWeather: (w: Weather) => write(KEYS.weather, w),
  loadWalks: async () => (await read<WalkRecord[]>(KEYS.walks)) ?? [],
  saveWalks: (w: WalkRecord[]) => write(KEYS.walks, w),
  loadQuestHistory: async () => (await read<QuestRecord[]>(KEYS.quests)) ?? [],
  saveQuestHistory: (q: QuestRecord[]) => write(KEYS.quests, q),
  loadVisitedParks: async () => new Set((await read<string[]>(KEYS.parks)) ?? []),
  saveVisitedParks: (s: Set<string>) => write(KEYS.parks, [...s]),
  reset: () => AsyncStorage.multiRemove(Object.values(KEYS)),

  loadSettings: async (): Promise<Settings> => (await read<Settings>(SETTINGS_KEY)) ?? { mapProvider: null },
  saveSettings: (s: Settings) => write(SETTINGS_KEY, s),
  loadOnboarded: async () => (await read<boolean>(ONBOARDED_KEY)) ?? false,
  saveOnboarded: () => write(ONBOARDED_KEY, true),
};
