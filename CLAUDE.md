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
5. **`App.tsx`** owns top-level UI state (selected satellite, active category filters, visible zones, scale mode, game mode, pacman scope) and wires the hooks/components together. `lib/groundTrack.ts` computes the selected satellite's ground track (1.5 orbital periods, 360 steps) on demand via `satellite.js` when a satellite is selected.

### Game modes

`GlobeView.tsx` hosts two minigames, selected via `GameModeToggle` (`gameMode: 'shuttle' | 'pacman' | null`, `types/game.ts`) and driven entirely inside `GlobeView`'s `useEffect`s (not a separate render tree). Both take over `OrbitControls` for the session via a shared `useEffect` keyed on `gameMode !== null` (including neutralizing `controls.update`, since three-globe calls it unconditionally every frame, so `enabled = false` alone isn't enough).

#### Shuttle Dodge

A free-flight dodging game:

- **`hooks/useKeyboardInput.ts`** maps WASD + arrows + Q/E + Shift to a ref-backed `FlightKeyState` (no React state, so 60fps reads don't trigger re-renders) — shared with Pacman below, which only uses the WASD subset.
- **`lib/shuttlePhysics.ts`** (`tickShuttle`) integrates a damped 6DOF flight model (throttle/strafe/pitch/yaw/roll) each animation frame, plus a gentle radial-hold pull back toward the spawn altitude shell since free flight has no orbital constraint to keep it there.
- **`hooks/useGameObstacles.ts`** scopes obstacles to Starlink's modal-altitude band (`lib/starlinkBand.ts`, shared with Pacman's level scoping — the one real cluster dense enough to matter; positions stay real TLE-derived data, nothing fabricated), buckets them into a uniform 3D grid (`lib/collision.ts`) rebuilt once per 2s propagator tick, and interpolates each candidate's position between ticks for smooth collision queries every frame.
- The game loop, spawn logic, and third-person chase camera live in a dedicated `useEffect` in `GlobeView.tsx` keyed on `[gameMode, restartKey, ...]`.
- Telemetry (speed/altitude/proximity/elapsed time) is pushed to `components/ShuttleHUD.tsx` via an imperative ref (`ShuttleHUDHandle.update`) rather than React state, again to avoid 60fps re-renders. `types/game.ts` holds `ShuttleTelemetry`/`GameOverState`.

#### Starlink Pacman

A static-snapshot Pacman-style game — only Starlink satellites, frozen in place, eaten for score while dodging ghosts:

- Entering Pacman shows `PacmanStartScreen` first, letting the player pick a `PacmanScope` (`'region'` — a bounded ~2,700km-wide patch, or `'all'` — every Starlink satellite in the band, uncapped) before `GlobeView`'s pacman `useEffect` actually starts (gated on `pacmanScope !== null`).
- **`lib/pacmanLevel.ts`** (`buildPacmanLevel`) snapshots a one-time, stationary level from the live Starlink band: one random satellite becomes the play-area center, satellites within it (or all of them, in `'all'` scope) become frozen pellets (lat/lng/alt captured once — this is what makes the mode non-live), the furthest-out ones are flagged as power pellets, and ghost spawn points are sampled from the real pellet field itself rather than a geometric shape (so it scales correctly for either scope).
- **`lib/pacmanPhysics.ts`** moves the player and generates ghost wander waypoints via exact spherical rotation (`Vector3.applyAxisAngle`), not a tangent-plane offset (`center + r·north`, renormalized) — that offset is only accurate for small `r`; at real scale (especially the uncapped `'all'` scope) it both slows movement to a crawl far from the anchor point and collapses waypoints toward a couple of fixed directions. The player's tangent frame (`north`/`east`) is carried forward each tick (parallel transport) rather than rebuilt from world-up every frame, since rebuilding has a coordinate singularity at the poles that traps movement in a loop instead of crossing one; a separate, deliberately gentle correction (`realignFrameTowardTrueNorth`, disabled within 25° of either pole — any closer and it reintroduces the same trap) pulls the carried frame back toward true north over time so it doesn't drift out of alignment with the fixed-up camera after a path that loops near a pole. The movement rotation's axis is `position × move`, not `move × position` — get that cross-product order backwards and every control inverts.
- The pacman `useEffect` in `GlobeView.tsx` (keyed on `[gameMode, pacmanScope, restartKey, ...]`) owns score/lives/power-timer state as plain closure variables (not React state), renders the player/ghosts as ad-hoc `THREE.Mesh`es added directly to the scene, and renders pellets by reusing the normal satellite-dot `customLayerData` layer fed a frozen snapshot instead of live positions.
- The camera matches the app's own default landing altitude (2.5 globe-radii) rather than a close chase cam: always positioned along the ray from globe-center through the player, looking at globe-center, so the player's own direction from center is by construction the camera direction — moving reads as the globe rotating beneath a fixed camera, with no per-keypress reorientation.
- Telemetry goes to `components/PacmanHUD.tsx` via the same imperative-ref pattern as `ShuttleHUD`. `types/game.ts` holds `PacmanTelemetry`/`PacmanGameOverState`/`PacmanScope`.

Entering either game mode forces `scaleMode` back to `'compressed'` (`App.tsx`) because true-scale altitude spacing would make the play area effectively empty.

### Directory layout

```
src/
  components/   # UI (globe, search, filters, info panel, legends, toggles, game HUD)
  hooks/        # data fetching, live position updates, geolocation, game input/physics wiring
  lib/          # TLE parsing, categorization, ground track math, shuttle/pacman physics, collision grid
  workers/      # web worker that propagates orbits off the main thread
  types/        # shared TypeScript types (satellite.ts, game.ts)
```

### Key conventions

- **Manual Three.js resource management**: any code that creates `THREE.Geometry`/`THREE.Material`/`THREE.Line` objects directly in `GlobeView.tsx` (outside of `react-globe.gl`'s own props) is responsible for disposing them in cleanup — see the zone-shell and orbit-line `useEffect`s for the pattern (remove from scene, `geometry.dispose()`, `material.dispose()`). Shared geometries/materials (`_satGeo`, `_matCache`, `_orbitMat`, `_shuttleGeo`, `_shuttleMat`, `_pacmanGeo`, `_pacmanMat`, `_ghostGeo`) are module-level singletons and are never disposed; ghost *materials* are the exception — created fresh per Pacman session (they need live per-frame frighten-tint color updates) and disposed in that session's cleanup.
- Zone shells rebuild only when `scaleMode` changes (altitude→visual mapping changes); toggling zone *visibility* just flips `group.visible` via a ref, avoiding unnecessary geometry rebuilds.
- Per-frame game state (keyboard input, shuttle/pacman physics, HUD telemetry) is kept in refs or plain closure variables and pushed imperatively rather than through React state, to avoid re-rendering at 60fps; callback props consumed inside a game-loop effect are mirrored into refs (e.g. `onCollisionRef`, `visibleZonesRef`) so the effect's dependency array doesn't force a respawn on every parent re-render.
- Types are centralized in `src/types/satellite.ts` (`SatCategory`, `SatelliteRecord`, `SatPosition`, `ArcSegment`) and `src/types/game.ts` (`GameMode`, `ShuttleTelemetry`, `GameOverState`, `PacmanScope`, `PacmanTelemetry`, `PacmanGameOverState`), imported with `import type`.
- Satellite category → color/label mapping lives only in `lib/categories.ts` (`CATEGORY_COLORS`, `CATEGORY_LABELS`, `ALL_CATEGORIES`); don't duplicate color values elsewhere.
- Styling is Tailwind CSS utility classes inline in JSX; no CSS modules or styled-components.
- `verbatimModuleSyntax` is enabled in `tsconfig.app.json`, so type-only imports must use `import type`.
