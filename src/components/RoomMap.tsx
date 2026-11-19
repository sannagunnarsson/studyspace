import { useEffect, useRef, useState } from 'react';
import type { AvailabilityStatus } from '../utils/availability';
import geometry from '../data/roomGeometry.json';

/*
 * Indoor map of Ångströmslaboratoriet from MazeMap (Uppsala University campus 49).
 * Room outlines are pre-fetched into roomGeometry.json and coloured by availability.
 * The MazeMap JS API is loaded on demand, so the schedule view works without it.
 */

const MAZEMAP = 'https://api.mazemap.com/js/v2.2.4/mazemap.min';
const CAMPUS_ID = 49;
const CENTER = { lng: 17.6474, lat: 59.8391 }; // middle of the Ångström complex
const ROOMS = geometry as unknown as Record<string, { z: number; floor: string; polygon: [number, number][] }>;
// Floors that have rooms in the app, top floor first (like a lift panel).
// Start on the entrance floor (0), which has most of the study rooms.
const START_Z = 1;
const FLOORS = [...new Map(Object.values(ROOMS).map((r) => [r.z, { z: r.z, name: r.floor }])).values()].sort((a, b) => b.z - a.z);

// Minimal surface of the MazeMap/Mapbox API that this component uses.
interface MapLike {
  on(event: string, layerOrFn: unknown, fn?: (e: { features?: { properties: { id: string } }[] }) => void): void;
  addSource(id: string, source: object): void;
  addLayer(layer: object): void;
  getSource(id: string): { setData(data: object): void } | undefined;
  setFilter(layer: string, filter: unknown[]): void;
  setZLevel(z: number): void;
  flyTo(opts: object): void;
  getCanvas(): HTMLCanvasElement;
  isStyleLoaded(): boolean;
  getStyle(): { layers?: { id: string; type: string }[] };
  moveLayer(id: string, beforeId?: string): void;
  zLevel: number;
  remove(): void;
}
declare global {
  interface Window {
    Mazemap?: {
      Map: new (opts: object) => MapLike;
    };
  }
}

let loader: Promise<NonNullable<Window['Mazemap']>> | null = null;
function loadMazemap() {
  if (window.Mazemap) return Promise.resolve(window.Mazemap);
  loader ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${MAZEMAP}.css`;
    const script = document.createElement('script');
    script.src = `${MAZEMAP}.js`;
    script.onload = () => (window.Mazemap ? resolve(window.Mazemap) : reject(new Error('MazeMap did not load')));
    script.onerror = () => {
      loader = null;
      reject(new Error('MazeMap could not be reached'));
    };
    document.head.append(css, script);
  });
  return loader;
}

const STATUS_VAR: Record<AvailabilityStatus, string> = {
  FREE_LONG: '--free',
  FREE_SHORT: '--short',
  STARTING_SOON: '--soon',
  OCCUPIED: '--busy',
};

const centroid = (poly: [number, number][]) => {
  const pts = poly.slice(0, -1);
  return pts.reduce((acc, [x, y]) => ({ lng: acc.lng + x / pts.length, lat: acc.lat + y / pts.length }), { lng: 0, lat: 0 });
};

export interface MapRoom {
  id: string;
  status: AvailabilityStatus;
}

export function RoomMap({
  rooms,
  selectedId,
  onSelect,
}: {
  rooms: MapRoom[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLike | null>(null);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [floorZ, setFloorZ] = useState(START_Z);
  const [compact, setCompact] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    loadMazemap()
      .then((Mazemap) => {
        if (cancelled || !containerRef.current) return;
        const compact = containerRef.current.offsetWidth < 560 || containerRef.current.offsetHeight < 420;
        setCompact(compact);
        const map = new Mazemap.Map({
          container: containerRef.current,
          campuses: CAMPUS_ID,
          center: CENTER,
          zoom: compact ? 16.7 : 16.9, // MazeMap hides indoor floors below ~16.6
          zLevel: START_Z,
          zLevelControl: false,
        });
        mapRef.current = map;
        const syncFloor = () => {
          // MazeMap may not report a floor until its campus data has loaded.
          const z = typeof map.zLevel === 'number' ? map.zLevel : START_Z;
          setFloorZ(z);
          for (const layer of ['rooms-fill', 'rooms-outline']) {
            map.setFilter(layer, ['all', ['==', ['get', 'z'], z], ['has', 'color']]);
          }
        };
        // Add our layers as soon as the base style is ready instead of waiting for
        // 'load' (which waits for every tile and icon and can take 10+ s).
        const setup = () => {
          if (map.getSource('rooms')) return;
          // isStyleLoaded() can stay false for good when MazeMap's style references icons
          // that never load, so just try, and retry on the next style event if it's too early.
          try {
            map.addSource('rooms', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          } catch {
            return;
          }
          map.addLayer({
            id: 'rooms-fill',
            type: 'fill',
            source: 'rooms',
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.7 },
          });
          map.addLayer({
            id: 'rooms-outline',
            type: 'line',
            source: 'rooms',
            paint: { 'line-color': '#17201c', 'line-width': ['case', ['get', 'selected'], 3, 0.75] },
          });
          syncFloor();
          map.on('zlevel', syncFloor);
          // MazeMap adds its own room fills after load (and per floor). Keep our status
          // colours above every fill/line layer, but below the text labels and icons.
          const keepOnTop = () => {
            const layers = map.getStyle().layers ?? [];
            const ours = layers.findIndex((l) => l.id === 'rooms-fill');
            if (ours < 0) return;
            const covered = layers.slice(ours).some((l) => !l.id.startsWith('rooms-') && l.type !== 'symbol');
            if (!covered) return;
            const firstLabelAfter = layers.slice(ours).find(
              (l, i, rest) => l.type === 'symbol' && rest.slice(i).every((x) => x.type === 'symbol' || x.id.startsWith('rooms-')),
            );
            for (const id of ['rooms-fill', 'rooms-outline']) map.moveLayer(id, firstLabelAfter?.id);
          };
          keepOnTop();
          map.on('styledata', keepOnTop);
          map.on('click', 'rooms-fill', (e) => {
            const id = e.features?.[0]?.properties.id;
            if (id) onSelectRef.current(id);
          });
          map.on('mouseenter', 'rooms-fill', () => (map.getCanvas().style.cursor = 'pointer'));
          map.on('mouseleave', 'rooms-fill', () => (map.getCanvas().style.cursor = ''));
          setReady(true);
        };
        map.on('style.load', setup);
        map.on('styledata', setup);
        map.on('load', setup);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Recolour rooms whenever availability or selection changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const css = getComputedStyle(document.documentElement);
    map.getSource('rooms')?.setData({
      type: 'FeatureCollection',
      features: rooms
        .filter((r) => ROOMS[r.id])
        .map((r) => ({
          type: 'Feature',
          properties: {
            id: r.id,
            z: ROOMS[r.id].z,
            color: css.getPropertyValue(STATUS_VAR[r.status]).trim(),
            selected: r.id === selectedId,
          },
          geometry: { type: 'Polygon', coordinates: [ROOMS[r.id].polygon] },
        })),
    });
  }, [ready, rooms, selectedId]);

  // Bring the selected room into view on its floor.
  useEffect(() => {
    const map = mapRef.current;
    const room = selectedId ? ROOMS[selectedId] : null;
    if (!ready || !map || !room) return;
    map.setZLevel(room.z);
    map.flyTo({ center: centroid(room.polygon), zoom: 19.5, duration: 600 });
  }, [ready, selectedId]);

  const selectedOffMap = selectedId && !ROOMS[selectedId];
  const freeOn = (z: number) =>
    rooms.filter((r) => ROOMS[r.id]?.z === z && r.status !== 'OCCUPIED').length;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-surface shadow-float">
      {/* MazeMap's CSS sets position: relative on the container, so size it via a wrapper. */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" aria-label="Map of Ångströmslaboratoriet" role="region" />
      </div>
      {!ready && !error && (
        <p role="status" className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-surface px-3 py-1.5 text-xs text-muted shadow-float">
          Loading map…
        </p>
      )}
      {error && (
        <div role="status" className="absolute inset-0 grid place-items-center p-6 text-center text-sm">
          <p>
            <strong className="block font-semibold">The map couldn't load.</strong>
            <span className="text-muted">{error}. Switch to Schedule to see all rooms.</span>
          </p>
        </div>
      )}
      {ready && compact && (
        <label className="absolute bottom-8 left-3 flex h-9 items-center rounded-lg bg-surface pl-3 pr-1 text-sm font-medium shadow-float">
          <span className="sr-only">Floor</span>
          <select
            value={floorZ}
            onChange={(e) => mapRef.current?.setZLevel(Number(e.target.value))}
            className="h-full bg-transparent pr-1 outline-none"
          >
            {FLOORS.map((f) => (
              <option key={f.z} value={f.z}>
                Floor {f.name} · {freeOn(f.z)} free
              </option>
            ))}
          </select>
        </label>
      )}
      {ready && !compact && (
        <div
          role="group"
          aria-label="Floor"
          className="absolute bottom-8 left-3 flex flex-col overflow-hidden rounded-lg bg-surface text-sm shadow-float"
        >
          {FLOORS.map((f) => (
            <button
              key={f.z}
              type="button"
              aria-pressed={floorZ === f.z}
              aria-label={`Floor ${f.name}`}
              title={`Floor ${f.name}: ${freeOn(f.z)} free rooms`}
              onClick={() => mapRef.current?.setZLevel(f.z)}
              className={`flex h-9 min-w-11 items-center justify-center gap-1.5 px-2 font-medium tabular-nums ${
                floorZ === f.z ? 'bg-ink text-paper' : 'hover:bg-paper'
              }`}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}
      {selectedOffMap && (
        <p role="status" className="absolute left-3 top-3 rounded-md bg-surface px-3 py-2 text-xs shadow-float">
          This room isn't on the map yet.
        </p>
      )}
    </div>
  );
}
