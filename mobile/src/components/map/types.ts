import { LatLng } from '../../utils/geo';

/** Улица целиком — серая линия под закрашенными. */
export type MapStreet = { wayId: number; coords: LatLng[] };
/** Непрерывный кусок пройденной улицы. */
export type MapRun = { key: string; wayId: number; coords: LatLng[] };
/** Парк — зелёная зона; захваченный — золотая с кубком. */
export type MapPark = { key: string; pieces: LatLng[][]; center: LatLng; captured: boolean };
/** Вариант квеста дня — метка на карте, по нажатию открывается карточка выбора. */
export type MapQuestOption = { id: string; target: LatLng; color: string; text: string; chosen: boolean };
/** Место рядом с целью квеста. */
export type MapPlace = { id: string; p: LatLng; relevant: boolean };

export type BaseMapProps = {
  streets: MapStreet[];
  walked: MapRun[];
  parks: MapPark[];
  places: MapPlace[];
  questOptions: MapQuestOption[];
  track: LatLng[];
  here: LatLng | null;
  /** Цель квеста; street — улица сложного квеста, park — парк паркового квеста. */
  quest: { target: LatLng; radius: number; street: LatLng[][] | null; park: LatLng[][] | null } | null;
  onLongPress: (p: LatLng) => void;
  onStreetPress: (wayId: number) => void;
  onParkPress: (key: string) => void;
  onPlacePress: (id: string) => void;
  onQuestPress: (id: string) => void;
  onMapPress: () => void;
  /** Карта не смогла загрузиться (например, неверный ключ). */
  onError?: (message: string) => void;
};

export type BaseMapHandle = {
  centerOn: (p: LatLng, zoom?: number) => void;
};
