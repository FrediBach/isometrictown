import { useState } from 'react';
import { ShuffleIcon } from 'lucide-react';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { LngLat } from '../geo';
import type { Locator } from '../locator';
import type { RenderResult } from '../app/renderer';
import { FORMAT, MONO_INK, PRESETS, type BoolKey } from '../app/model';
import { useSettings } from '../app/settings-context';
import { useNativeChange } from '../app/use-native-change';
import { currentPalette } from '../palettes';
import { PEN_NAMES, PEN_ROLES, SHEETS, type Settings, type SheetId } from '../settings';
import { STYLE_IDS, STYLES } from '../styles';
import { BoolSetting, NumberSetting } from './controls';
import { Caption, FoldingSection, Hint, KeyGrid, Section } from './fields';
import { LocatorMap } from './locator-map';
import { PalettePicker } from './palette-picker';
import { PlaceSearch } from './place-search';
import { PenDot } from './title-block';

const SEP = ' · ';

type PlaceSectionProps = {
  onGoTo: (center: LngLat, name: string, extra?: Partial<Settings>) => void;
  onMapMove: (center: LngLat, bearing: number) => void;
  onMapReady: (locator: Locator) => void;
};

export function PlaceSection({ onGoTo, onMapMove, onMapReady }: PlaceSectionProps) {
  const { set } = useSettings();
  return (
    <Section index={1} title="Place">
      <PlaceSearch onPick={(center, name) => onGoTo(center, name)} />
      <div className="mt-3 mb-3.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="micro mr-0.5">Try</span>
        {PRESETS.map((p) => {
          const current = set.place === p.name;
          return (
            <button
              key={p.name}
              type="button"
              aria-current={current || undefined}
              onClick={() => onGoTo(p.center, p.name, { bearing: p.bearing, scale: p.scale })}
              className={cn(
                'rounded-sm py-0.5 text-[13px] underline decoration-1 underline-offset-[5px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                current ? 'text-foreground decoration-signal decoration-2' : 'text-muted-foreground decoration-input hover:text-foreground hover:decoration-foreground',
              )}
            >
              {p.name}
            </button>
          );
        })}
      </div>
      <LocatorMap center={set.center} bearing={set.bearing} onMove={onMapMove} onReady={onMapReady} />
      <Hint className="mt-2 mb-0">Drag the map to move. Right-drag or use the compass to turn. The red outline is the ground that lands on the sheet.</Hint>
    </Section>
  );
}

export function ViewSection() {
  const { set } = useSettings();
  return (
    <FoldingSection index={2} title="View" defaultOpen summary={[FORMAT.bearing(set.bearing), FORMAT.tilt(set.tilt), FORMAT.scale(set.scale)].join(SEP)}>
      <NumberSetting name="bearing" label="Rotation" min={0} max={359} step={1} />
      <NumberSetting name="tilt" label="Tilt" min={20} max={60} step={1} hint="How high you look from. 30° is the classic isometric look." />
      <NumberSetting name="scale" label="Scale" min={0} max={1000} step={1} hint="Bigger towns need a smaller scale. Small scales skip windows." />
      <NumberSetting name="heightScale" label="Building height" min={0.5} max={3} step={0.05} />
    </FoldingSection>
  );
}

const TOWN_KEYS: [BoolKey, string][] = [
  ['windows', 'Windows'],
  ['roofHatch', 'Roof hatching'],
  ['rooftops', 'Rooftop boxes'],
  ['details', 'Roof details'],
  ['osmTags', 'OSM roof tags'],
  ['lamps', 'Street lamps'],
  ['paths', 'Footpaths'],
  ['rails', 'Railways'],
  ['water', 'Water'],
  ['parks', 'Parks'],
  ['ground', 'Fields and gardens'],
];

export function TownSection({ region }: { region?: RenderResult['region'] }) {
  const { set, change } = useSettings();
  const autoStyle = region ? `Auto: ${STYLES[region.style].label} (${region.country})` : 'Auto, from the country';
  return (
    <FoldingSection index={3} title="Town" defaultOpen summary={`${TOWN_KEYS.filter(([k]) => set[k]).length} of ${TOWN_KEYS.length} layers`}>
      <Caption className="mt-0">Building style</Caption>
      <Select value={set.style} onValueChange={(v) => change('style', v as Settings['style'])}>
        <SelectTrigger aria-label="Building style" className="mb-1 h-9 w-full rounded-md bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-md">
          <SelectItem value="auto" className="rounded-[4px]">
            {autoStyle}
          </SelectItem>
          {STYLE_IDS.map((id) => (
            <SelectItem key={id} value={id} className="rounded-[4px]">
              {STYLES[id].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Hint>Roof shapes, pitches and details typical for the region. Auto picks them from the country.</Hint>
      <NumberSetting name="pitched" label="Pitched roofs" min={0} max={1} step={0.01} hint="How many houses get pitched roofs, compared with what is usual for the style." />
      <NumberSetting name="trees" label="Trees" min={0} max={1} step={0.01} />
      <NumberSetting name="cars" label="Parked cars" min={0} max={1} step={0.01} />
      <Caption className="mt-4">Layers</Caption>
      <KeyGrid className="mt-0">
        {TOWN_KEYS.map(([k, label]) => (
          <BoolSetting key={k} name={k} label={label} />
        ))}
      </KeyGrid>
    </FoldingSection>
  );
}

export function LightSection() {
  const { set } = useSettings();
  return (
    <FoldingSection index={4} title="Light" defaultOpen summary={set.shadows ? `Sun ${FORMAT.sunAngle(set.sunAngle)} at ${FORMAT.sunHeight(set.sunHeight)}` : 'No shadows'}>
      <KeyGrid className="mt-0 mb-4">
        <BoolSetting name="shadows" label="Shadows" />
        <BoolSetting name="shadeWalls" label="Shade walls" />
      </KeyGrid>
      <NumberSetting name="sunAngle" label="Sun direction" min={0} max={359} step={1} />
      <NumberSetting name="sunHeight" label="Sun height" min={12} max={75} step={1} hint="A low sun casts long shadows." />
    </FoldingSection>
  );
}

export function SheetSection() {
  const { set, change } = useSettings();
  return (
    <FoldingSection index={5} title="Sheet" summary={[SHEETS[set.sheet].label, set.landscape ? 'landscape' : 'portrait', FORMAT.margin(set.margin)].join(SEP)}>
      <div className="mb-4 flex gap-2">
        <Select value={set.sheet} onValueChange={(v) => change('sheet', v as SheetId)}>
          <SelectTrigger aria-label="Sheet size" className="h-9 min-w-0 flex-1 rounded-md bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-md">
            {Object.entries(SHEETS).map(([id, s]) => (
              <SelectItem key={id} value={id} className="rounded-[4px]">
                {s.label}
                <span className="readout text-[11px] text-muted-foreground">
                  {s.size[0]} × {s.size[1]}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Segmented
          aria-label="Orientation"
          value={String(set.landscape)}
          onValueChange={(v) => change('landscape', v === 'true')}
          items={[
            { value: 'true', title: 'Landscape', label: <OrientationIcon landscape /> },
            { value: 'false', title: 'Portrait', label: <OrientationIcon /> },
          ]}
        />
      </div>
      <NumberSetting name="margin" label="Margin" min={5} max={60} step={1} />
      <KeyGrid>
        <BoolSetting name="frame" label="Frame line" />
        <BoolSetting name="marginalia" label="Map notes" />
      </KeyGrid>
      <Hint className="mt-2 mb-0">
        Map notes letter the margin like a printed town map: title, coordinates, scale bar and north arrow. With the frame line on, a second border carries latitude and longitude ticks. A wider
        margin gives them more room.
      </Hint>
    </FoldingSection>
  );
}

function OrientationIcon({ landscape = false }: { landscape?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      {landscape ? <rect x="1.5" y="4" width="13" height="8.5" rx="1" /> : <rect x="3.75" y="1.5" width="8.5" height="13" rx="1" />}
    </svg>
  );
}

type PensSectionProps = {
  /** Replace every pen at once and redraw. */
  onPalette: (pens: Settings['pens']) => void;
  /** Live-update one pen while its picker is open. */
  onPen: (index: number, color: string) => void;
  /** A pen edit was committed; redraw. */
  onPenCommit: () => void;
};

export function PensSection({ onPalette, onPen, onPenCommit }: PensSectionProps) {
  const { set } = useSettings();
  const paletteName = currentPalette(set.pens)?.name ?? 'Custom';
  return (
    <FoldingSection
      index={6}
      title="Pens"
      summary={
        <span className="inline-flex items-center gap-2">
          {[set.mono ? 'One pen' : paletteName, FORMAT.penWidth(set.penWidth)].join(SEP)}
          <span className="inline-flex gap-0.5">
            {(set.mono ? [MONO_INK] : set.pens).map((c, i) => (
              <PenDot key={PEN_NAMES[i]} color={c} size={9} />
            ))}
          </span>
        </span>
      }
    >
      <div className="mb-2 flex items-baseline justify-between">
        <Caption className="mb-0">Palette</Caption>
        <span className="readout text-[11px] text-muted-foreground">{paletteName}</span>
      </div>
      <PalettePicker pens={set.pens} disabled={set.mono} onPick={onPalette} />
      <Caption className="mt-4">Pens</Caption>
      <ol className={cn('m-0 mb-4 list-none overflow-hidden rounded-md border border-input bg-card p-0 transition-opacity', set.mono && 'opacity-45')}>
        {set.pens.map((color, i) => (
          <li key={PEN_NAMES[i]} className="border-b last:border-b-0">
            <label title={PEN_ROLES[i]} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/60">
              <span className="readout w-3 text-[11px] text-muted-foreground">{i + 1}</span>
              <PenSwatch color={color} label={`${PEN_NAMES[i]} pen colour`} onInput={(c) => onPen(i, c)} onCommit={onPenCommit} />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="text-[13px] font-medium">{PEN_NAMES[i]}</span>
                <span className="readout text-[11px] text-muted-foreground uppercase">{color}</span>
              </span>
            </label>
          </li>
        ))}
      </ol>
      <NumberSetting name="penWidth" label="Pen width" min={0.1} max={1} step={0.05} />
      <NumberSetting name="speed" label="Plot speed" min={10} max={120} step={5} />
      <KeyGrid>
        <BoolSetting name="mono" label="One black pen" />
      </KeyGrid>
    </FoldingSection>
  );
}

function PenSwatch({ color, label, onInput, onCommit }: { color: string; label: string; onInput: (c: string) => void; onCommit: () => void }) {
  const ref = useNativeChange<HTMLInputElement>(onCommit);
  return <input ref={ref} type="color" className="swatch" value={color} aria-label={label} onChange={(e) => onInput(e.currentTarget.value)} />;
}

/** The seed field keeps its own draft so typing doesn't redraw until the edit is committed. */
export function SeedSection({ onSeed }: { onSeed: (seed: number) => void }) {
  const { set } = useSettings();
  const [draft, setDraft] = useState(String(set.seed));

  function apply(seed: number): void {
    setDraft(String(seed));
    onSeed(seed);
  }

  const input = useNativeChange<HTMLInputElement>((el) => {
    const v = Math.round(Number(el.value));
    apply(Number.isFinite(v) && v > 0 ? v : 1);
  });

  return (
    <Section index={7} title="Seed">
      <div className="flex h-10 items-stretch overflow-hidden rounded-md border border-input bg-card focus-within:border-foreground/40 focus-within:ring-3 focus-within:ring-ring/30">
        <span className="micro self-center pl-3">No.</span>
        <input
          ref={input}
          type="number"
          min={1}
          max={99999}
          step={1}
          aria-label="Seed"
          className="readout min-w-0 flex-1 bg-transparent px-2 text-[14px] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <button
          type="button"
          onClick={() => apply(1 + Math.floor(Math.random() * 99999))}
          className="m-1 flex items-center gap-1.5 rounded-[4px] border border-input bg-background px-3 text-[13px] font-medium transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.1)]"
        >
          <ShuffleIcon className="size-3.5" />
          Shuffle
        </button>
      </div>
      <Hint className="mt-2 mb-0">Picks which houses get pitched roofs and where trees and cars go.</Hint>
    </Section>
  );
}
