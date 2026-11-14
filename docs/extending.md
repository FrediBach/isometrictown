# Recipes

## Draw a new kind of thing

1. Pick the module by theme: `infra.ts` (transport), `sites.ts` (places and landmarks), `ground.ts` (land textures), `gardens.ts`, or a new file if it is big (as `trains.ts`, `aircraft.ts`, `power.ts` are).
2. Write a function returning an `Extra`:

   ```ts
   export function windmills(B: Build, paper: Paper, town: Town, M: Masks): Extra {
     const none = { solids: [], draw: () => {} };
     if (!B.set.ground || !shows(B.cam, LOD.windmill)) return none;   // gate on settings and level of detail
     const solids: Solid[] = [];
     for (const p of town.pois) {
       if (p.cls !== 'windmill') continue;
       if (onMask(paper, M.foot, p.x, p.y) || onMask(paper, M.water, p.x, p.y)) continue;
       const [k0, k1] = B.key(p.x, p.y);
       const out = newSolid();
       // faces → depth; lines → pens; casts → shadows
       const ring = place(p.x, p.y, 1, 0, rect(-2, 2, -2, 2));  // a 4 m square, in world metres
       slab(B, out, ring, 0, 8);
       solids.push(out);
     }
     return { solids, draw: () => {} };
   }
   ```

3. Add a rule for it to `LOD` in `src/lod.ts` (`windmill: { m: 12, mm: 2, what: 'Windmills: height' }`) and, where you know each one's size, pass it: `shows(B.cam, LOD.windmill, height, hash(k0, k1, B.set.seed, SALT))`. See [lod.md](lod.md).
4. Call it from `render()` in `src/render.ts`, in the `extras` list, next to its relatives, with a part name: `extra('ground', 'windmills', windmills(B, paper, town, M))`.
5. If it needs new map data, see [data-sources.md](data-sources.md#vector-tiles-tilests).
6. Draw hatching and textures at a spacing of `B.cam.gap(mm)`, so the Detail slider and the pen width reach them.
7. Keep it deterministic (`hash()` with `B.key` and a fresh salt) and keep it off roads, water and buildings with the masks.
8. Add a line to "What it draws" in the main README, and to the module table there if you added a file.

## Add a setting

1. Add the field, with a doc comment, to `Settings` and `DEFAULT_SETTINGS` in `src/settings.ts`.
2. For a slider or key: add the name to `NumberKey` or `BoolKey` (and a `FORMAT` entry for numbers) in `src/app/model.ts`.
3. Add a `NumberSetting` or `BoolSetting` to the right section in `src/components/sections.tsx`, and to that section's folded summary if it has one. A town layer toggle just needs an entry in `TOWN_KEYS` there.
4. If it changes the camera or footprint, add it to `VIEW_KEYS` / `REFIT_KEYS`.
5. Read it in drawing code as `B.set.yourSetting`.

Old saved settings pick up the default automatically.

## Add or tune a regional style

Styles live in `STYLES` in `src/styles.ts`. Countries map to styles in `BY_COUNTRY`, UN M49 regions in `BY_REGION`, with special cases such as `alpineEdge()`. Adding a `StyleId` also makes it appear in the style picker. Region-dependent features elsewhere check `B.style.id`.

## Add a pen palette

Append to `PALETTES` in `src/palettes.ts`, five colours in pen order, darkest last. The Copy key in the palette generator produces a ready line.

## Change the pass order

Read [render-pipeline.md](render-pipeline.md) first. Rules: masks something reads must be filled before it runs; all `fillFace`/`fillSprite` calls before `finishDepth()`; all `line3`/`sheet` calls after it.

## Check your work

- `npm run build` must pass (type check + bundle). There are no unit tests.
- Look at the result in `npm run dev` with a few presets (Amsterdam, Nördlingen, Hallstatt, Shirakawa-go) and at both coarse (1:8000) and fine (1:500) scales.
- For anything drawn, run `npm run lod -- --name before` first and `npm run lod -- --name after --compare before` after, and look at the close-ups (see [lod.md](lod.md#the-lod-lab)).
- Pan a little and check that made-up detail stays put.
- Run `npm run doctor` after React changes.
