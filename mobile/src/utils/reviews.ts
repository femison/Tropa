import { Linking } from 'react-native';
import { Poi } from '../services/osm';

/**
 * Карточка места с отзывами — в приложении «Яндекс Карты» (или на сайте, если приложения нет).
 * Публичного API с текстами отзывов у Яндекса нет, поэтому ведём туда, где они есть.
 */
export function openReviews(poi: Poi) {
  const { latitude: lat, longitude: lon } = poi.p;
  const q = encodeURIComponent(poi.name);
  const app = `yandexmaps://maps.yandex.ru/?text=${q}&ll=${lon},${lat}&z=18`;
  const web = `https://yandex.ru/maps/?text=${q}&ll=${lon},${lat}&z=18`;
  Linking.openURL(app).catch(() => Linking.openURL(web));
}
