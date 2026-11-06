import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import OsmMap from '../components/map/OsmMap';
import { BaseMapHandle, MapPark, MapPhoto, MapPlace, MapQuestOption, MapRun, MapStreet } from '../components/map/types';
import YandexMap from '../components/map/YandexMap';
import WalkSummary from '../components/WalkSummary';
import { YANDEX_MAPS_KEY } from '../config';
import { Area, Segment } from '../services/osm';
import { placesNear } from '../services/places';
import { openReviews } from '../utils/reviews';
import { activeOption, DIFFICULTY, Difficulty, distanceToQuest, QUEST_RADIUS, QuestOption, streetCoverage } from '../services/quest';
import { PARK_CAPTURE, useProgress } from '../store/progress';
import { useSettings } from '../store/settings';
import { colors } from '../theme';
import { formatDistance, LatLng } from '../utils/geo';

function buildStreets(area: Area, byId: Map<string, Segment>): MapStreet[] {
  return area.streets.map((st) => {
    const coords: LatLng[] = [];
    st.segmentIds.forEach((id, i) => {
      const s = byId.get(id)!;
      if (i === 0) coords.push(s.a);
      coords.push(s.b);
    });
    return { wayId: st.wayId, coords };
  });
}

/** Склеивает соседние пройденные отрезки улицы в одну линию — так карте легче. */
function buildWalked(area: Area, byId: Map<string, Segment>, covered: Set<string>): MapRun[] {
  const runs: MapRun[] = [];
  for (const st of area.streets) {
    let cur: MapRun | null = null;
    for (const id of st.segmentIds) {
      if (!covered.has(id)) {
        cur = null;
        continue;
      }
      const s = byId.get(id)!;
      if (!cur) {
        cur = { key: `${st.wayId}-${id}`, wayId: st.wayId, coords: [s.a] };
        runs.push(cur);
      }
      cur.coords.push(s.b);
    }
  }
  return runs;
}

export default function MapScreen({ focus }: { focus: LatLng | null }) {
  const insets = useSafeAreaInsets();
  const map = useRef<BaseMapHandle>(null);
  const { mapProvider, osmAvailable } = useSettings();
  const [yandexTry, setYandexTry] = useState(0);
  const [yandexError, setYandexError] = useState<string | null>(null);
  const [legend, setLegend] = useState(false);
  const [streetId, setStreetId] = useState<number | null>(null);
  const [parkKey, setParkKey] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [questSheet, setQuestSheet] = useState<Difficulty | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const {
    ready,
    status,
    here,
    area,
    covered,
    parkStats,
    percent,
    points,
    quest,
    walk,
    weather,
    lastSummary,
    dismissSummary,
    startWalk,
    stopWalk,
    addSimulatedPoint,
    reloadArea,
    chooseQuest,
    questHistory,
  } = useProgress();

  const byId = useMemo(() => new Map((area?.segments ?? []).map((s) => [s.id, s])), [area]);
  const streets = useMemo(() => (area ? buildStreets(area, byId) : []), [area, byId]);
  const walked = useMemo(() => (area ? buildWalked(area, byId, covered) : []), [area, byId, covered]);
  const track = useMemo(() => walk?.track ?? [], [walk?.track]);
  // Открытый в карточке вариант квеста (ещё не выбранный) — показываем его улицу или парк заранее
  const sheetOption = quest?.options.find((o) => o.difficulty === questSheet) ?? null;
  const questTarget = useMemo(() => {
    const o = activeOption(quest) ?? sheetOption;
    if (!quest || quest.completedAt || !o) return null;
    let street: LatLng[][] | null = null;
    if (o.needCoverage > 0) {
      // Улица может состоять из нескольких кусков — рвём линию там, где отрезки не стыкуются
      street = [];
      let line: LatLng[] = [];
      for (const id of o.segmentIds) {
        const s = byId.get(id);
        if (!s) continue;
        const last = line[line.length - 1];
        if (!last || Math.abs(last.latitude - s.a.latitude) > 1e-5 || Math.abs(last.longitude - s.a.longitude) > 1e-5) {
          if (line.length > 1) street.push(line);
          line = [s.a];
        }
        line.push(s.b);
      }
      if (line.length > 1) street.push(line);
      if (!street.length) street = null;
    }
    const park = o.parkKey ? (area?.parks.find((p) => p.key === o.parkKey)?.pieces ?? null) : null;
    return { target: o.target, radius: QUEST_RADIUS, street, park };
  }, [quest, sheetOption, byId, area]);

  // Фото выполненных квестов — на месте съёмки
  const photos = useMemo<MapPhoto[]>(
    () =>
      questHistory
        .filter((q) => q.lat != null && q.lon != null && q.thumb)
        .map((q) => ({ id: String(q.completedAt), p: { latitude: q.lat!, longitude: q.lon! }, thumb: q.thumb! })),
    [questHistory],
  );
  const photo = photoId ? (questHistory.find((q) => String(q.completedAt) === photoId) ?? null) : null;

  // Метки вариантов квеста дня — выбирать можно прямо на карте
  const questOptions = useMemo<MapQuestOption[]>(() => {
    if (!quest || quest.completedAt) return [];
    return quest.options.map((o) => ({
      id: o.difficulty,
      target: o.target,
      color: diffColor[o.difficulty],
      text: `${DIFFICULTY[o.difficulty].label} +${o.points}`,
      chosen: quest.chosen === o.difficulty,
    }));
  }, [quest]);

  const parks = useMemo<MapPark[]>(
    () =>
      (area?.parks ?? []).map((p) => ({
        key: p.key,
        pieces: p.pieces,
        center: p.center,
        captured: parkStats.get(p.key)?.captured ?? false,
      })),
    [area, parkStats],
  );

  // Места рядом с целью квеста — чтобы найти именно то, что нужно для задания
  const nearby = useMemo(() => {
    const o = activeOption(quest);
    return o && !quest?.completedAt ? placesNear(o, area, 12) : [];
  }, [quest, area]);
  const places = useMemo<MapPlace[]>(() => nearby.map((n) => ({ id: n.id, p: n.poi.p, relevant: n.relevant })), [nearby]);
  const place = nearby.find((n) => n.id === placeId) ?? null;

  const park = useMemo(() => {
    if (!parkKey || !area) return null;
    const p = area.parks.find((x) => x.key === parkKey);
    return p ? { park: p, stat: parkStats.get(p.key) } : null;
  }, [parkKey, area, parkStats]);
  const parksCaptured = useMemo(() => [...parkStats.values()].filter((s) => s.captured).length, [parkStats]);

  // Карточка улицы по нажатию
  const street = useMemo(() => {
    if (streetId == null || !area) return null;
    const st = area.streets.find((s) => s.wayId === streetId);
    if (!st) return null;
    let total = 0;
    let done = 0;
    for (const id of st.segmentIds) {
      const s = byId.get(id)!;
      total += s.length;
      if (covered.has(id)) done += s.length;
    }
    const inPark = st.parkId ? area.parks.find((p) => p.id === st.parkId) : null;
    const name = st.name ?? (inPark ? `Дорожка в парке${inPark.name ? ` «${inPark.name}»` : ''}` : null);
    return { name, total, done, percent: total ? (done / total) * 100 : 0 };
  }, [streetId, area, byId, covered]);

  // В отдельном APK запасной OSM-карты нет (нужен ключ Google) — остаёмся на Яндексе и предлагаем повторить
  const useYandex = mapProvider === 'yandex' && (!yandexError || !osmAvailable);

  // Первое центрирование (и заново — при смене карты) и переход к цели квеста.
  const centered = useRef(false);
  useEffect(() => {
    centered.current = false;
  }, [useYandex]);
  useEffect(() => {
    if (here && !centered.current) {
      centered.current = true;
      map.current?.centerOn(here, 15);
    }
  }, [here, useYandex]);
  useEffect(() => {
    if (focus) map.current?.centerOn(focus, 16);
  }, [focus]);
  const mapProps = {
    streets,
    walked,
    track,
    here: useYandex ? here : null, // у OSM-карты своя синяя точка
    quest: questTarget,
    parks,
    places,
    questOptions,
    photos,
    onPhotoPress: (id: string) => {
      setPhotoId(id);
      setQuestSheet(null);
      setStreetId(null);
      setParkKey(null);
      setPlaceId(null);
    },
    onQuestPress: (id: string) => {
      setPhotoId(null);
      setQuestSheet(id as Difficulty);
      setStreetId(null);
      setParkKey(null);
      setPlaceId(null);
    },
    onParkPress: (key: string) => {
      setParkKey(key);
      setStreetId(null);
      setPlaceId(null);
      setQuestSheet(null);
    },
    onPlacePress: (id: string) => {
      setPlaceId(id);
      setStreetId(null);
      setParkKey(null);
      setQuestSheet(null);
    },
    onLongPress: (p: LatLng) => walk && addSimulatedPoint(p),
    onStreetPress: (id: number) => {
      setStreetId(id);
      setParkKey(null);
      setPlaceId(null);
      setQuestSheet(null);
    },
    onMapPress: () => {
      setPhotoId(null);
      setStreetId(null);
      setParkKey(null);
      setPlaceId(null);
      setQuestSheet(null);
      setLegend(false);
    },
  };

  return (
    <View style={styles.flex}>
      {useYandex ? (
        <YandexMap
          key={`yandex-${yandexTry}`}
          ref={map}
          apiKey={YANDEX_MAPS_KEY}
          {...mapProps}
          onError={setYandexError}
        />
      ) : (
        <OsmMap key="osm" ref={map} {...mapProps} />
      )}

      {/* Верхняя панель: прогресс района */}
      <View style={[styles.top, { top: insets.top + 8 }]}>
        <View style={styles.row}>
          <Text style={styles.percent}>{percent.toFixed(1)}%</Text>
          <View style={styles.flex}>
            <Text style={styles.topTitle}>улиц открыто вокруг</Text>
            {!!area?.parks.length && (
              <Text style={styles.muted}>
                🌳 парков захвачено: {parksCaptured} из {area.parks.length}
              </Text>
            )}
            <Text style={styles.muted}>
              {points} очков{weather ? `  ·  ${weather.emoji} ${weather.temperature}°` : ''}
              {weather?.isBad ? '  ·  ×2' : ''}
            </Text>
          </View>
          <Pressable onPress={reloadArea} hitSlop={10} accessibilityLabel="Обновить район">
            <Text style={styles.link}>⟳</Text>
          </Pressable>
        </View>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${Math.min(100, percent)}%` }]} />
        </View>
        {(status || yandexError) && (
          <View style={[styles.row, { marginTop: 6 }]}>
            {!ready && <ActivityIndicator size="small" color={colors.muted} />}
            <Text style={[styles.muted, styles.flex]}>
              {status ??
                (osmAvailable
                  ? `Яндекс.Карты не загрузились, показываем OSM. ${yandexError}`
                  : `Яндекс.Карты не загрузились: ${yandexError}`)}
            </Text>
            {!status && yandexError && !osmAvailable && (
              <Pressable
                onPress={() => {
                  setYandexError(null);
                  setYandexTry((n) => n + 1);
                }}
                hitSlop={8}
              >
                <Text style={{ color: colors.quest, fontWeight: '700' }}>Повторить</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {/* Кнопки справа */}
      <View style={[styles.fabs, { top: insets.top + 120 }]}>
        <Fab icon="◎" label="Ко мне" onPress={() => here && map.current?.centerOn(here, 16)} />
        {(questTarget || questOptions.length > 0) && (
          <Fab
            icon="★"
            label="К квесту"
            color={colors.quest}
            onPress={() => {
              if (quest?.chosen && questTarget) return map.current?.centerOn(questTarget.target, 16);
              // Квест не выбран — показываем варианты по очереди
              const ids = questOptions.map((o) => o.id);
              const next = ids[(ids.indexOf(questSheet ?? '') + 1) % ids.length] as Difficulty;
              setQuestSheet(next);
              const o = quest?.options.find((x) => x.difficulty === next);
              if (o) map.current?.centerOn(o.target, 15);
            }}
          />
        )}
        <Fab icon="?" label="Легенда" active={legend} onPress={() => setLegend((v) => !v)} />
      </View>

      {legend && (
        <View style={[styles.legend, { top: insets.top + 120 }]}>
          <LegendRow color={colors.street} text="ещё не пройдено" />
          <LegendRow color={colors.walked} text="пройдено" thick />
          <LegendRow color={colors.track} text="текущая прогулка" dashed />
          <LegendRow color={colors.quest} text="цель квеста" dot />
          <LegendRow color={colors.park} text="парк" area fill={colors.parkFill} />
          <LegendRow color="#F59F00" text="парк захвачен 🏆" area fill={colors.parkCapturedFill} />
          <LegendRow color={colors.track} text="места рядом с целью" dot fill="rgba(28,126,214,0.25)" />
          <Text style={[styles.muted, { marginTop: 6 }]}>Нажмите на улицу или парк, чтобы узнать, сколько пройдено.</Text>
        </View>
      )}

      {/* Нижняя панель */}
      <View style={styles.bottom}>
        {photo && (
          <View style={styles.sheet}>
            <View style={styles.row}>
              <Text style={[styles.sheetTitle, styles.flex]} numberOfLines={1}>
                📷 {photo.streetName ?? 'Квест'}
              </Text>
              <Pressable onPress={() => setPhotoId(null)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            {photo.photoUri && <Image source={{ uri: photo.photoUri }} style={styles.photoBig} resizeMode="cover" />}
            <Text style={styles.qTask}>{photo.task}</Text>
            <Text style={styles.muted}>
              {new Date(photo.completedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} · +{photo.points} очков
              {photo.inGallery ? ' · в альбоме «Тропа»' : ''}
            </Text>
          </View>
        )}
        {sheetOption && quest && (
          <QuestSheet
            o={sheetOption}
            chosen={quest.chosen === sheetOption.difficulty}
            dist={here ? distanceToQuest(sheetOption, here, area) : null}
            coverage={sheetOption.needCoverage > 0 ? streetCoverage(sheetOption, area, covered) : null}
            doubled={quest.doubled}
            onChoose={() => {
              chooseQuest(sheetOption.difficulty);
              map.current?.centerOn(sheetOption.target, 16);
            }}
            onCancel={() => chooseQuest(null)}
            onClose={() => setQuestSheet(null)}
          />
        )}
        {park && !walk && (
          <View style={styles.sheet}>
            <View style={styles.row}>
              <Text style={[styles.sheetTitle, styles.flex]} numberOfLines={1}>
                {park.stat?.captured ? '🏆 ' : '🌳 '}
                {park.park.name ?? 'Парк без названия'}
              </Text>
              <Pressable onPress={() => setParkKey(null)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.muted}>
              {(park.park.areaM2 / 10000).toFixed(1)} га ·{' '}
              {park.park.segmentIds.length
                ? `дорожек пройдено ${Math.round((park.stat?.percent ?? 0) * 100)}%`
                : park.stat?.visited
                  ? 'вы здесь были'
                  : 'ещё не были'}
              {park.stat?.captured
                ? ' · захвачен!'
                : park.park.segmentIds.length
                  ? ` · для захвата нужно ${PARK_CAPTURE * 100}%`
                  : ''}
            </Text>
            <View style={styles.bar}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${Math.min(100, (park.stat?.percent ?? 0) * 100)}%`,
                    backgroundColor: park.stat?.captured ? '#F59F00' : colors.park,
                  },
                ]}
              />
            </View>
          </View>
        )}
        {place && (
          <View style={styles.sheet}>
            <View style={styles.row}>
              <Text style={[styles.sheetTitle, styles.flex]} numberOfLines={1}>
                {place.poi.name}
              </Text>
              <Pressable onPress={() => setPlaceId(null)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.muted}>
              {place.label} · {formatDistance(place.dist)} от цели{place.relevant ? ' · подходит под задание' : ''}
            </Text>
            <Pressable style={styles.reviews} onPress={() => openReviews(place.poi)}>
              <Text style={styles.reviewsText}>⭐ Отзывы в Яндекс Картах</Text>
            </Pressable>
          </View>
        )}
        {street && !walk && (
          <View style={styles.sheet}>
            <View style={styles.row}>
              <Text style={[styles.sheetTitle, styles.flex]} numberOfLines={1}>
                {street.name ?? 'Улица без названия'}
              </Text>
              <Pressable onPress={() => setStreetId(null)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.muted}>
              Пройдено {formatDistance(street.done)} из {formatDistance(street.total)} — {street.percent.toFixed(0)}%
            </Text>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.min(100, street.percent)}%` }]} />
            </View>
          </View>
        )}
        {walk && (
          <View style={styles.sheet}>
            <View style={styles.walkStats}>
              <WalkStat value={formatDistance(walk.meters)} label="пройдено" />
              <WalkStat value={`+${walk.newSegments}`} label="отрезков" />
              <WalkStat value={`+${walk.points}`} label="очков" />
            </View>
            <Text style={styles.hint}>
              {walk.background
                ? '🔔 Запись идёт в фоне — можно выключить экран и убрать телефон.'
                : 'Держите приложение открытым: фоновая запись не разрешена.'}
            </Text>
          </View>
        )}
        <Pressable
          style={[styles.button, { backgroundColor: walk ? colors.danger : colors.walked }, !area && { opacity: 0.5 }]}
          disabled={!area}
          onPress={walk ? stopWalk : startWalk}
        >
          <Text style={styles.buttonText}>{walk ? '■  Завершить прогулку' : '▶  Начать прогулку'}</Text>
        </Pressable>
      </View>

      {!useYandex && <Text style={styles.attribution}>© участники OpenStreetMap · OSM France</Text>}

      <WalkSummary walk={lastSummary} onClose={dismissSummary} />
    </View>
  );
}

const diffColor: Record<Difficulty, string> = { easy: colors.good, medium: colors.warn, hard: colors.danger, park: colors.park };

/** Карточка варианта квеста на карте: что сделать, сколько идти, кнопка выбора. */
function QuestSheet(p: {
  o: QuestOption;
  chosen: boolean;
  dist: number | null;
  coverage: number | null;
  doubled: boolean;
  onChoose: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const d = DIFFICULTY[p.o.difficulty];
  const color = diffColor[p.o.difficulty];
  return (
    <View style={[styles.sheet, { borderWidth: 2, borderColor: color }]}>
      <View style={styles.row}>
        <View style={[styles.diff, { backgroundColor: color }]}>
          <Text style={styles.diffText}>{d.label}</Text>
        </View>
        <Text style={styles.qPoints}>+{p.o.points}</Text>
        <View style={styles.flex} />
        <Pressable onPress={p.onClose} hitSlop={10}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>
      <Text style={styles.sheetTitle} numberOfLines={1}>
        {p.o.parkKey ? '🌳 ' : '📍 '}
        {p.o.streetName ?? 'Улица без названия'}
      </Text>
      <Text style={styles.qTask}>{p.o.task}</Text>
      <Text style={styles.muted}>
        {p.dist != null ? `до цели ${formatDistance(p.dist)}` : d.hint}
        {p.o.needCoverage > 0 ? ` · пройти ${Math.round(p.o.needCoverage * 100)}% из ${formatDistance(p.o.streetLength)}` : ''}
        {p.coverage != null && p.coverage > 0 ? ` · уже ${Math.round(p.coverage * 100)}%` : ''}
        {p.o.parkKey ? ' · фото в любом месте парка' : ''}
        {p.doubled ? ' · ×2 за погоду' : ''}
      </Text>
      {p.chosen ? (
        <View style={[styles.row, { marginTop: 10 }]}>
          <Text style={[styles.qChosen, styles.flex]}>✓ Этот квест выбран</Text>
          <Pressable onPress={p.onCancel} hitSlop={8}>
            <Text style={styles.qCancel}>Отменить выбор</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={[styles.qButton, { backgroundColor: color }]} onPress={p.onChoose}>
          <Text style={styles.buttonText}>Выбрать этот квест</Text>
        </Pressable>
      )}
    </View>
  );
}

function Fab(p: { icon: string; label: string; onPress: () => void; color?: string; active?: boolean }) {
  return (
    <Pressable
      style={[styles.fab, p.active && { backgroundColor: colors.text }]}
      onPress={p.onPress}
      accessibilityLabel={p.label}
    >
      <Text style={[styles.fabIcon, { color: p.active ? '#fff' : p.color ?? colors.text }]}>{p.icon}</Text>
    </Pressable>
  );
}

function LegendRow(p: { color: string; text: string; thick?: boolean; dashed?: boolean; dot?: boolean; area?: boolean; fill?: string }) {
  return (
    <View style={[styles.row, { marginVertical: 3 }]}>
      {p.area ? (
        <View style={{ width: 24, height: 14, borderRadius: 3, backgroundColor: p.fill, borderWidth: 1, borderColor: p.color }} />
      ) : p.dot ? (
        <View style={{ width: 24, alignItems: 'center' }}>
          <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: p.color, backgroundColor: p.fill ?? 'rgba(112,72,232,0.15)' }} />
        </View>
      ) : (
        <View style={{ width: 24, height: p.thick ? 5 : 3, backgroundColor: p.dashed ? 'transparent' : p.color, borderColor: p.color, borderWidth: p.dashed ? 1.5 : 0, borderStyle: 'dashed' }} />
      )}
      <Text style={styles.legendText}>{p.text}</Text>
    </View>
  );
}

function WalkStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={styles.walkValue}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

const shadow = { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 };

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  top: { position: 'absolute', left: 12, right: 12, backgroundColor: colors.card, borderRadius: 16, padding: 12, ...shadow },
  percent: { fontSize: 28, fontWeight: '800', color: colors.walked, minWidth: 80 },
  topTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  link: { fontSize: 22, color: colors.muted, paddingHorizontal: 4 },
  bar: { height: 6, backgroundColor: colors.border, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: colors.walked },
  fabs: { position: 'absolute', right: 12, gap: 10 },
  fab: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', ...shadow },
  fabIcon: { fontSize: 22, fontWeight: '700' },
  legend: { position: 'absolute', right: 68, width: 220, backgroundColor: colors.card, borderRadius: 14, padding: 12, ...shadow },
  legendText: { fontSize: 14, color: colors.text },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 16, gap: 8 },
  sheet: { backgroundColor: colors.card, borderRadius: 16, padding: 12, ...shadow },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  close: { fontSize: 18, color: colors.muted, paddingHorizontal: 4 },
  diff: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  diffText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  qPoints: { fontSize: 17, fontWeight: '800', color: colors.quest },
  qTask: { fontSize: 15, color: colors.text, marginTop: 4, marginBottom: 4, lineHeight: 21 },
  qButton: { marginTop: 10, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  qChosen: { color: colors.good, fontWeight: '700' },
  qCancel: { color: colors.muted, fontWeight: '600' },
  photoBig: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, marginTop: 8, backgroundColor: colors.border },
  reviews: { marginTop: 10, borderRadius: 12, paddingVertical: 10, alignItems: 'center', backgroundColor: '#FFDB4D' },
  reviewsText: { fontWeight: '700', color: colors.text },
  walkStats: { flexDirection: 'row' },
  walkValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, textAlign: 'center' },
  button: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', ...shadow },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  attribution: { position: 'absolute', right: 6, bottom: 2, fontSize: 9, color: colors.muted },
});
