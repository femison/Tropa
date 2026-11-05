/**
 * Ключ Яндекс.Карт (сервис «JavaScript API и HTTP Геокодер», developer.tech.yandex.ru).
 * Кладётся в файл .env.local (он не попадает в git): EXPO_PUBLIC_YANDEX_MAPS_KEY=ваш-ключ — и перезапуск `npx expo start`.
 * Без ключа приложение показывает карту OpenStreetMap.
 */
export const YANDEX_MAPS_KEY = (process.env.EXPO_PUBLIC_YANDEX_MAPS_KEY ?? '').trim();
