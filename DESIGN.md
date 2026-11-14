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

The pen palette picker ([`src/components/palette-picker.tsx`](src/components/palette-picker.tsx)) shows each palette as a tiny test plot of a house: every pen does its own job in it (shadow hatching, a ripple of water, tree, roof, linework), with a strip of the five colours below. It is a single-choice group; editing any pen by hand makes the set "Custom" and nothing is selected. Palettes live in [`src/palettes.ts`](src/palettes.ts), in pen order, darkest pen last.

Below the pen list, a key strip makes new sets: **Harmonise** gives the unlocked pens new colours, built on a colour-wheel scheme turned to fit the locked pens, then scored for separation (≥ 0.19 in OKLab), a clearly darkest linework pen and gentle map sense (warm roofs, green parks, blue water, dark shadows) ([`src/harmony.ts`](src/harmony.ts), colour maths by culori). Each pen row has a lock, and picking a colour by hand locks that pen. Undo steps back through recent sets, and Copy puts the set on the clipboard as a `PALETTES` line, ready to paste in as a default.

While a drawing is made, a progress card sits over the stage ([`src/components/drawing-progress.tsx`](src/components/drawing-progress.tsx)). It names the current step and shows a small isometric line icon for it, plotted the way the plotter would: pen down, lift, again. One signal-coloured element per icon is the live part (the pen, the route). Below it, a segmented scale shows the seven steps. The card fades in only after 350 ms so quick redraws don't flash, and it is static under reduced motion. The steps are defined in [`src/app/stages.ts`](src/app/stages.ts) and reported by the worker from inside the render.

The stats footer is a plot sheet: per-pen bars show each pen's share of plot time. They are coloured by pen and always labelled by pen name, so colour is never the only cue.

The Pens section also offers **Custom layer pens**: each drawable feature can keep its default mix or use one of the five numbered pens. Disabling the option preserves the assignments for later; Reset assignments clears them. One black pen takes precedence. The Sheet section offers an optional background colour. Drawing colours are user data, independent of the interface palette.
