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

App patterns in [`src/components/fields.tsx`](src/components/fields.tsx): `FoldingSection` (index number, title, folded summary, lamp), `SliderField` (label, mono readout, dial, note), `KeyGrid`, `Caption`, `Hint`.

Composed fields (search, seed) put the input and its action key inside one frame instead of side by side. The preview sheet shows a crosshair: clicking a building gives it a new look and locks it. The Seed section then counts the locked buildings in a readout line, with an Unlock all text button. Below the last section, a hairline row says whether any setting differs from the defaults, with a Reset to defaults text button; it asks once (Cancel, or Reset in the signal colour) and keeps the place. The preset towns are a dropdown (name, then country in muted text) under the place search.

Only section 1 opens initially in either mode. In Map, **Place** holds the search, presets and locator. **View** holds rotation, tilt, scale and height, while **Drawing detail** holds detail, per-layer overrides and Humanize. Section 1 opens with a **Map | Image** selector switch. In Image, the place search and locator map make way for the **image well**: a hairline frame in the drawing area's proportions. A question-mark button in its upper corner explains how tone, colour, outlines and transparency shape the town. Empty, it says *Drop an image, or choose one* in muted text over a Choose key. Holding an image, it shows it as it will lie on the sheet; in Fill the cursor turns to a hand and dragging moves the crop. A mono readout under it gives the pixel size and name, beside a Choose another text button. Directly beneath it, the **Masks** section shows its count when folded and opens onto a hairline list of masks (shape and number, a mono readout of how many settings each sets, eye and bin keys) and three outline keys to add an ellipse, a rectangle or a polygon. Image tone groups likeness, colour, hatching and blank paper. Neighbourhoods and buildings groups district placement, height, density and floorplans. Streets groups pattern, winding, roundabouts and alignment with image lines. The selected mask, marked by a signal-coloured lamp, opens a card with its edge, strength and settings; dials that follow the drawing's own values are grey, with a small reset key once moved. Over the preview the selected mask shows as a signal-coloured tint at 45% that fades across its feather, with a signal outline and round handles that keep their size at any zoom. In image mode the toolbar gains two lamp keys, **Image** (the image over the preview at half strength) and **Squint** (the preview blurred to its tone), and the stats footer a mono **Likeness** readout out of 100.

The title block at the top of the panel ([`src/components/title-block.tsx`](src/components/title-block.tsx)) records what is on the sheet: place, sheet, scale and pens. You can rename the place right there. The name looks like the other entries and shows only a faint tint on hover. Enter or leaving the field saves it, Escape cancels, and the new name is drawn on the sheet. A muted chevron beside the pen dots opens a palette menu that lists each palette's name with its five pens and a check against the current one. Picking a palette there does the same as picking it in the Pens section. With one pen the dots are shown alone, with no menu.

The pen palette picker ([`src/components/palette-picker.tsx`](src/components/palette-picker.tsx)) shows each palette as a tiny test plot of a house: every pen does its own job in it (shadow hatching, a ripple of water, tree, roof, linework), with a strip of the five colours below. It is a single-choice group; editing any pen by hand makes the set "Custom" and nothing is selected. Palettes live in [`src/palettes.ts`](src/palettes.ts), in pen order, darkest pen last.

Below the pen list, a key strip makes new sets: **Harmonise** gives the unlocked pens new colours, built on a colour-wheel scheme turned to fit the locked pens, then scored for separation (≥ 0.19 in OKLab), a clearly darkest linework pen and gentle map sense (warm roofs, green parks, blue water, dark shadows) ([`src/harmony.ts`](src/harmony.ts), colour maths by culori). Each pen row has a lock, and picking a colour by hand locks that pen. Undo steps back through recent sets, and Copy puts the set on the clipboard as a `PALETTES` line, ready to paste in as a default.

While a drawing is made, a progress card sits over the stage ([`src/components/drawing-progress.tsx`](src/components/drawing-progress.tsx)). It names the current step and shows a small isometric line icon for it, plotted the way the plotter would: pen down, lift, again. One signal-coloured element per icon is the live part (the pen, the route). Below it, a segmented scale shows the seven steps. The card fades in only after 350 ms so quick redraws don't flash, and it is static under reduced motion. The steps are defined in [`src/app/stages.ts`](src/app/stages.ts) and reported by the worker from inside the render.

The **Catalogue** (a text button beside About in the toolbar) is a reference for everything the drawing finds in the map, works out from it, or makes up. A searchable list on the left is grouped and numbered like the panel's sections; each entry has a lamp, filled when it is in the drawing on show, and a mono count where it is counted. The detail on the right is a record: group and source tags (Map, OSM tags, Inferred, Made up), then a preview of the drawing faded to grey with the entry's own strokes in the signal colour, as a close-up of the densest patch or the whole sheet, then hairline rows: how it's found, by region, what it comes to in this drawing (or why it's missing), the switches with their lamps, and its level-of-detail rules with the coarsest scale each shows at. Regional styles get a reference card of their habits.

The stats footer is a plot sheet: per-pen bars show each pen's share of plot time. They are coloured by pen and always labelled by pen name, so colour is never the only cue.

**Pen Plot**, an outline button at the lower right of the stats footer, opens the plot dialog. While a plotter is connected, a lit signal lamp takes the place of its icon. The dialog has two modes in a selector switch, **Over USB** and **G-code file**, and lays out its work as numbered steps like the panel: Connect (with a live mono readout of the machine state and position), Paper and origin (a jog pad, pen up and down, Set origin here, Trace outline, and the plotter set-up), then Plot, pen by pen. A card names the next pen to put in, with its colour dot. While a pen plots, the card shows a signal-coloured progress bar with Pause and Stop. The pen table repeats the stats footer's columns, with a Plot or Again key per row; the next pen's key is the signal colour.

The Pens section also offers **Custom layer pens**: each drawable feature can keep its default mix or use one of the five numbered pens. Disabling the option preserves the assignments for later; Reset assignments clears them. One black pen takes precedence. The Sheet section offers an optional background colour. Drawing colours are user data, independent of the interface palette.
