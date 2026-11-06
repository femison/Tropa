import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, Polygon, Polyline, UrlTile } from 'react-native-maps';
import { colors } from '../../theme';
import { BaseMapHandle, BaseMapProps } from './types';

// Подложка OpenStreetMap (стиль Humanitarian, серверы OSM France) — без ключа.
// CARTO требует API-ключ, а tile.openstreetmap.org блокирует приложения без своего User-Agent.
const TILES = 'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png';

/** Зум в духе Яндекса → размах региона для react-native-maps. */
const deltaForZoom = (zoom: number) => 360 / 2 ** zoom;

const OsmMap = forwardRef<BaseMapHandle, BaseMapProps>(function OsmMap(p, ref) {
  const map = useRef<MapView>(null);
  // На Android нажатие на линию приходит ещё и в onPress карты — его пропускаем.
  const lineTap = useRef(0);
  const tapStreet = (id: number) => {
    lineTap.current = Date.now();
    p.onStreetPress(id);
  };
  const tapPark = (key: string) => {
    lineTap.current = Date.now();
    p.onParkPress(key);
  };
  useImperativeHandle(ref, () => ({
    centerOn: (c, zoom = 16) => {
      const d = deltaForZoom(zoom);
      map.current?.animateToRegion({ ...c, latitudeDelta: d, longitudeDelta: d }, 500);
    },
  }));

  return (
    <MapView
      ref={map}
      style={StyleSheet.absoluteFill}
      mapType={Platform.OS === 'android' ? 'none' : 'standard'}
      showsUserLocation
      showsMyLocationButton={false}
      showsPointsOfInterests={false}
      toolbarEnabled={false}
      onPress={() => {
        if (Date.now() - lineTap.current > 400) p.onMapPress();
      }}
      onLongPress={(e) => p.onLongPress(e.nativeEvent.coordinate)}
      initialRegion={{ latitude: 55.751, longitude: 37.618, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
    >
      <UrlTile urlTemplate={TILES} maximumZ={19} shouldReplaceMapContent tileSize={256} />
      {p.parks.map((pk) =>
        pk.pieces.map((ring, i) => (
          <Polygon
            key={`${pk.key}-${i}`}
            coordinates={ring}
            fillColor={pk.captured ? colors.parkCapturedFill : colors.parkFill}
            strokeWidth={0}
            tappable
            onPress={() => tapPark(pk.key)}
          />
        )),
      )}
      {p.parks
        .filter((pk) => pk.captured)
        .map((pk) => (
          <Marker key={`cup-${pk.key}`} coordinate={pk.center} onPress={() => tapPark(pk.key)} anchor={{ x: 0.5, y: 0.5 }}>
            <Text style={{ fontSize: 22 }}>🏆</Text>
          </Marker>
        ))}
      {p.streets.map((s) => (
        <Polyline
          key={s.wayId}
          coordinates={s.coords}
          strokeColor={colors.street}
          strokeWidth={4}
          tappable
          onPress={() => tapStreet(s.wayId)}
        />
      ))}
      {p.walked.map((r) => (
        <Polyline
          key={r.key}
          coordinates={r.coords}
          strokeColor={colors.walked}
          strokeWidth={5}
          zIndex={2}
          tappable
          onPress={() => tapStreet(r.wayId)}
        />
      ))}
      {p.track.length > 1 && (
        <Polyline coordinates={p.track} strokeColor={colors.track} strokeWidth={3} zIndex={3} lineDashPattern={[6, 6]} />
      )}
      {p.photos.map((ph) => (
        <Marker
          key={`ph-${ph.id}`}
          coordinate={ph.p}
          anchor={{ x: 0.5, y: 0.5 }}
          zIndex={5}
          onPress={() => {
            lineTap.current = Date.now();
            p.onPhotoPress(ph.id);
          }}
        >
          <Image source={{ uri: ph.thumb }} style={osm.photo} />
        </Marker>
      ))}
      {p.questOptions.map((q) => (
        <Marker
          key={`q-${q.id}`}
          coordinate={q.target}
          anchor={{ x: 0.5, y: 1 }}
          zIndex={6}
          onPress={() => {
            lineTap.current = Date.now();
            p.onQuestPress(q.id);
          }}
        >
          <View style={[osm.badge, { backgroundColor: q.color }, q.chosen && osm.chosen]}>
            <Text style={osm.badgeText}>{q.text}</Text>
          </View>
        </Marker>
      ))}
      {p.places.map((pl) => (
        <Marker
          key={pl.id}
          coordinate={pl.p}
          pinColor={pl.relevant ? colors.quest : colors.track}
          onPress={() => {
            lineTap.current = Date.now();
            p.onPlacePress(pl.id);
          }}
        />
      ))}
      {p.quest && (
        <>
          {p.quest.park?.map((ring, i) => (
            <Polygon key={`qp-${i}`} coordinates={ring} strokeColor={colors.quest} strokeWidth={3} fillColor="rgba(112,72,232,0.12)" zIndex={1} />
          ))}
          {p.quest.street?.map((line, i) => (
            <Polyline key={`qs-${i}`} coordinates={line} strokeColor={colors.quest} strokeWidth={8} zIndex={1} />
          ))}
          <Circle
            center={p.quest.target}
            radius={p.quest.radius}
            strokeColor={colors.quest}
            fillColor="rgba(112,72,232,0.15)"
            zIndex={4}
          />
          <Marker coordinate={p.quest.target} pinColor={colors.quest} />
        </>
      )}
    </MapView>
  );
});

const osm = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 2, borderColor: '#fff' },
  chosen: { borderColor: colors.quest, borderWidth: 3 },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  photo: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, borderColor: '#fff' },
});

export default OsmMap;
