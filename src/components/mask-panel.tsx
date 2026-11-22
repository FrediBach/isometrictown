import { useId } from 'react';
import { ArrowDownIcon, ArrowUpIcon, CircleIcon, CopyIcon, FlipHorizontal2Icon, FlipVertical2Icon, EyeIcon, EyeOffIcon, PentagonIcon, RectangleHorizontalIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Segmented } from '@/components/ui/segmented';
import { Slider } from '@/components/ui/slider';
import { ToggleKey } from '@/components/ui/toggle-key';
import { cn } from '@/lib/utils';
import { FORMAT, patternLabel } from '../app/model';
import { useSettings } from '../app/settings-context';
import { duplicateMask, FEATHER_MAX, mainValue, mirrorMask, MASK_SWITCHES, MASKS_MAX, TINT_MODES, newMask, NO_SPACE, type ImageMask, type MaskKey, type MaskShape, type MaskSwitch, type SourceTint } from '../image-masks';
import { Caption, Hint, KeyGrid } from './fields';

const SHAPES: { shape: MaskShape; label: string; Icon: typeof CircleIcon }[] = [
  { shape: 'ellipse', label: 'Ellipse', Icon: CircleIcon },
  { shape: 'rect', label: 'Rectangle', Icon: RectangleHorizontalIcon },
  { shape: 'polygon', label: 'Polygon', Icon: PentagonIcon },
];
const SHAPE_NAME: Record<MaskShape, string> = { ellipse: 'Ellipse', rect: 'Rectangle', polygon: 'Polygon' };

type DialKey = Exclude<MaskKey, MaskSwitch>;

/** How each setting a mask can change shows in the panel, in the words of its own control. */
const FIELDS: Record<DialKey, { label: string; min: number; max: number; step: number }> = {
  imageLight: { label: 'Brightness', min: -1, max: 1, step: 0.05 },
  imageContrast: { label: 'Contrast', min: 0.5, max: 2, step: 0.05 },
  likeness: { label: 'Likeness', min: 0, max: 1, step: 0.01 },
  imageTownBias: { label: 'Countryside ↔ town', min: -1, max: 1, step: 0.01 },
  imageDistrictSize: { label: 'District size', min: 0.5, max: 2, step: 0.01 },
  imageWater: { label: 'Water preference', min: -1, max: 1, step: 0.01 },
  imageStreetSpacing: { label: 'Street spacing', min: 0.5, max: 2, step: 0.01 },
  imageNeighbours: { label: 'Neighbourhoods as in real towns', min: 0, max: 1, step: 0.01 },
  fabric: { label: 'Street pattern', min: 0, max: 1, step: 0.01 },
  imageContours: { label: 'Streets follow image lines', min: 0, max: 1, step: 0.01 },
  imageRoundabouts: { label: 'More roundabouts', min: 0, max: 2, step: 0.01 },
  imageRelief: { label: 'Height from image', min: 0, max: 1, step: 0.01 },
  buildingDensity: { label: 'Building density', min: -1, max: 1, step: 0.01 },
  imageDensity: { label: 'Building density from image', min: -1, max: 1, step: 0.01 },
  imageHatching: { label: 'Hatching from image', min: 0, max: 1, step: 0.01 },
  imageFloorplans: { label: 'House floorplans follow image lines', min: 0, max: 1, step: 0.01 },
  // Beyond 100% on this dial is off: nothing is kept blank.
  imageHighlight: { label: 'Preserve empty space', min: 0, max: 1.05, step: 0.01 },
  heightScale: { label: 'Building height', min: 0.5, max: 3, step: 0.05 },
  pitched: { label: 'Pitched roofs', min: 0, max: 1, step: 0.01 },
  trees: { label: 'Trees', min: 0, max: 1, step: 0.01 },
  cars: { label: 'Traffic', min: 0, max: 1, step: 0.01 },
  abandon: { label: 'Abandonment', min: 0, max: 1, step: 0.01 },
  humanize: { label: 'Humanize', min: 0, max: 1, step: 0.01 },
};

/** The on/off settings a mask can set, in the words of their keys. */
const SWITCHES: Record<MaskSwitch, string> = { windows: 'Windows', roofHatch: 'Roof hatching', rooftops: 'Rooftop boxes', details: 'Roof details', shadeWalls: 'Shade walls' };

/** The groups the mask's settings are listed in. */
const GROUPS: { caption: string; keys: MaskKey[] }[] = [
  { caption: 'Image', keys: ['imageLight', 'imageContrast', 'likeness', 'imageNeighbours', 'imageTownBias', 'imageDistrictSize', 'imageWater'] },
  { caption: 'Streets', keys: ['fabric', 'imageStreetSpacing', 'imageContours', 'imageRoundabouts'] },
  { caption: 'Town from the image', keys: ['imageRelief', 'imageDensity', 'imageHatching', 'imageFloorplans', 'imageHighlight'] },
  { caption: 'Buildings', keys: ['buildingDensity', 'heightScale', 'pitched', 'windows', 'roofHatch', 'rooftops', 'details', 'shadeWalls'] },
  { caption: 'Town', keys: ['trees', 'cars', 'abandon', 'humanize'] },
];

const isSwitch = (k: MaskKey): k is MaskSwitch => (MASK_SWITCHES as readonly MaskKey[]).includes(k);
const showValue = (key: DialKey, v: number) => (key === 'fabric' ? patternLabel(v) : key === 'imageHighlight' && v > 1 ? 'Off' : FORMAT[key](v));

const TEXT_BUTTON = 'rounded-sm text-[12px] underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40';
const ICON_BUTTON = 'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5';

type Props = {
  /** The picture's size in pixels, so a new mask is round on it; null while there is none. */
  picture: { w: number; h: number } | null;
  /** The mask being edited, if any. */
  selected: string | null;
  onSelect: (id: string | null) => void;
};

/**
 * Masks over parts of the picture, each with its own values for some of the settings: a list to
 * pick, hide, reorder and remove them, keys to add one of each shape, and the settings of the
 * mask being edited. Its shape is edited over the preview.
 */
export function MaskPanel({ picture, selected, onSelect }: Props) {
  const { set, change } = useSettings();
  const masks = set.imageMasks;
  const mask = masks.find((m) => m.id === selected);
  const update = (m: ImageMask, fromSlider = false) => change('imageMasks', masks.map((o) => (o.id === m.id ? m : o)), fromSlider);

  function add(shape: MaskShape): void {
    if (!picture) return;
    const m = newMask(shape, masks, picture.w, picture.h);
    change('imageMasks', [...masks, m]);
    onSelect(m.id);
  }

  function remove(id: string): void {
    change('imageMasks', masks.filter((m) => m.id !== id));
    if (id === selected) onSelect(null);
  }

  /** A copy just after the original, selected. */
  function duplicate(m: ImageMask): void {
    if (!picture || masks.length >= MASKS_MAX) return;
    const copy = duplicateMask(m, masks, picture.w, picture.h);
    const i = masks.indexOf(m);
    change('imageMasks', [...masks.slice(0, i + 1), copy, ...masks.slice(i + 1)]);
    onSelect(copy.id);
  }

  function shift(id: string, by: number): void {
    const i = masks.findIndex((m) => m.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= masks.length) return;
    const next = masks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    change('imageMasks', next);
  }

  return (
    <div>
      {masks.length > 0 && (
        <ul className="m-0 mb-2 list-none border-t p-0">
          {masks.map((m, i) => {
            const changed = Object.keys(m.values).length + Number(!!m.tint);
            const on = m.id === selected;
            return (
              <li key={m.id} className={cn('flex items-center gap-1 border-b py-1', on && 'bg-muted/60')}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(on ? null : m.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-sm px-1.5 py-1 text-left text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full ring-1', on ? 'bg-signal ring-signal' : 'ring-input')} />
                  <span className={cn('truncate', m.off && 'text-muted-foreground line-through')}>
                    {SHAPE_NAME[m.shape]} {i + 1}
                  </span>
                  <span className="readout ml-auto shrink-0 text-[11px] text-muted-foreground">{changed ? `${changed} set` : 'nothing set'}</span>
                </button>
                <button type="button" className={ICON_BUTTON} aria-label={m.off ? `Show ${SHAPE_NAME[m.shape].toLowerCase()} ${i + 1}` : `Hide ${SHAPE_NAME[m.shape].toLowerCase()} ${i + 1}`} title={m.off ? 'Show in the drawing' : 'Leave out of the drawing'} onClick={() => update({ ...m, off: !m.off })}>
                  {m.off ? <EyeOffIcon /> : <EyeIcon />}
                </button>
                <button type="button" className={ICON_BUTTON} aria-label={`Remove ${SHAPE_NAME[m.shape].toLowerCase()} ${i + 1}`} title="Remove" onClick={() => remove(m.id)}>
                  <Trash2Icon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        {SHAPES.map(({ shape, label, Icon }) => (
          <button
            key={shape}
            type="button"
            disabled={!picture || masks.length >= MASKS_MAX}
            onClick={() => add(shape)}
            className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-input bg-card px-2 text-[13px] outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
          >
            <Icon aria-hidden />
            {label}
          </button>
        ))}
      </div>
      {!mask && (
        <Hint className="mt-2">
          {masks.length
            ? 'Pick a mask to edit its shape over the preview and set what changes inside it.'
            : 'Add a mask to set some of these settings differently in part of the picture. Inside it the mask’s settings apply, outside the drawing’s, and across its soft edge they mix.'}
        </Hint>
      )}
      {mask && <MaskSettings key={mask.id} mask={mask} index={masks.indexOf(mask)} count={masks.length} update={update} shift={(by) => shift(mask.id, by)} onDuplicate={picture && masks.length < MASKS_MAX ? () => duplicate(mask) : undefined} onDone={() => onSelect(null)} />}
    </div>
  );
}

type MaskSettingsProps = {
  mask: ImageMask;
  index: number;
  count: number;
  update: (m: ImageMask, fromSlider?: boolean) => void;
  shift: (by: number) => void;
  /** Copies the mask; missing when no more masks fit. */
  onDuplicate?: () => void;
  onDone: () => void;
};

/** The edge, strength and settings of the mask being edited. */
function MaskSettings({ mask, index, count, update, shift, onDuplicate, onDone }: MaskSettingsProps) {
  const { set } = useSettings();
  const short = 'min-w-0 flex-1';
  return (
    <div className="mt-3 rounded-md border bg-card/60 px-3 pt-2.5 pb-1">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">
          {SHAPE_NAME[mask.shape]} {index + 1}
        </span>
        <span className="flex items-baseline gap-3 text-muted-foreground">
          <button type="button" className={cn(TEXT_BUTTON, 'no-underline')} disabled={index === 0} onClick={() => shift(-1)} aria-label="Move up, under the masks after it" title="Earlier: masks later in the list mix over it">
            <ArrowUpIcon aria-hidden className="inline size-3.5" />
          </button>
          <button type="button" className={cn(TEXT_BUTTON, 'no-underline')} disabled={index === count - 1} onClick={() => shift(1)} aria-label="Move down, over the masks before it" title="Later: it mixes over the masks before it">
            <ArrowDownIcon aria-hidden className="inline size-3.5" />
          </button>
          <button type="button" className={cn(TEXT_BUTTON, 'no-underline')} disabled={!onDuplicate} onClick={onDuplicate} aria-label="Duplicate" title="Duplicate: a copy just after this one, to move or mirror">
            <CopyIcon aria-hidden className="inline size-3.5" />
          </button>
          <button type="button" className={cn(TEXT_BUTTON, 'no-underline')} onClick={() => update(mirrorMask(mask, 'x'))} aria-label="Mirror left to right" title="Mirror left to right across the picture">
            <FlipHorizontal2Icon aria-hidden className="inline size-3.5" />
          </button>
          <button type="button" className={cn(TEXT_BUTTON, 'no-underline')} onClick={() => update(mirrorMask(mask, 'y'))} aria-label="Mirror top to bottom" title="Mirror top to bottom across the picture">
            <FlipVertical2Icon aria-hidden className="inline size-3.5" />
          </button>
          <button type="button" className={cn(TEXT_BUTTON, 'text-foreground')} onClick={onDone}>
            Done
          </button>
        </span>
      </div>
      <Hint className="mt-0">
        {mask.shape === 'polygon'
          ? 'Drag the shape on the preview to move it and its corners to reshape it. Pull the dot in a side to add a corner; double-click a corner to remove it.'
          : 'Drag the shape on the preview to move it, its handles to size it, and the handle on the stem to turn it (Shift for steps of 15°), or set Turn below.'}
      </Hint>
      <Dial label="Feather" value={mask.feather} min={0} max={FEATHER_MAX} step={0.005} display={`${Math.round((mask.feather / FEATHER_MAX) * 100)}%`} onChange={(feather) => update({ ...mask, feather }, true)} />
      {mask.shape !== 'polygon' && <Dial label="Turn" value={mask.angle} min={-180} max={180} step={1} display={`${Math.round(mask.angle)}°`} onChange={(angle) => update({ ...mask, angle }, true)} />}
      {mask.shape !== 'ellipse' && <Dial label="Round corners" value={mask.round} min={0} max={1} step={0.01} display={`${Math.round(mask.round * 100)}%`} onChange={(round) => update({ ...mask, round }, true)} />}
      <Dial label="Amount" value={mask.amount} min={0} max={1} step={0.01} display={`${Math.round(mask.amount * 100)}%`} onChange={(amount) => update({ ...mask, amount }, true)} />
      <KeyGrid className="mt-1 mb-3">
        <ToggleKey pressed={mask.invert} onPressedChange={(invert) => update({ ...mask, invert })} className={short}>
          Invert
        </ToggleKey>
        <ToggleKey pressed={!mask.off} onPressedChange={(on) => update({ ...mask, off: !on })} className={short}>
          In the drawing
        </ToggleKey>
      </KeyGrid>
      <TintSettings tint={mask.tint} onChange={(tint, sliding) => update({ ...mask, tint }, sliding)} />
      {GROUPS.map(({ caption, keys }) => (
        <div key={caption}>
          <Caption className="mt-3">{caption}</Caption>
          {keys.map((key) => {
            const own = mask.values[key];
            const main = mainValue(set, key);
            const reset = () => {
              const values = { ...mask.values };
              delete values[key];
              update({ ...mask, values });
            };
            if (isSwitch(key)) {
              return <Switch key={key} label={SWITCHES[key]} own={own} main={main >= 0.5} onReset={reset} onChange={(on) => update({ ...mask, values: { ...mask.values, [key]: Number(on) } })} />;
            }
            const f = FIELDS[key];
            const value = own ?? main;
            return (
              <Dial
                key={key}
                label={f.label}
                value={Math.min(f.max, value)}
                min={f.min}
                max={f.max}
                step={f.step}
                display={showValue(key, value)}
                inherited={own === undefined}
                onReset={own === undefined ? undefined : reset}
                onChange={(v) => update({ ...mask, values: { ...mask.values, [key]: key === 'imageHighlight' && v > 1 ? NO_SPACE : v } }, true)}
              />
            );
          })}
        </div>
      ))}
      <Hint className="mt-2">Settings shown in grey follow the drawing’s own. Scale, view, colour sensitivity, style, light and pens are the drawing’s everywhere.</Hint>
    </div>
  );
}

type SwitchProps = { label: string; own: number | undefined; main: boolean; onReset: () => void; onChange: (on: boolean) => void };

/** An on/off setting inside a mask: following the drawing's, or on or off whatever the drawing has. */
function Switch({ label, own, main, onReset, onChange }: SwitchProps) {
  const value = own === undefined ? 'follow' : own >= 0.5 ? 'on' : 'off';
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className={cn('min-w-0 truncate text-[13px]', own === undefined && 'text-muted-foreground')}>{label}</span>
      <Segmented
        aria-label={label}
        value={value}
        onValueChange={(v) => (v === 'follow' ? onReset() : onChange(v === 'on'))}
        className="h-7 shrink-0"
        items={[
          { value: 'follow', label: main ? 'As on' : 'As off', title: `Follow the drawing, which has it ${main ? 'on' : 'off'}` },
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
      />
    </div>
  );
}

/** A solid colour blended into the source picture under this mask. */
function TintSettings({ tint, onChange }: { tint?: SourceTint; onChange: (tint?: SourceTint, sliding?: boolean) => void }) {
  if (!tint) return (
    <button type="button" className={TEXT_BUTTON} onClick={() => onChange({ colour: '#4794c4', mode: 'Colour', amount: 0.5 })}>
      Add source tint
    </button>
  );
  return (
    <div className="mb-3 border-y py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Caption>Source tint</Caption>
        <button type="button" className={TEXT_BUTTON} onClick={() => onChange()}>Remove tint</button>
      </div>
      <label className="mb-2 flex items-center justify-between gap-2 text-[13px]">
        Tint colour
        <input type="color" className="swatch" value={tint.colour} onChange={e => onChange({ ...tint, colour: e.currentTarget.value }, true)} />
      </label>
      <div className="mb-2 flex items-center justify-between gap-2 text-[13px]">
        <span>Blend mode</span>
        <Select value={tint.mode} onValueChange={v => onChange({ ...tint, mode: v as SourceTint['mode'] })}>
          <SelectTrigger aria-label="Blend mode" className="h-8 bg-card"><SelectValue /></SelectTrigger>
          <SelectContent>{TINT_MODES.map(mode => <SelectItem key={mode} value={mode}>{mode}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Dial label="Tint amount" value={tint.amount} min={0} max={1} step={0.01} display={FORMAT.imageColour(tint.amount)} onChange={amount => onChange({ ...tint, amount }, true)} />
      <Hint>Blends colour into the picture before the town is laid out. Use the Image overlay to see the tinted source.</Hint>
    </div>
  );
}

type DialProps = { label: string; value: number; min: number; max: number; step: number; display: string; inherited?: boolean; onReset?: () => void; onChange: (v: number) => void };

/** A slider as the panel's own, with its readout in grey while it follows the drawing and a key to go back to it. */
function Dial({ label, value, min, max, step, display, inherited = false, onReset, onChange }: DialProps) {
  const id = useId();
  return (
    <div className="mb-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span id={id} className={cn('min-w-0 truncate text-[13px]', inherited && 'text-muted-foreground')}>
          {label}
        </span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          {onReset && (
            <button type="button" onClick={onReset} className="self-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`${label}: follow the drawing`} title="Follow the drawing’s own setting">
              <RotateCcwIcon aria-hidden className="size-3" />
            </button>
          )}
          <output className={cn('readout', inherited ? 'text-muted-foreground' : 'text-foreground')}>{display}</output>
        </span>
      </div>
      <Slider className={cn('mt-0.5', inherited && 'opacity-60')} aria-labelledby={id} value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}
