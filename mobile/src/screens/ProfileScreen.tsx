import React, { useMemo } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DIFFICULTY } from '../services/quest';
import { activeDays, formatDuration, levelInfo, streak, weekStats } from '../services/stats';
import { useProgress } from '../store/progress';
import { useSettings } from '../store/settings';
import { colors } from '../theme';
import { formatDistance } from '../utils/geo';

const dateFmt = (t: number) =>
  new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) +
  ', ' +
  new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { points, walks, questHistory, percent, covered, resetAll } = useProgress();
  const { mapProvider, hasYandexKey, osmAvailable, setMapProvider } = useSettings();

  const lvl = levelInfo(points);
  const days = useMemo(() => activeDays(walks, questHistory), [walks, questHistory]);
  const st = streak(days);
  const week = useMemo(() => weekStats(walks, questHistory), [walks, questHistory]);
  const totalMeters = walks.reduce((s, w) => s + w.meters, 0);

  // Последние 7 дней для полоски стрика (слева — шесть дней назад, справа — сегодня)
  const last7 = useMemo(() => {
    const out: { key: string; label: string; on: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ key, label: WEEKDAYS[(d.getDay() + 6) % 7], on: days.has(key) });
    }
    return out;
  }, [days]);

  const history = useMemo(() => {
    const items = [
      ...walks.map((w) => ({ kind: 'walk' as const, t: w.startedAt, w })),
      ...questHistory.map((q) => ({ kind: 'quest' as const, t: q.completedAt, q })),
    ];
    return items.sort((a, b) => b.t - a.t).slice(0, 20);
  }, [walks, questHistory]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      {/* Уровень */}
      <View style={[styles.card, styles.hero]}>
        <View style={styles.levelBadge}>
          <Text style={styles.levelNum}>{lvl.level}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.levelTitle}>{lvl.title}</Text>
          <Text style={styles.muted}>
            {points} очков · до {lvl.level + 1}-го уровня ещё {lvl.toNext}
          </Text>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${Math.round(lvl.progress * 100)}%` }]} />
          </View>
        </View>
      </View>

      {/* Стрик */}
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.big}>🔥 {st.count}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.h2}>{plural(st.count, 'день', 'дня', 'дней')} подряд</Text>
            <Text style={styles.muted}>
              {st.today ? 'Сегодня уже засчитано — так держать!' : 'Погуляйте сегодня от 300 м или выполните квест, чтобы продлить серию.'}
            </Text>
          </View>
        </View>
        <View style={styles.days}>
          {last7.map((d) => (
            <View key={d.key} style={styles.day}>
              <View style={[styles.dayDot, d.on && styles.dayOn]}>{d.on && <Text style={styles.check}>✓</Text>}</View>
              <Text style={styles.dayLabel}>{d.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Неделя */}
      <Text style={styles.section}>За 7 дней</Text>
      <View style={styles.grid}>
        <Tile value={formatDistance(week.meters)} label="пройдено" />
        <Tile value={String(week.newSegments)} label="новых отрезков" />
        <Tile value={week.hours < 1 ? `${Math.round(week.hours * 60)} мин` : `${week.hours.toFixed(1)} ч`} label="на улице" />
        <Tile value={String(week.quests)} label="квестов" />
      </View>

      <Text style={styles.section}>Всё время</Text>
      <View style={styles.grid}>
        <Tile value={formatDistance(totalMeters)} label="всего пройдено" />
        <Tile value={`${percent.toFixed(1)}%`} label="открыто вокруг" />
        <Tile value={String(covered.size)} label="отрезков открыто" />
        <Tile value={String(questHistory.length)} label="квестов выполнено" />
      </View>

      {/* История */}
      <Text style={styles.section}>История</Text>
      <View style={styles.card}>
        {history.length === 0 && <Text style={styles.muted}>Пока пусто. Начните прогулку на вкладке «Карта».</Text>}
        {history.map((h, i) => (
          <View key={`${h.kind}-${h.t}`} style={[styles.historyRow, i > 0 && styles.divider]}>
            {h.kind === 'walk' ? (
              <>
                <Text style={styles.historyIcon}>🚶</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.text}>
                    {formatDistance(h.w.meters)} · {formatDuration(h.w.endedAt - h.w.startedAt)}
                  </Text>
                  <Text style={styles.muted}>
                    {dateFmt(h.t)} · +{h.w.newSegments} отрезков · +{h.w.points} очков
                  </Text>
                </View>
              </>
            ) : (
              <>
                {h.q.photoUri ? (
                  <Image source={{ uri: h.q.photoUri }} style={styles.thumb} />
                ) : (
                  <Text style={styles.historyIcon}>🧭</Text>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.text} numberOfLines={1}>
                    {h.q.difficulty ? DIFFICULTY[h.q.difficulty].emoji + ' ' : ''}Квест: {h.q.streetName ?? 'улица без названия'}
                  </Text>
                  <Text style={styles.muted}>
                    {dateFmt(h.t)} · +{h.q.points} очков
                  </Text>
                </View>
              </>
            )}
          </View>
        ))}
      </View>

      {/* Настройки */}
      <Text style={styles.section}>Настройки</Text>
      <View style={styles.card}>
        <Text style={styles.text}>Карта</Text>
        {!osmAvailable && <Text style={[styles.muted, { marginTop: 4 }]}>Яндекс Карты</Text>}
        <View style={[styles.segmented, !osmAvailable && { display: 'none' }]}>
          {(['yandex', 'osm'] as const).map((p) => {
            const disabled = p === 'yandex' && !hasYandexKey;
            const on = mapProvider === p;
            return (
              <Pressable
                key={p}
                disabled={disabled}
                onPress={() => setMapProvider(p)}
                style={[styles.segment, on && styles.segmentOn, disabled && { opacity: 0.4 }]}
              >
                <Text style={[styles.segmentText, on && { color: '#fff' }]}>{p === 'yandex' ? 'Яндекс' : 'OpenStreetMap'}</Text>
              </Pressable>
            );
          })}
        </View>
        {!hasYandexKey && (
          <Text style={[styles.muted, { marginTop: 8 }]}>
            Для Яндекс.Карт добавьте ключ в файл .env.local (EXPO_PUBLIC_YANDEX_MAPS_KEY) и перезапустите сервер Expo.
          </Text>
        )}
        <Pressable
          style={{ marginTop: 16 }}
          onPress={() =>
            Alert.alert('Сбросить прогресс?', 'Карта, очки, история и квест будут удалены.', [
              { text: 'Отмена', style: 'cancel' },
              { text: 'Сбросить', style: 'destructive', onPress: resetAll },
            ])
          }
        >
          <Text style={{ color: colors.danger, fontWeight: '600' }}>Сбросить прогресс</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  levelBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.walked, alignItems: 'center', justifyContent: 'center' },
  levelNum: { color: '#fff', fontSize: 28, fontWeight: '800' },
  levelTitle: { fontSize: 22, fontWeight: '800', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  big: { fontSize: 30, fontWeight: '800', color: colors.text },
  h2: { fontSize: 17, fontWeight: '700', color: colors.text },
  text: { fontSize: 15, color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  bar: { height: 8, backgroundColor: colors.border, borderRadius: 4, marginTop: 8, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: colors.walked },
  days: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  day: { alignItems: 'center', gap: 4 },
  dayDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: colors.walked, borderColor: colors.walked },
  check: { color: '#fff', fontWeight: '800' },
  dayLabel: { fontSize: 12, color: colors.muted },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginTop: 8, marginLeft: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border },
  tileValue: { fontSize: 22, fontWeight: '800', color: colors.text },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  historyIcon: { fontSize: 24, width: 44, textAlign: 'center' },
  thumb: { width: 44, height: 44, borderRadius: 8 },
  segmented: { flexDirection: 'row', marginTop: 8, backgroundColor: colors.bg, borderRadius: 12, padding: 3 },
  segment: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  segmentOn: { backgroundColor: colors.walked },
  segmentText: { fontWeight: '600', color: colors.text },
});
