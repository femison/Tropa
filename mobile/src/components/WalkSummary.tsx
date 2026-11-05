import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDuration, WalkRecord } from '../services/stats';
import { colors } from '../theme';
import { formatDistance } from '../utils/geo';

export default function WalkSummary({ walk, onClose }: { walk: WalkRecord | null; onClose: () => void }) {
  if (!walk) return null;
  const gain = walk.percentAfter - walk.percentBefore;
  const praise =
    walk.newSegments >= 30 ? 'Отличная вылазка!' : walk.newSegments > 0 ? 'Карта стала ярче!' : 'Хорошая прогулка!';
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.emoji}>🏁</Text>
          <Text style={styles.title}>{praise}</Text>
          <View style={styles.grid}>
            <Stat value={formatDistance(walk.meters)} label="пройдено" />
            <Stat value={formatDuration(walk.endedAt - walk.startedAt)} label="в пути" />
            <Stat value={`+${walk.newSegments}`} label="новых отрезков" />
            <Stat value={`+${walk.points}`} label="очков" accent />
          </View>
          {gain > 0.05 && (
            <Text style={styles.note}>
              Открыто вокруг: {walk.percentBefore.toFixed(1)}% → <Text style={{ color: colors.walked, fontWeight: '800' }}>{walk.percentAfter.toFixed(1)}%</Text>
            </Text>
          )}
          <Pressable style={styles.button} onPress={onClose}>
            <Text style={styles.buttonText}>Отлично</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.value, accent && { color: colors.walked }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.card, borderRadius: 24, padding: 24, alignItems: 'center' },
  emoji: { fontSize: 48 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 16, width: '100%' },
  stat: { width: '50%', alignItems: 'center', paddingVertical: 10 },
  value: { fontSize: 22, fontWeight: '800', color: colors.text },
  label: { fontSize: 13, color: colors.muted },
  note: { fontSize: 14, color: colors.text, marginTop: 8 },
  button: { backgroundColor: colors.walked, borderRadius: 14, paddingVertical: 14, alignSelf: 'stretch', alignItems: 'center', marginTop: 18 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
