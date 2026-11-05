import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapScreen from './src/screens/MapScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import QuestScreen from './src/screens/QuestScreen';
import { ProgressProvider, useProgress } from './src/store/progress';
import { SettingsProvider } from './src/store/settings';
import { storage } from './src/store/storage';
import { colors } from './src/theme';
import { LatLng } from './src/utils/geo';

type Tab = 'map' | 'quest' | 'profile';

function Shell() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('map');
  const [focus, setFocus] = useState<LatLng | null>(null);
  const { quest } = useProgress();
  const questPending = !!quest && !quest.completedAt;

  return (
    <View style={styles.root}>
      <View style={styles.flex}>
        {/* Карту не размонтируем, чтобы не перезагружать её при переключении вкладок */}
        <MapScreen focus={focus} />
        {tab === 'quest' && (
          <View style={StyleSheet.absoluteFill}>
            <QuestScreen
              onShowOnMap={(p) => {
                setFocus({ ...p }); // новый объект — чтобы сработало даже при повторном нажатии
                setTab('map');
              }}
            />
          </View>
        )}
        {tab === 'profile' && (
          <View style={StyleSheet.absoluteFill}>
            <ProfileScreen />
          </View>
        )}
      </View>
      <View style={[styles.tabs, { paddingBottom: insets.bottom + 6 }]}>
        <TabButton label="Карта" icon="🗺️" active={tab === 'map'} onPress={() => setTab('map')} />
        <TabButton label="Квест" icon="🧭" active={tab === 'quest'} dot={questPending} onPress={() => setTab('quest')} />
        <TabButton label="Профиль" icon="👤" active={tab === 'profile'} onPress={() => setTab('profile')} />
      </View>
      <StatusBar style="dark" />
    </View>
  );
}

function TabButton(p: { label: string; icon: string; active: boolean; dot?: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.tab} onPress={p.onPress}>
      <View>
        <Text style={{ fontSize: 22, opacity: p.active ? 1 : 0.5 }}>{p.icon}</Text>
        {p.dot && <View style={styles.dot} />}
      </View>
      <Text style={[styles.tabLabel, p.active && { color: colors.walked }]}>{p.label}</Text>
    </Pressable>
  );
}

export default function App() {
  // null — ещё читаем из памяти; геолокацию просим только после экрана приветствия
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  useEffect(() => {
    storage.loadOnboarded().then(setOnboarded);
  }, []);

  return (
    <SafeAreaProvider>
      {onboarded === null ? (
        <View style={styles.root} />
      ) : !onboarded ? (
        <OnboardingScreen
          onDone={() => {
            storage.saveOnboarded();
            setOnboarded(true);
          }}
        />
      ) : (
        <SettingsProvider>
          <ProgressProvider>
            <Shell />
          </ProgressProvider>
        </SettingsProvider>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
  },
  tab: { flex: 1, alignItems: 'center' },
  tabLabel: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  dot: { position: 'absolute', top: 0, right: -6, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.quest },
});
