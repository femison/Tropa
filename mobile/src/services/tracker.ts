import * as Location from 'expo-location';
import { LatLng } from '../utils/geo';

/** Точки с погрешностью хуже этой отбрасываем — они закрасят чужие улицы. */
const MAX_ACCURACY = 35; // м

export async function ensureLocationPermission(): Promise<boolean> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  return granted;
}

export async function getHere(precise = false): Promise<LatLng & { accuracy: number | null; mocked: boolean }> {
  const loc = await Location.getCurrentPositionAsync({
    accuracy: precise ? Location.Accuracy.Highest : Location.Accuracy.Balanced,
  });
  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: loc.coords.accuracy,
    mocked: loc.mocked ?? false, // Android сообщает, если координаты подменены
  };
}

/**
 * Следит за положением, пока приложение открыто.
 * Для записи в фоне понадобится dev-сборка и expo-task-manager — это следующий шаг после MVP.
 */
export async function watchWalk(onPoint: (p: LatLng) => void): Promise<() => void> {
  const sub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5, timeInterval: 3000 },
    (loc) => {
      if (loc.coords.accuracy != null && loc.coords.accuracy > MAX_ACCURACY) return;
      onPoint({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    },
  );
  return () => sub.remove();
}
