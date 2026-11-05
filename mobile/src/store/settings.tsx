import Constants, { ExecutionEnvironment } from 'expo-constants';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { YANDEX_MAPS_KEY } from '../config';
import { MapProvider, Settings, storage } from './storage';

/**
 * Карта OSM рисуется через react-native-maps, а ему в отдельном APK нужен ключ Google Maps,
 * без которого приложение падает. В Expo Go ключ уже встроен — там OSM доступна.
 */
export const OSM_AVAILABLE = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type SettingsCtx = {
  /** Какая карта реально показывается. */
  mapProvider: MapProvider;
  hasYandexKey: boolean;
  osmAvailable: boolean;
  setMapProvider: (p: MapProvider) => void;
};

const Ctx = createContext<SettingsCtx | null>(null);

export function useSettings() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings вне SettingsProvider');
  return v;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>({ mapProvider: null });
  useEffect(() => {
    storage.loadSettings().then(setSettings);
  }, []);

  const hasYandexKey = YANDEX_MAPS_KEY.length > 0;
  const wanted = settings.mapProvider ?? (hasYandexKey ? 'yandex' : 'osm');
  let mapProvider: MapProvider = wanted === 'yandex' && !hasYandexKey ? 'osm' : wanted;
  if (!OSM_AVAILABLE) mapProvider = 'yandex';

  const setMapProvider = (p: MapProvider) => {
    const next = { ...settings, mapProvider: p };
    setSettings(next);
    storage.saveSettings(next);
  };

  return (
    <Ctx.Provider value={{ mapProvider, hasYandexKey, osmAvailable: OSM_AVAILABLE, setMapProvider }}>{children}</Ctx.Provider>
  );
}
