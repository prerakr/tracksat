# TrackSat

TrackSat is a real-time 3D satellite tracker. It plots thousands of satellites on an interactive WebGL globe, propagating their orbits live from TLE (Two-Line Element) data.

## Features

- **Live orbit propagation** — positions are computed from TLE data using [satellite.js](https://github.com/shashwatak/satellite-js) in a web worker, so the UI stays smooth while thousands of satellites update.
- **Interactive 3D globe** — built with [react-globe.gl](https://github.com/vasturiano/react-globe.gl) and Three.js, with category-coloured satellite dots and ground tracks.
- **Search & filter** — find a satellite by name and filter by category (Starlink, GPS/Nav, Stations, Weather, Science, Comms, Other).
- **Orbital zone overlays** — toggle LEO, MEO, and GEO shells on the globe.
- **Your location** — optionally shows your current position on the globe and lets you fly back to it.
- **Offline-friendly caching** — TLE data is fetched in batches from a public TLE API and cached in `localStorage` for 6 hours.

## Tech stack

- [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vite.dev) for dev/build tooling
- [Tailwind CSS](https://tailwindcss.com)
- [react-globe.gl](https://github.com/vasturiano/react-globe.gl) / Three.js for the 3D globe
- [satellite.js](https://github.com/shashwatak/satellite-js) for SGP4 orbit propagation
- [oxlint](https://oxc.rs) for linting

## Getting started

```bash
npm install
npm run dev
```

This starts the Vite dev server with hot module reloading.

### Other scripts

```bash
npm run build    # type-check and build for production
npm run preview  # preview the production build locally
npm run lint      # run oxlint
```

## Project structure

```
src/
  components/   # UI components (globe, search, filters, info panel, etc.)
  hooks/        # data fetching, live position updates, geolocation
  lib/          # TLE parsing, satellite categorization, ground track math
  workers/      # web worker that propagates orbits off the main thread
  types/        # shared TypeScript types
```

## Data source

Satellite TLE data is fetched from the [TLE API](https://tle.ivanstanojevic.me/).
