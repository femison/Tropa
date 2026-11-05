import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';

const SLIDES = [
  {
    emoji: '🗺️',
    title: 'Добро пожаловать в Тропу',
    text: 'Каждая прогулка раскрашивает карту вашего района. Серые улицы — те, где вы ещё не были.',
  },
  {
    emoji: '🧭',
    title: 'Квест каждый день',
    text: 'Утром появляется задание: дойти до неоткрытой улицы и сфотографировать что-то интересное.',
  },
  {
    emoji: '🌧️',
    title: 'Погода — не помеха',
    text: 'В дождь и снег очки удваиваются. А в грозу или гололёд квест будет коротким и рядом с домом.',
  },
  {
    emoji: '📍',
    title: 'Нужны геолокация и камера',
    text: 'Геолокация — чтобы закрашивать пройденные улицы, камера — чтобы засчитывать квесты. Данные хранятся только на телефоне.',
  },
];

export default function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;
  const s = SLIDES[i];

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.topRow}>
        {!last && (
          <Pressable onPress={onDone} hitSlop={10}>
            <Text style={styles.skip}>Пропустить</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.circle}>
          <Text style={styles.emoji}>{s.emoji}</Text>
        </View>
        <Text style={styles.title}>{s.title}</Text>
        <Text style={styles.text}>{s.text}</Text>
      </View>

      <View style={styles.dots}>
        {SLIDES.map((_, k) => (
          <View key={k} style={[styles.dot, k === i && styles.dotOn]} />
        ))}
      </View>

      <Pressable style={styles.button} onPress={() => (last ? onDone() : setI(i + 1))}>
        <Text style={styles.buttonText}>{last ? 'Разрешить и начать' : 'Дальше'}</Text>
      </Pressable>
      {i > 0 && (
        <Pressable onPress={() => setI(i - 1)} style={{ marginTop: 12 }} hitSlop={10}>
          <Text style={styles.back}>Назад</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 24 },
  topRow: { height: 24, alignItems: 'flex-end' },
  skip: { color: colors.muted, fontSize: 15 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 160, height: 160, borderRadius: 80, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  emoji: { fontSize: 72 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, textAlign: 'center', marginTop: 32 },
  text: { fontSize: 17, color: colors.muted, textAlign: 'center', marginTop: 12, lineHeight: 24 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { width: 24, backgroundColor: colors.walked },
  button: { backgroundColor: colors.walked, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  back: { color: colors.muted, textAlign: 'center', fontSize: 15 },
});
