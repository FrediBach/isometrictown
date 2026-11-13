import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { LngLat } from './geo';

maplibregl.setWorkerUrl(workerUrl);

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

export type Locator = {
  map: maplibregl.Map;
  /** Move the map without reporting it back as a user move. */
  setView(center: LngLat, bearing: number): void;
  setFootprint(corners: LngLat[]): void;
  fit(corners: LngLat[], bearing: number): void;
};

/** A small map for choosing what to draw. The outline shows the ground that lands on the sheet. */
export function createLocator(container: HTMLElement, center: LngLat, bearing: number, onMove: (center: LngLat, bearing: number) => void): Locator {
  const map = new maplibregl.Map({
    container,
    style: STYLE_URL,
    center,
    bearing,
    zoom: 14,
    minZoom: 10,
    maxZoom: 18,
    pitchWithRotate: false,
    attributionControl: { compact: true },
  });
  map.touchPitch.disable();
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-right');

  let footprint: GeoJSON.Feature<GeoJSON.Polygon> = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[]] } };
  const source = () => map.getSource('frame') as maplibregl.GeoJSONSource | undefined;

  map.on('load', () => {
    map.addSource('frame', { type: 'geojson', data: footprint });
    map.addLayer({ id: 'frame-fill', type: 'fill', source: 'frame', paint: { 'fill-color': '#d42f3a', 'fill-opacity': 0.07 } });
    map.addLayer({ id: 'frame-line', type: 'line', source: 'frame', paint: { 'line-color': '#d42f3a', 'line-width': 2 } });
  });

  // Programmatic moves are quiet; anything else (drag, wheel, compass button) is reported.
  let quiet = false;
  map.on('moveend', () => {
    if (quiet) return;
    const c = map.getCenter();
    onMove([c.lng, c.lat], map.getBearing());
  });

  return {
    map,
    setView(c, b) {
      quiet = true;
      map.jumpTo({ center: c, bearing: b });
      quiet = false;
    },
    setFootprint(corners) {
      footprint = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]]] } };
      source()?.setData(footprint);
    },
    fit(corners, b) {
      const lngs = corners.map((c) => c[0]);
      const lats = corners.map((c) => c[1]);
      const bounds: maplibregl.LngLatBoundsLike = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ];
      const cam = map.cameraForBounds(bounds, { padding: 24, bearing: b });
      if (cam?.zoom === undefined) return;
      quiet = true;
      map.jumpTo({ zoom: cam.zoom, bearing: b });
      quiet = false;
    },
  };
}
