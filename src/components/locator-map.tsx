import { useEffect, useEffectEvent, useRef } from 'react';
import type { LngLat } from '../geo';
import type { Locator } from '../locator';

type Props = {
  center: LngLat;
  bearing: number;
  onReady: (locator: Locator) => void;
  onMove: (center: LngLat, bearing: number) => void;
};

const coord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;

/** Hosts the MapLibre locator. It is created once, after MapLibre loads; the app drives it imperatively afterwards. */
export function LocatorMap({ center, bearing, onReady, onMove }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const moved = useEffectEvent(onMove);
  // Reads the latest props, so a place picked while MapLibre is still loading isn't lost.
  const create = useEffectEvent((createLocator: typeof import('../locator').createLocator) => {
    const locator = createLocator(box.current!, center, bearing, (c, b) => moved(c, b));
    onReady(locator);
    return locator;
  });

  useEffect(() => {
    // MapLibre is most of the app's code; load it on its own so the rest of the page and the first drawing don't wait.
    let locator: Locator | undefined;
    let cancelled = false;
    void import('../locator').then(({ createLocator }) => {
      if (!cancelled) locator = create(createLocator);
    });
    return () => {
      cancelled = true;
      locator?.map.remove();
    };
  }, []);

  return (
    <figure className="m-0 overflow-hidden rounded-lg border border-input bg-card">
      <div ref={box} className="locator h-[244px] bg-muted" />
      <figcaption className="readout flex h-8 items-center justify-between gap-3 border-t border-input px-3 text-[11px] text-muted-foreground">
        <span>
          {coord(center[1], 'N', 'S')}&ensp;{coord(center[0], 'E', 'W')}
        </span>
        <span className="flex items-center gap-1.5" title="Compass direction that points up the sheet">
          <svg aria-hidden viewBox="0 0 12 12" className="size-3" style={{ transform: `rotate(${-bearing}deg)` }}>
            <path d="M6 1 L8.5 10 L6 8.2 L3.5 10 Z" fill="var(--signal)" />
          </svg>
          {Math.round(bearing)}°
        </span>
      </figcaption>
    </figure>
  );
}
