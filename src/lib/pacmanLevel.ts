import * as THREE from 'three'
import type { SatelliteRecord, SatPosition } from '../types/satellite'
import type { PacmanScope } from '../types/game'
import { scopeStarlinkBand } from './starlinkBand'
import { buildSpatialGrid, queryNearbyIds } from './collision'
import { buildTangentFrame } from './pacmanPhysics'
import type { TangentFrame } from './pacmanPhysics'

export const REGION_RADIUS = 45 // world units — roughly a 2,700km-wide patch of the Starlink shell
const GRID_CELL = 8
const POWER_PELLET_COUNT = 6
const GHOST_COUNT_REGION = 4
const GHOST_COUNT_ALL = 9
const MIN_PELLETS = 6

export interface Pellet {
  id: string
  position: THREE.Vector3 // frozen world position, for physics/collision
  lat: number
  lng: number
  alt: number // frozen, for rendering via the normal satellite-dot layer
  power: boolean
}

export interface PacmanLevel {
  center: THREE.Vector3
  frame: TangentFrame
  shellRadius: number
  extentRadius: number // furthest pellet from center — bounds ghost wander, scales with scope
  pellets: Map<string, Pellet>
  grid: Map<string, string[]>
  ghostSpawns: THREE.Vector3[]
  playerSpawn: THREE.Vector3
}

// Snapshots the live Starlink band into a static level: one satellite
// becomes the play-area center, and either everything within REGION_RADIUS
// of it ('region') or every Starlink satellite in the band ('all') becomes
// a pellet frozen at its current position. Positions are captured once here
// and never touched again — this is what makes the mode a "stationary"
// pacman board rather than a live tracker.
export function buildPacmanLevel(
  satellites: SatelliteRecord[],
  positions: Map<string, SatPosition>,
  getCoords: (lat: number, lng: number, altVisual: number) => { x: number; y: number; z: number },
  altToVisual: (altKm: number) => number,
  scope: PacmanScope,
): PacmanLevel | null {
  const bandIds = scopeStarlinkBand(satellites)
  const candidates = satellites.filter(s => bandIds.has(s.id) && positions.has(s.id))
  if (candidates.length < MIN_PELLETS) return null

  const centerSat = candidates[Math.floor(Math.random() * candidates.length)]
  const centerPos = positions.get(centerSat.id)!
  const centerCoords = getCoords(centerPos.lat, centerPos.lng, altToVisual(centerPos.alt))
  const center = new THREE.Vector3(centerCoords.x, centerCoords.y, centerCoords.z)
  const frame = buildTangentFrame(center)
  const shellRadius = center.length()

  const pellets = new Map<string, Pellet>()
  for (const sat of candidates) {
    const pos = positions.get(sat.id)!
    const c = getCoords(pos.lat, pos.lng, altToVisual(pos.alt))
    const p = new THREE.Vector3(c.x, c.y, c.z)
    if (scope === 'region' && p.distanceTo(center) > REGION_RADIUS) continue
    pellets.set(sat.id, { id: sat.id, position: p, lat: pos.lat, lng: pos.lng, alt: pos.alt, power: false })
  }
  if (pellets.size < MIN_PELLETS) return null

  // Sorted furthest-first: powers the power-pellet placement below and the
  // ghost-spawn spread, and its head gives the play area's true extent.
  const byDistance = Array.from(pellets.values())
    .sort((a, b) => b.position.distanceTo(center) - a.position.distanceTo(center))
  const extentRadius = scope === 'region' ? REGION_RADIUS : byDistance[0].position.distanceTo(center)

  // Mark the furthest-out pellets as power pellets — rewards exploring the
  // whole play area instead of camping the center.
  for (let i = 0; i < Math.min(POWER_PELLET_COUNT, byDistance.length); i++) byDistance[i].power = true

  const grid = buildSpatialGrid(
    Array.from(pellets.values(), p => ({ id: p.id, position: p.position })),
    GRID_CELL,
  )

  // Ghost spawns are sampled from the real pellet field itself (evenly across
  // the furthest-to-nearest spread, skipping the closest 5% so none spawns
  // right on top of the player) rather than a geometric ring — this scales
  // correctly whether the play area is a tight region or the whole band.
  const ghostCount = scope === 'region' ? GHOST_COUNT_REGION : GHOST_COUNT_ALL
  const poolStart = Math.floor(byDistance.length * 0.05)
  const poolSpan = Math.max(1, byDistance.length - poolStart)
  const ghostSpawns: THREE.Vector3[] = []
  for (let i = 0; i < ghostCount; i++) {
    const idx = Math.min(byDistance.length - 1, poolStart + Math.floor((i / ghostCount) * poolSpan))
    ghostSpawns.push(byDistance[idx].position.clone())
  }

  return { center, frame, shellRadius, extentRadius, pellets, grid, ghostSpawns, playerSpawn: center.clone() }
}

export function queryPelletsNear(level: PacmanLevel, position: THREE.Vector3, radius: number): Pellet[] {
  const nearbyIds = queryNearbyIds(level.grid, position, GRID_CELL)
  const result: Pellet[] = []
  for (const id of nearbyIds) {
    const pellet = level.pellets.get(id)
    if (pellet && pellet.position.distanceTo(position) <= radius) result.push(pellet)
  }
  return result
}
