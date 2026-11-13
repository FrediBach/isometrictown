# Design system

Isometric Town's interface follows Dieter Rams' principles: *less, but better*. The UI is an instrument for making a drawing. It stays quiet so the drawing on paper is the only thing with presence.

Built on [shadcn/ui](https://ui.shadcn.com) (Radix + Tailwind v4). Tokens live in [`src/index.css`](src/index.css); components in [`src/components/ui`](src/components/ui) are owned and adjusted here.

## Principles

1. **Colour signals function.** Neutral greys everywhere; the accent only where something acts or is live: the primary action, the drawing lamp, focus rings. The pen colours are data, not decoration.
2. **Words and numbers are set differently.** Inter for words. IBM Plex Mono for readouts, coordinates, indices and micro labels, like the legend on a technical drawing (`readout` and `micro` utilities).
3. **Hairlines, not borders.** 1px rules in `--border`. Radii are soft and consistent (`--radius` 6px).
4. **Controls look like instruments.** Sliders are tuning dials with a printed scale and a needle. On/off settings are keys with a status lamp. Exclusive choices are selector switches set in a recessed slot. Pen colours are round dials.
5. **The panel is a record.** Sections are numbered like fields on a drawing, and a folded section shows a summary of its settings.
6. **Texture only with meaning.** The stage's perforated dot grid marks the work surface.

## Tokens

The palette is taken from [fredibach.com](https://fredibach.com): five colours. Every other shade is mixed from them in CSS (`color-mix`), so nothing leaves the palette.

| Primitive | Value | Semantic tokens |
| --- | --- | --- |
| `--fb-paper` | `#f2f1eb` | `--background`, `--paper`, `--primary-foreground` |
| `--fb-ink` | `#252722` | `--foreground`, `--primary`, `--stage` |
| `--fb-muted` | `#55584f` | `--muted-foreground` |
| `--fb-rule` | `#9e9e94` | `--input` (control outlines); mixed 50% with paper for `--border` hairlines |
| `--fb-accent` | `#c74728` | `--signal`, `--ring`, `--destructive` |

Derived: `--card` (paper lightened toward white), `--muted`/`--accent` (7% ink in paper), toolbar background (ink deepened 20%).

`.dark` remaps the same tokens for anthracite surfaces (the toolbar), so shadcn components adapt without new variants.

## Components

System parts in [`src/components/ui`](src/components/ui):

| Component | Use |
| --- | --- |
| `Slider` | Tuning dial: hairline track, ink range, printed scale (`ticks`), 4px needle that lights in the signal colour while moving |
| `ToggleKey` | On/off key with a lamp: filled ink when on, an empty ring when off |
| `Segmented` | Selector switch for 2–4 exclusive options (zoom, orientation) |
| `Button` variant `signal` | The one primary action (Download SVG) |
| `Select`, `Dialog`, `Collapsible` | shadcn, themed through tokens |

App patterns in [`src/components/fields.tsx`](src/components/fields.tsx): `Section` / `FoldingSection` (index number, title, folded summary, lamp), `SliderField` (label, mono readout, dial, note), `KeyGrid`, `Caption`, `Hint`.

Composed fields (search, seed) put the input and its action key inside one frame instead of side by side. Lists of choices that are also navigation (the preset towns) are set as text links; the current one is underlined in the signal colour.

The stats footer is a plot sheet: per-pen bars show each pen's share of plot time. They are coloured by pen and always labelled by pen name, so colour is never the only cue.
