# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TrackSat is a real-time 3D satellite tracker: a client-only React/TypeScript SPA that plots thousands of satellites on a WebGL globe, propagating their orbits live from TLE (Two-Line Element) data using `satellite.js` (SGP4) in a web worker.

## Commands

```bash
npm run dev      # Vite dev server with HMR (http://localhost:5173)
npm run build    # tsc -b (type-check via project references) && vite build
npm run lint     # oxlint
npm run preview  # preview the production build
```

There is no test suite/framework configured in this repo. There is no `npm run typecheck` script separate from `build`; `tsc -b` in `build` is how type errors surface. When verifying changes, run `npm run build` and `npm run lint`.

## Architecture

Data flows one way: fetch → parse → propagate → render.

1. **`hooks/useSatellites.ts`** fetches TLE data from the public [TLE API](https://tle.ivanstanojevic.me/api/tle), paginated (100/page, up to 50 pages). It shows page 1 immediately, then streams in the rest in batches of 10 pages concurrently, updating state after each batch so the globe populates progressively. Results are cached in `localStorage` for 6 hours (`tracksat_tle_data` / `tracksat_tle_ts`) to avoid refetching on reload.
2. **`lib/tleParser.ts`** converts raw TLE API items into `SatelliteRecord`s: classifies each satellite into a category (`lib/categories.ts`, via name-prefix regexes) and derives orbital parameters (inclination, period, apogee, perigee) directly from TLE line 2 fields — no `satellite.js` needed for this step.
3. **`hooks/useLivePositions.ts`** spins up `workers/propagator.worker.ts` (a Vite `?worker` module) and re-creates it whenever the satellite list changes. The worker holds parsed `satrec` objects and, on a 2s `setInterval` tick from the main thread, propagates all satellites with SGP4 and returns lat/lng/alt/velocity for each — keeping this CPU-heavy work off the main thread so the UI stays smooth with thousands of satellites.
4. **`components/GlobeView.tsx`** renders everything on a `react-globe.gl` / Three.js globe: satellite dots as a shared-geometry/per-color-material instanced `customThreeObject` layer (to avoid per-frame allocation with 5000+ objects), orbital zone shells (LEO/MEO/GEO wireframe rings), the selected satellite's ground track (a single `THREE.Line`), and a location ring for the user's position. Altitude is mapped to visual radius via one of two scale functions (`altToVisualCompressed` — log scale so LEO/MEO/GEO are all visible at once — or `altToVisualTrueScale` — physically accurate Earth-radii scale), selected by the `scaleMode` prop/toggle.
5. **`App.tsx`** owns top-level UI state (selected satellite, active category filters, visible zones, scale mode) and wires the hooks/components together. `lib/groundTrack.ts` computes the selected satellite's ground track (1.5 orbital periods, 360 steps) on demand via `satellite.js` when a satellite is selected.

### Directory layout

```
src/
  components/   # UI (globe, search, filters, info panel, legends, toggles)
  hooks/        # data fetching, live position updates, geolocation
  lib/          # TLE parsing, categorization, ground track math
  workers/      # web worker that propagates orbits off the main thread
  types/        # shared TypeScript types (satellite.ts)
```

### Key conventions

- **Manual Three.js resource management**: any code that creates `THREE.Geometry`/`THREE.Material`/`THREE.Line` objects directly in `GlobeView.tsx` (outside of `react-globe.gl`'s own props) is responsible for disposing them in cleanup — see the zone-shell and orbit-line `useEffect`s for the pattern (remove from scene, `geometry.dispose()`, `material.dispose()`). Shared geometries/materials (`_satGeo`, `_matCache`, `_orbitMat`) are module-level singletons and are never disposed.
- Zone shells rebuild only when `scaleMode` changes (altitude→visual mapping changes); toggling zone *visibility* just flips `group.visible` via a ref, avoiding unnecessary geometry rebuilds.
- Types are centralized in `src/types/satellite.ts` (`SatCategory`, `SatelliteRecord`, `SatPosition`, `ArcSegment`) and imported with `import type`.
- Satellite category → color/label mapping lives only in `lib/categories.ts` (`CATEGORY_COLORS`, `CATEGORY_LABELS`, `ALL_CATEGORIES`); don't duplicate color values elsewhere.
- Styling is Tailwind CSS utility classes inline in JSX; no CSS modules or styled-components.
- `verbatimModuleSyntax` is enabled in `tsconfig.app.json`, so type-only imports must use `import type`.
