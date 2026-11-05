import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  activeOption,
  DIFFICULTY,
  Difficulty,
  distanceToQuest,
  MAX_SWAPS,
  QUEST_RADIUS,
  QuestOption,
  streetCoverage,
} from '../services/quest';
import { placesNear } from '../services/places';
import { openReviews } from '../utils/reviews';
import { useProgress } from '../store/progress';
import { colors } from '../theme';
import { formatDistance, LatLng } from '../utils/geo';

const DIFF_COLOR: Record<Difficulty, string> = { easy: colors.good, medium: colors.warn, hard: colors.danger, park: colors.park };

export default function QuestScreen({ onShowOnMap }: { onShowOnMap: (p: LatLng) => void }) {
  const insets = useSafeAreaInsets();
  const { ready, quest, weather, here, points, area, covered, completeQuest, chooseQuest, swapQuestTask } = useProgress();
  const [busy, setBusy] = useState(false);
  const active = activeOption(quest);

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Нужна камера', 'Разрешите доступ к камере, чтобы засчитать квест.');
      return;
    }
    // Только камера, без галереи: старое или чужое фото не подсунуть
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (res.canceled) return;
    setBusy(true);
    try {
      // Геолокацию берём с GPS в момент съёмки: на iOS в EXIF снимка с камеры координат нет.
      const r = await completeQuest(res.assets[0].uri);
      Alert.alert(r.ok ? '🎉 Готово' : 'Пока не засчитано', r.message);
    } catch (e) {
      Alert.alert('Ошибка', String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function notHere() {
    if (!quest) return;
    const left = MAX_SWAPS - quest.swaps;
    Alert.alert(
      'Здесь такого нет?',
      `Заменим задание на другое — место останется тем же. Осталось замен: ${left}.`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Заменить', onPress: () => swapQuestTask() },
      ],
    );
  }

  const distTo = (o: QuestOption) => (here ? distanceToQuest(o, here, area) : null);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.h1}>Сегодня</Text>

      {/* Погода */}
      <View style={styles.card}>
        {weather ? (
          <>
            <View style={styles.row}>
              <Text style={styles.emoji}>{weather.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.temp}>
                  {weather.temperature}° <Text style={styles.muted}>ощущается {weather.feelsLike}°</Text>
                </Text>
                <Text style={styles.text}>
                  {weather.description}, ветер {Math.round(weather.windSpeed)} м/с
                </Text>
              </View>
            </View>
            {weather.isSevere && (
              <Text style={[styles.badge, { backgroundColor: colors.danger }]}>
                ⚠️ {weather.severeReason} — сегодня только короткий квест рядом с домом
              </Text>
            )}
            {weather.isBad && !weather.isSevere && (
              <Text style={[styles.badge, { backgroundColor: colors.warn }]}>×2 очка за прогулку в непогоду</Text>
            )}
            {weather.bestHour && (
              <Text style={[styles.muted, { marginTop: 8 }]}>
                Лучшее время для прогулки: {String(weather.bestHour.hour).padStart(2, '0')}:00 — {weather.bestHour.temperature}°,{' '}
                {weather.bestHour.description.toLowerCase()}
              </Text>
            )}
          </>
        ) : (
          <Text style={styles.muted}>{ready ? 'Погода недоступна' : 'Загружаем погоду…'}</Text>
        )}
      </View>

      {!quest && (
        <View style={[styles.card, styles.row]}>
          {!ready && <ActivityIndicator color={colors.quest} />}
          <Text style={[styles.muted, { flex: 1 }]}>
            {ready ? 'Не нашли подходящую улицу рядом. Обновите район на карте (⟳).' : 'Готовим квест дня…'}
          </Text>
        </View>
      )}

      {/* Выбор сложности */}
      {quest && !quest.chosen && !quest.completedAt && (
        <>
          <Text style={styles.section}>Выберите квест дня</Text>
          {quest.short && (
            <Text style={styles.muted}>Сегодня опасная погода, поэтому доступен только простой квест рядом с домом.</Text>
          )}
          {quest.options.map((o) => (
            <View key={o.difficulty} style={[styles.card, { borderColor: DIFF_COLOR[o.difficulty], borderWidth: 2 }]}>
              <View style={styles.row}>
                <DiffBadge d={o.difficulty} />
                <Text style={styles.pointsBig}>+{o.points}</Text>
              </View>
              <Text style={styles.street}>📍 {o.streetName ?? 'Улица без названия'}</Text>
              <Text style={styles.task}>{o.task}</Text>
              <View style={[styles.row, styles.chips]}>
                {distTo(o) != null && <Text style={styles.chip}>до цели {formatDistance(distTo(o)!)}</Text>}
                {o.needCoverage > 0 && (
                  <Text style={styles.chip}>
                    пройти {Math.round(o.needCoverage * 100)}% из {formatDistance(o.streetLength)}
                  </Text>
                )}
                {quest.doubled && <Text style={styles.chip}>×2 за погоду</Text>}
              </View>
              <Pressable style={[styles.button, { backgroundColor: DIFF_COLOR[o.difficulty] }]} onPress={() => chooseQuest(o.difficulty)}>
                <Text style={styles.buttonText}>Выбрать</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}

      {/* Выбранный квест */}
      {quest && active && !quest.completedAt && (
        <View style={[styles.card, { borderColor: colors.quest, borderWidth: 2 }]}>
          <View style={styles.row}>
            <DiffBadge d={active.difficulty} />
            <Text style={styles.pointsBig}>+{active.points}</Text>
          </View>
          <Text style={styles.street}>📍 {active.streetName ?? 'Улица без названия — смотри метку на карте'}</Text>
          <Text style={styles.task}>{active.task}</Text>
          <View style={[styles.row, styles.chips]}>
            {distTo(active) != null && <Text style={styles.chip}>до цели {formatDistance(distTo(active)!)}</Text>}
            {quest.doubled && <Text style={styles.chip}>×2 за погоду</Text>}
          </View>

          {active.needCoverage > 0 && <CoverageBar value={streetCoverage(active, area, covered)} need={active.needCoverage} />}
          {active.parkKey && (
            <Text style={[styles.muted, { marginTop: 8 }]}>Фото засчитывается в любом месте внутри парка.</Text>
          )}

          <NearbyPlaces o={active} onShow={onShowOnMap} />

          <Pressable style={[styles.button, styles.secondary]} onPress={() => onShowOnMap(active.target)}>
            <Text style={[styles.buttonText, { color: colors.quest }]}>Показать на карте</Text>
          </Pressable>
          <Pressable style={[styles.button, busy && { opacity: 0.6 }]} disabled={busy} onPress={takePhoto}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>📷 Я на месте — сфотографировать</Text>}
          </Pressable>

          <View style={[styles.row, { justifyContent: 'space-between', marginTop: 14 }]}>
            {quest.swaps < MAX_SWAPS ? (
              <Pressable onPress={notHere} hitSlop={8}>
                <Text style={styles.link}>Здесь такого нет</Text>
              </Pressable>
            ) : (
              <Text style={styles.muted}>Замены задания закончились</Text>
            )}
            <Pressable onPress={() => chooseQuest(null)} hitSlop={8}>
              <Text style={styles.link}>Другая сложность</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Выполнено */}
      {quest?.completedAt && (
        <View style={[styles.card, { borderColor: colors.good, borderWidth: 2 }]}>
          {active && <DiffBadge d={active.difficulty} />}
          <Text style={[styles.task, { color: colors.good, fontWeight: '700' }]}>✅ Квест выполнен. Новый — завтра утром.</Text>
          {active && <Text style={styles.muted}>{active.task}</Text>}
          {quest.photoUri && <Image source={{ uri: quest.photoUri }} style={styles.photo} />}
        </View>
      )}

      {/* Как засчитывается */}
      <View style={styles.card}>
        <Text style={styles.h3}>Как засчитывается квест</Text>
        <Text style={styles.rule}>📍 Фото нужно сделать не дальше {QUEST_RADIUS} м от цели — это проверяет GPS в момент съёмки.</Text>
        <Text style={styles.rule}>📷 Снимок — только с камеры, из галереи загрузить нельзя.</Text>
        <Text style={styles.rule}>🚶 В сложном квесте улицу нужно пройти с включённой прогулкой.</Text>
        <Text style={styles.rule}>🌳 В парковом квесте фото можно сделать в любом месте парка.</Text>
        <Text style={styles.rule}>🔁 Если нужного на месте нет — нажмите «Здесь такого нет», задание заменится (до {MAX_SWAPS} раз в день).</Text>
        <Text style={styles.rule}>🚫 С подменой геолокации квест не засчитывается.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.text}>
          Всего очков: <Text style={{ fontWeight: '800' }}>{points}</Text>
        </Text>
      </View>
    </ScrollView>
  );
}

/** Места вокруг цели: помогают найти то, что нужно для задания, и посмотреть отзывы. */
function NearbyPlaces({ o, onShow }: { o: QuestOption; onShow: (p: LatLng) => void }) {
  const { area } = useProgress();
  const list = placesNear(o, area, 6);
  if (!list.length) return null;
  return (
    <View style={styles.places}>
      <Text style={styles.h3}>Места рядом с целью</Text>
      {list.map((n) => (
        <View key={n.id} style={styles.placeRow}>
          <Pressable style={{ flex: 1 }} onPress={() => onShow(n.poi.p)}>
            <Text style={styles.placeName} numberOfLines={1}>
              {n.relevant ? '✨ ' : ''}
              {n.poi.name}
            </Text>
            <Text style={styles.muted}>
              {n.label} · {formatDistance(n.dist)}
            </Text>
          </Pressable>
          <Pressable style={styles.reviewBtn} onPress={() => openReviews(n.poi)} hitSlop={6}>
            <Text style={styles.reviewText}>⭐ Отзывы</Text>
          </Pressable>
        </View>
      ))}
      <Text style={[styles.muted, { marginTop: 6 }]}>✨ — подходит под задание. Отзывы открываются в Яндекс Картах.</Text>
    </View>
  );
}

function DiffBadge({ d }: { d: Difficulty }) {
  return (
    <View style={[styles.diff, { backgroundColor: DIFF_COLOR[d] }]}>
      <Text style={styles.diffText}>{DIFFICULTY[d].label}</Text>
      <Text style={styles.diffHint}>{DIFFICULTY[d].hint}</Text>
    </View>
  );
}

function CoverageBar({ value, need }: { value: number; need: number }) {
  const ok = value >= need;
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.muted}>
        Улица пройдена на <Text style={{ fontWeight: '800', color: ok ? colors.good : colors.text }}>{Math.round(value * 100)}%</Text> из нужных{' '}
        {Math.round(need * 100)}%
      </Text>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${Math.min(100, value * 100)}%`, backgroundColor: ok ? colors.good : colors.walked }]} />
        <View style={[styles.barMark, { left: `${need * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  h1: { fontSize: 30, fontWeight: '800', color: colors.text },
  h3: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginTop: 4, marginLeft: 4 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chips: { marginTop: 10, flexWrap: 'wrap', gap: 8 },
  emoji: { fontSize: 40 },
  temp: { fontSize: 24, fontWeight: '700', color: colors.text },
  text: { fontSize: 15, color: colors.text },
  muted: { fontSize: 13, color: colors.muted, fontWeight: '400' },
  rule: { fontSize: 14, color: colors.text, marginTop: 4, lineHeight: 20 },
  badge: { color: '#fff', fontWeight: '700', marginTop: 10, padding: 8, borderRadius: 10, overflow: 'hidden' },
  diff: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, alignSelf: 'flex-start', flexShrink: 1 },
  diffText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  diffHint: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
  pointsBig: { marginLeft: 'auto', fontSize: 20, fontWeight: '800', color: colors.quest },
  street: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 10 },
  task: { fontSize: 17, color: colors.text, marginTop: 4, lineHeight: 24 },
  chip: { backgroundColor: colors.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, fontSize: 13, overflow: 'hidden' },
  button: { backgroundColor: colors.quest, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  secondary: { backgroundColor: 'transparent', borderWidth: 2, borderColor: colors.quest },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { color: colors.quest, fontWeight: '600', fontSize: 14 },
  bar: { height: 10, backgroundColor: colors.border, borderRadius: 5, marginTop: 6, overflow: 'hidden' },
  barFill: { height: 10 },
  barMark: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.text },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, marginTop: 10 },
  places: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  placeName: { fontSize: 15, fontWeight: '600', color: colors.text },
  reviewBtn: { backgroundColor: '#FFDB4D', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  reviewText: { fontWeight: '700', color: colors.text, fontSize: 13 },
});
