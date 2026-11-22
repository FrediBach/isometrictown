import { useId } from 'react';
import { EyeIcon, EyeOffIcon, Trash2Icon } from 'lucide-react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { useSettings } from '../app/settings-context';
import { isGround, newPin, pinName, PIN_GROUPS, PIN_KINDS, PIN_FEATHER_MAX, PIN_RADIUS, PINS_MAX, type ImagePin, type PinKindId, type PinOutcomes } from '../image-pins';
import { Hint } from './fields';
import { PIN_ICONS } from './pin-icons';

const TEXT_BUTTON = 'rounded-sm text-[12px] underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40';
const ICON_BUTTON = 'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5';

/** What became of a pin in the drawing on show, in a word. */
function outcome(pin: ImagePin, outcomes: PinOutcomes | undefined): { text: string; missed: boolean } {
  if (pin.off) return { text: 'hidden', missed: false };
  const made = outcomes?.[pin.id];
  if (made === undefined) return { text: '…', missed: false };
  return made ? { text: 'in the town', missed: false } : { text: 'no room', missed: true };
}

type Props = {
  /** The picture, so pins can be placed on it; null while there is none. */
  picture: { w: number; h: number } | null;
  /** The pin being edited, if any. */
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** What became of each pin in the drawing on show. */
  outcomes?: PinOutcomes;
};

/**
 * Things from the catalogue pinned to the picture, which the town is laid out round: a list to
 * pick, hide and remove them, a menu to add one of each kind, and the settings of the pin being
 * edited. Pins are dragged over the preview.
 */
export function PinPanel({ picture, selected, onSelect, outcomes }: Props) {
  const { set, change } = useSettings();
  const pins = set.imagePins;
  const pin = pins.find((p) => p.id === selected);
  const update = (p: ImagePin, fromSlider = false) => change('imagePins', pins.map((o) => (o.id === p.id ? p : o)), fromSlider);

  function add(kind: PinKindId): void {
    if (!picture || pins.length >= PINS_MAX) return;
    const p = newPin(kind, pins);
    change('imagePins', [...pins, p]);
    onSelect(p.id);
  }

  function remove(id: string): void {
    change('imagePins', pins.filter((p) => p.id !== id));
    if (id === selected) onSelect(null);
  }

  return (
    <div>
      {pins.length > 0 && (
        <ul className="m-0 mb-2 list-none border-t p-0">
          {pins.map((p) => {
            const on = p.id === selected;
            const Icon = PIN_ICONS[p.kind];
            const name = pinName(p, pins);
            const o = outcome(p, outcomes);
            return (
              <li key={p.id} className={cn('flex items-center gap-1 border-b py-1', on && 'bg-muted/60')}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(on ? null : p.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-sm px-1.5 py-1 text-left text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Icon aria-hidden className={cn('size-3.5 shrink-0', on ? 'text-signal' : 'text-muted-foreground')} />
                  <span className={cn('truncate', p.off && 'text-muted-foreground line-through')}>{name}</span>
                  <span className={cn('readout ml-auto shrink-0 text-[11px]', o.missed ? 'text-destructive' : 'text-muted-foreground')}>{o.text}</span>
                </button>
                <button type="button" className={ICON_BUTTON} aria-label={p.off ? `Show ${name}` : `Hide ${name}`} title={p.off ? 'Put back in the drawing' : 'Leave out of the drawing'} onClick={() => update({ ...p, off: !p.off })}>
                  {p.off ? <EyeOffIcon /> : <EyeIcon />}
                </button>
                <button type="button" className={ICON_BUTTON} aria-label={`Remove ${name}`} title="Remove" onClick={() => remove(p.id)}>
                  <Trash2Icon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Select value="" onValueChange={(v) => add(v as PinKindId)} disabled={!picture || pins.length >= PINS_MAX}>
        <SelectTrigger aria-label="Add a pin" className="h-8 w-full bg-card">
          <SelectValue placeholder="Add a pin…" />
        </SelectTrigger>
        <SelectContent>
          {PIN_GROUPS.map((g) => (
            <SelectGroup key={g.caption}>
              <SelectLabel>{g.caption}</SelectLabel>
              {g.kinds.map((k) => {
                const Icon = PIN_ICONS[k];
                return (
                  <SelectItem key={k} value={k}>
                    <Icon aria-hidden />
                    {PIN_KINDS[k].label}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {!pin && (
        <Hint className="mt-2">
          {pins.length
            ? 'Pick a pin to show it on the preview and edit it.'
            : 'Pin things from the catalogue to the picture, and the town is laid out round them: a church on the lot nearest its pin, a park on the ground under its circle. Where nothing near a pin has room, it is left out and marked no room.'}
        </Hint>
      )}
      {pin && <PinSettings key={pin.id} pin={pin} name={pinName(pin, pins)} made={pin.off ? undefined : outcomes?.[pin.id]} update={update} onDone={() => onSelect(null)} />}
    </div>
  );
}

type PinSettingsProps = { pin: ImagePin; name: string; made: boolean | undefined; update: (p: ImagePin, fromSlider?: boolean) => void; onDone: () => void };

/** What the pin being edited makes, whether the town could make it, and the size of a ground pin's circle. */
function PinSettings({ pin, name, made, update, onDone }: PinSettingsProps) {
  const kind = PIN_KINDS[pin.kind];
  return (
    <div className="mt-3 rounded-md border bg-card/60 px-3 pt-2.5 pb-1">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">{name}</span>
        <button type="button" className={cn(TEXT_BUTTON, 'text-foreground')} onClick={onDone}>
          Done
        </button>
      </div>
      <Hint className="mt-0">{kind.note}</Hint>
      {made === false && (
        <Hint className="text-destructive" role="status">
          {isGround(pin.kind) ? 'The ground under the pin couldn’t take it. Move the pin onto the drawing area.' : 'Nothing near the pin had room for it: no lot it fits on, and no free ground beside a street. Move it off water, parks and squares, nearer a street.'}
        </Hint>
      )}
      {isGround(pin.kind) && (
        <>
          <Dial label="Size" value={pin.r} min={PIN_RADIUS[0]} max={PIN_RADIUS[1]} display={`${Math.round(pin.r * 100)}%`} hint="The circle’s radius, as a share of the picture’s shorter side." onChange={(r) => update({ ...pin, r }, true)} />
          <Dial label="Feather" value={pin.feather} min={0} max={PIN_FEATHER_MAX} display={`${Math.round((pin.feather / PIN_FEATHER_MAX) * 100)}%`} hint="A soft edge across the circle. Inside it the ground is held; across it the hold fades, and the picture shapes the edge." onChange={(feather) => update({ ...pin, feather }, true)} />
        </>
      )}
      <Hint className="mt-0">Drag the symbol on the preview to move it, or use the arrow keys while it has focus. It hides again when you press Done.</Hint>
    </div>
  );
}

type DialProps = { label: string; value: number; min: number; max: number; display: string; hint: string; onChange: (v: number) => void };

/** A slider in the pin's card, with its readout and a note under it. */
function Dial({ label, value, min, max, display, hint, onChange }: DialProps) {
  const id = useId();
  return (
    <div className="mb-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span id={id} className="text-[13px]">
          {label}
        </span>
        <output className="readout text-foreground">{display}</output>
      </div>
      <Slider className="mt-0.5" aria-labelledby={id} value={[value]} min={min} max={max} step={0.005} onValueChange={([v]) => onChange(v)} />
      <Hint className="mt-1">{hint}</Hint>
    </div>
  );
}
