# Isometric Town: architecture docs

How the app is put together, for anyone changing the code. What the app draws is in the [main README](../README.md); how the interface looks is in [DESIGN.md](../DESIGN.md).

| Doc | Read it when you… |
| --- | --- |
| [architecture.md](architecture.md) | want the big picture: threads, modules, and how a drawing comes about |
| [coordinates.md](coordinates.md) | touch geometry: map, local, sheet and depth spaces, the camera, determinism |
| [render-pipeline.md](render-pipeline.md) | add or change something drawn: passes, `Paper`, masks, solids, pens |
| [data-sources.md](data-sources.md) | work on fetching: vector tiles, Overpass, place search, caching |
| [ui.md](ui.md) | work on the React side: settings, the renderer, persistence, recolouring |
| [extending.md](extending.md) | need a recipe: a new feature, setting, building style or palette |
