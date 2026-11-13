<p align="center">
  <img src="public/logo.svg" alt="Isometric Town logo" width="96" />
</p>

<h1 align="center">Isometric Town</h1>

<p align="center">Pick any town and draw it in isometric 3D, as plotter-ready SVG linework.</p>

<p align="center"><b><a href="https://isometrictown.com">isometrictown.com</a></b></p>

Search for a place, drag the little map to frame it, and turn the view. Isometric Town fetches the buildings, streets, water and parks from OpenStreetMap and draws them as an isometric 3D scene. You can download the result as an SVG with one layer per pen.

## What it draws

- **Buildings** use their real footprints and heights from the map data. Windows are set by floor. Small, simple buildings get gabled or hipped roofs with hatching.
- **Streets** get kerb lines, parked cars and street lamps. Railways get rails and sleepers. Footpaths are dashed.
- **Water** is drawn as wavy strokes. Parks are hatched, and parks and woods get trees.
- **Shadows** are hatched on the ground, from a sun you can move.

Roof shapes, trees, cars and lamps are made up. They're tied to the seed and to map position, so the same settings always give the same drawing, and panning doesn't reshuffle them.

## Made for pen plotters

- Hidden lines are removed geometrically with a depth buffer before export, so nothing shows through a wall and nothing is drawn twice.
- Each pen is its own Inkscape layer, in plot order: blue, green, red, black.
- Strokes that touch are joined, and the stroke order is sorted to cut pen-up travel.
- The stats panel shows ink length, pen lifts and an estimated plot time for each pen.
- Sizes are real millimetres for A4, A3, A2, Letter, Tabloid and more.

## How it works

| File | Role |
| --- | --- |
| `src/tiles.ts` | Loads OpenFreeMap vector tiles (z14), clips them to tile edges and marks seams |
| `src/camera.ts` | Orthographic isometric camera: rotation, tilt, scale |
| `src/buildings.ts` | Walls, flat and pitched roofs, windows, rooftop boxes, cars |
| `src/streets.ts` | Road surfaces, kerbs, lamps, rails, footpaths |
| `src/nature.ts` | Tree placement and tree sprites |
| `src/raster.ts` | Depth buffer, screen-space ground masks, visibility tracing |
| `src/render.ts` | Runs the passes in order |
| `src/plot.ts` | Stroke joining, ordering, plot stats, SVG output |
| `src/worker.ts` | Runs all of the above off the main thread |
| `src/App.tsx`, `src/components/` | The interface, built with React and shadcn/ui (see [DESIGN.md](DESIGN.md)) |

## Run it locally

```bash
npm install
npm run dev
```

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Tiles by [OpenFreeMap](https://openfreemap.org), schema © [OpenMapTiles](https://www.openmaptiles.org). Map view by [MapLibre GL](https://maplibre.org). Place search by [Photon](https://photon.komoot.io) and [Nominatim](https://nominatim.org). Town list from [Natural Earth](https://www.naturalearthdata.com).

## License

[MIT](LICENSE)
