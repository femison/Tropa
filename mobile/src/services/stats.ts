import { Difficulty, todayKey } from './quest';

export type WalkRecord = {
  startedAt: number;
  endedAt: number;
  meters: number;
  newSegments: number;
  points: number;
  percentBefore: number;
  percentAfter: number;
};

export type QuestRecord = {
  difficulty?: Difficulty;
  date: string;
  completedAt: number;
  streetName: string | null;
  task: string;
  points: number;
  photoUri: string | null;
};

const TITLES = ['Новичок', 'Пешеход', 'Исследователь', 'Следопыт', 'Краевед', 'Картограф', 'Легенда района'];

/** Очки, нужные для уровня L (L ≥ 1): 0, 100, 300, 600, 1000… */
const pointsForLevel = (l: number) => 50 * l * (l - 1);

export function levelInfo(points: number) {
  let level = 1;
  while (points >= pointsForLevel(level + 1)) level++;
  const from = pointsForLevel(level);
  const to = pointsForLevel(level + 1);
  return {
    level,
    title: TITLES[Math.min(level - 1, TITLES.length - 1)],
    progress: (points - from) / (to - from),
    toNext: to - points,
  };
}

/** День засчитывается в стрик, если была прогулка от 300 м или выполнен квест. */
const MIN_WALK_FOR_STREAK = 300;

export function activeDays(walks: WalkRecord[], quests: QuestRecord[]): Set<string> {
  const days = new Set<string>();
  for (const w of walks) if (w.meters >= MIN_WALK_FOR_STREAK) days.add(todayKey(new Date(w.startedAt)));
  for (const q of quests) days.add(q.date);
  return days;
}

/** Стрик: сколько дней подряд вы гуляли. Если сегодня ещё не гуляли, стрик со вчера не сгорает. */
export function streak(days: Set<string>): { count: number; today: boolean } {
  const d = new Date();
  const today = days.has(todayKey(d));
  if (!today) d.setDate(d.getDate() - 1);
  let count = 0;
  while (days.has(todayKey(d))) {
    count++;
    d.setDate(d.getDate() - 1);
  }
  return { count, today };
}

export function weekStats(walks: WalkRecord[], quests: QuestRecord[]) {
  const since = Date.now() - 7 * 24 * 3600 * 1000;
  const recent = walks.filter((w) => w.startedAt >= since);
  return {
    meters: recent.reduce((s, w) => s + w.meters, 0),
    newSegments: recent.reduce((s, w) => s + w.newSegments, 0),
    hours: recent.reduce((s, w) => s + (w.endedAt - w.startedAt), 0) / 3600000,
    walks: recent.length,
    quests: quests.filter((q) => q.completedAt >= since).length,
  };
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} мин`;
  return `${Math.floor(min / 60)} ч ${min % 60} мин`;
}
