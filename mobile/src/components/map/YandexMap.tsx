import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { WebView as RNWebView, WebViewMessageEvent, WebViewProps } from 'react-native-webview';
import { colors } from '../../theme';
import { LatLng } from '../../utils/geo';
import { BaseMapHandle, BaseMapProps } from './types';

// В типах react-native-webview класс параметризован так, что пропсы схлопываются в never
// (WebViewProps & undefined). Описываем компонент сами — поведение не меняется.
type WebHandle = { injectJavaScript: (js: string) => void };
const WebView = RNWebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebHandle> }>;

/*
 * Яндекс.Карты (JavaScript API 2.1) внутри WebView — так они работают прямо в Expo Go.
 * React Native шлёт в страницу данные через injectJavaScript, страница отвечает postMessage.
 */

/** Цвет метки → готовый стиль метки Яндекса с подписью. */
function yandexPreset(color: string) {
  if (color === colors.good) return 'islands#greenStretchyIcon';
  if (color === colors.warn) return 'islands#orangeStretchyIcon';
  if (color === colors.danger) return 'islands#redStretchyIcon';
  if (color === colors.park) return 'islands#darkGreenStretchyIcon';
  return 'islands#violetStretchyIcon';
}

const pack = (pts: LatLng[]) => pts.map((p) => [+p.latitude.toFixed(6), +p.longitude.toFixed(6)]);

function buildHtml(apiKey: string) {
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#eee}</style>
<script>
  function post(m){ window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  window.onerror = function(msg){ post({type:'error', message:String(msg)}); };
  function loadFailed(){ post({type:'error', message:'Не удалось загрузить API Яндекс.Карт. Проверьте интернет и ключ.'}); }
</script>
<script src="https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU" onerror="loadFailed()"></script>
</head><body><div id="map"></div>
<script>
var C = ${JSON.stringify({ street: colors.street, walked: colors.walked, track: colors.track, quest: colors.quest, park: colors.parkFill, parkCaptured: colors.parkCapturedFill })};
var map, gray, walked, track, quest, me, parks, places, options, pressTimer = null;
var lineOpts = function(color, width, z){ return { strokeColor: color, strokeWidth: width, strokeOpacity: 0.95, zIndex: z, cursor: 'pointer' }; };

function addLines(coll, list, color, width, z){
  coll.removeAll();
  for (var i = 0; i < list.length; i++) {
    (function(s){
      var pl = new ymaps.Polyline(s.c, {}, lineOpts(color, width, z));
      pl.events.add('click', function(e){ e.stopPropagation && e.stopPropagation(); post({type:'street', wayId:s.id}); });
      coll.add(pl);
    })(list[i]);
  }
}

window.tropa = {
  setParks: function(list){
    parks.removeAll();
    list.forEach(function(pk){
      pk.p.forEach(function(ring){
        var pg = new ymaps.Polygon([ring], {}, { fillColor: pk.c ? C.parkCaptured : C.park, strokeWidth: 0, zIndex: 0 });
        pg.events.add('click', function(e){ e.stopPropagation && e.stopPropagation(); post({type:'park', key: pk.k}); });
        parks.add(pg);
      });
      if (pk.c) {
        var cup = new ymaps.Placemark(pk.m, { iconContent: '🏆' }, { preset: 'islands#yellowStretchyIcon', zIndex: 2 });
        cup.events.add('click', function(){ post({type:'park', key: pk.k}); });
        parks.add(cup);
      }
    });
  },
  setOptions: function(list){
    options.removeAll();
    list.forEach(function(o){
      var pm = new ymaps.Placemark(o.c, { iconContent: (o.ch ? '★ ' : '') + o.t }, { preset: o.p, zIndex: 7 });
      pm.events.add('click', function(){ post({type:'questOption', id: o.id}); });
      options.add(pm);
    });
  },
  setPlaces: function(list){
    places.removeAll();
    list.forEach(function(pl){
      var pm = new ymaps.Placemark(pl.c, {}, { preset: pl.r ? 'islands#violetCircleDotIcon' : 'islands#blueCircleDotIcon', zIndex: 5 });
      pm.events.add('click', function(){ post({type:'place', id: pl.id}); });
      places.add(pm);
    });
  },
  setStreets: function(list){ addLines(gray, list, C.street, 4, 1); },
  setWalked: function(list){ addLines(walked, list, C.walked, 5, 2); },
  setTrack: function(coords){
    track.removeAll();
    if (coords.length > 1) track.add(new ymaps.Polyline(coords, {}, { strokeColor: C.track, strokeWidth: 3, strokeStyle: 'dash', zIndex: 3 }));
  },
  setQuest: function(q){
    quest.removeAll();
    if (!q) return;
    if (q.p) q.p.forEach(function(ring){ quest.add(new ymaps.Polygon([ring], {}, { fillColor: 'rgba(112,72,232,0.12)', strokeColor: C.quest, strokeWidth: 3, zIndex: 1 })); });
    if (q.s) q.s.forEach(function(line){ quest.add(new ymaps.Polyline(line, {}, { strokeColor: C.quest, strokeWidth: 8, strokeOpacity: 0.55, zIndex: 1 })); });
    quest.add(new ymaps.Circle([q.c, q.r], {}, { fillColor: 'rgba(112,72,232,0.15)', strokeColor: C.quest, strokeWidth: 2, zIndex: 4 }));
    quest.add(new ymaps.Placemark(q.c, {}, { preset: 'islands#violetStarIcon', zIndex: 5 }));
  },
  setHere: function(p){
    me.removeAll();
    if (p) me.add(new ymaps.Placemark(p, {}, { preset: 'islands#geolocationIcon', zIndex: 6 }));
  },
  centerOn: function(p, zoom){ map.setCenter(p, zoom || map.getZoom(), { duration: 400 }); }
};

ymaps.ready(function(){
  map = new ymaps.Map('map', { center: [55.751, 37.618], zoom: 14, controls: [] },
    { suppressMapOpenBlock: true, yandexMapDisablePoiInteractivity: true });
  gray = new ymaps.GeoObjectCollection(); walked = new ymaps.GeoObjectCollection();
  track = new ymaps.GeoObjectCollection(); quest = new ymaps.GeoObjectCollection(); me = new ymaps.GeoObjectCollection();
  parks = new ymaps.GeoObjectCollection(); places = new ymaps.GeoObjectCollection(); options = new ymaps.GeoObjectCollection();
  map.geoObjects.add(parks).add(gray).add(walked).add(track).add(quest).add(places).add(options).add(me);

  map.events.add('click', function(){ post({type:'mapPress'}); });
  // Долгое нажатие: на телефоне contextmenu приходит не всегда, поэтому ещё и свой таймер.
  var longPress = function(coords){ post({type:'longPress', lat: coords[0], lon: coords[1]}); };
  map.events.add('contextmenu', function(e){ clearTimeout(pressTimer); pressTimer = null; longPress(e.get('coords')); });
  map.events.add('mousedown', function(e){
    var coords = e.get('coords'); clearTimeout(pressTimer);
    pressTimer = setTimeout(function(){ pressTimer = null; longPress(coords); }, 650);
  });
  ['mouseup', 'actionbegin', 'multitouchstart'].forEach(function(ev){
    map.events.add(ev, function(){ clearTimeout(pressTimer); pressTimer = null; });
  });
  post({type:'ready'});
});
</script>
</body></html>`;
}

type Props = BaseMapProps & { apiKey: string };

const YandexMap = forwardRef<BaseMapHandle, Props>(function YandexMap(p, ref) {
  const web = useRef<WebHandle>(null);
  const [ready, setReady] = useState(false);
  const html = useMemo(() => buildHtml(p.apiKey), [p.apiKey]);

  // При неверном ключе или запрете по Referer API Яндекса может просто молчать.
  const onErrorRef = useRef(p.onError);
  onErrorRef.current = p.onError;
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(
      () => onErrorRef.current?.('Нет ответа от API за 15 секунд — проверьте ключ и ограничение по HTTP Referer.'),
      15000,
    );
    return () => clearTimeout(t);
  }, [ready]);

  const call = useCallback(
    (fn: string, ...args: unknown[]) => {
      if (!ready) return;
      const js = `window.tropa && window.tropa.${fn}(${args.map((a) => JSON.stringify(a)).join(',')}); true;`;
      web.current?.injectJavaScript(js);
    },
    [ready],
  );

  // Центрирование до загрузки API запоминаем и выполняем, когда карта готова.
  const pendingCenter = useRef<[number[], number] | null>(null);
  useImperativeHandle(ref, () => ({
    centerOn: (c, zoom = 16) => {
      const args: [number[], number] = [[c.latitude, c.longitude], zoom];
      if (ready) call('centerOn', ...args);
      else pendingCenter.current = args;
    },
  }));
  useEffect(() => {
    if (ready && pendingCenter.current) {
      call('centerOn', ...pendingCenter.current);
      pendingCenter.current = null;
    }
  }, [ready, call]);

  useEffect(() => call('setStreets', p.streets.map((s) => ({ id: s.wayId, c: pack(s.coords) }))), [call, p.streets]);
  useEffect(() => call('setWalked', p.walked.map((r) => ({ id: r.wayId, c: pack(r.coords) }))), [call, p.walked]);
  useEffect(() => call('setTrack', pack(p.track)), [call, p.track]);
  useEffect(
    () =>
      call(
        'setParks',
        p.parks.map((pk) => ({ k: pk.key, c: pk.captured, m: [pk.center.latitude, pk.center.longitude], p: pk.pieces.map(pack) })),
      ),
    [call, p.parks],
  );
  useEffect(
    () =>
      call(
        'setOptions',
        p.questOptions.map((o) => ({ id: o.id, c: [o.target.latitude, o.target.longitude], t: o.text, ch: o.chosen, p: yandexPreset(o.color) })),
      ),
    [call, p.questOptions],
  );
  useEffect(
    () => call('setPlaces', p.places.map((pl) => ({ id: pl.id, r: pl.relevant, c: [pl.p.latitude, pl.p.longitude] }))),
    [call, p.places],
  );
  useEffect(
    () =>
      call(
        'setQuest',
        p.quest
          ? {
              c: [p.quest.target.latitude, p.quest.target.longitude],
              r: p.quest.radius,
              s: p.quest.street ? p.quest.street.map(pack) : null,
              p: p.quest.park ? p.quest.park.map(pack) : null,
            }
          : null,
      ),
    [call, p.quest],
  );
  useEffect(() => call('setHere', p.here ? [p.here.latitude, p.here.longitude] : null), [call, p.here]);

  const onMessage = (e: WebViewMessageEvent) => {
    let m: any;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === 'ready') setReady(true);
    else if (m.type === 'street') p.onStreetPress(m.wayId);
    else if (m.type === 'park') p.onParkPress(m.key);
    else if (m.type === 'place') p.onPlacePress(m.id);
    else if (m.type === 'questOption') p.onQuestPress(m.id);
    else if (m.type === 'mapPress') p.onMapPress();
    else if (m.type === 'longPress') p.onLongPress({ latitude: m.lat, longitude: m.lon });
    else if (m.type === 'error') p.onError?.(m.message);
  };

  return (
    <WebView
      ref={web}
      style={StyleSheet.absoluteFill}
      originWhitelist={['*']}
      // Адрес страницы — им можно ограничить ключ в кабинете Яндекса (HTTP Referer).
      source={{ html, baseUrl: 'https://tropa.app/' }}
      onMessage={onMessage}
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
      onError={(e: { nativeEvent: { description: string } }) => p.onError?.(e.nativeEvent.description)}
    />
  );
});

export default YandexMap;
