import { useEffect, useMemo, useRef, useCallback } from 'react'
import * as THREE from 'three'
import type { SatelliteRecord, SatPosition } from '../types/satellite'
import { buildSpatialGrid, queryNearbyIds } from '../lib/collision'
import { scopeStarlinkBand } from '../lib/starlinkBand'

// Obstacles are scoped to Starlink's modal-altitude band (see starlinkBand.ts)
// and given an arcade-exaggerated collision radius — positions themselves
// stay real TLE-derived data, nothing is fabricated.
const CELL_SIZE = 12 // world units
const TICK_MS = 2000
export const COLLISION_RADIUS = 3.2 // world units — several times the 0.5-unit dot geometry

interface ObstacleTick {
  positions: Map<string, THREE.Vector3>
  grid: Map<string, string[]>
  receivedAt: number
}

export interface NearestObstacle {
  id: string
  position: THREE.Vector3
  distance: number
}

export function useGameObstacles(
  satellites: SatelliteRecord[],
  positions: Map<string, SatPosition>,
  getCoords: (lat: number, lng: number, altVisual: number) => { x: number; y: number; z: number },
  altToVisual: (altKm: number) => number,
  active: boolean,
) {
  const scopedIds = useMemo(() => {
    if (!active) return new Set<string>()
    return scopeStarlinkBand(satellites)
  }, [satellites, active])

  const prevTickRef = useRef<ObstacleTick | null>(null)
  const currTickRef = useRef<ObstacleTick | null>(null)

  useEffect(() => {
    if (!active || scopedIds.size === 0) return

    const posMap = new Map<string, THREE.Vector3>()
    for (const id of scopedIds) {
      const p = positions.get(id)
      if (!p) continue
      const c = getCoords(p.lat, p.lng, altToVisual(p.alt))
      posMap.set(id, new THREE.Vector3(c.x, c.y, c.z))
    }
    const grid = buildSpatialGrid(Array.from(posMap, ([id, position]) => ({ id, position })), CELL_SIZE)

    prevTickRef.current = currTickRef.current
    currTickRef.current = { positions: posMap, grid, receivedAt: performance.now() }
  }, [positions, active, scopedIds, getCoords, altToVisual])

  const reset = useCallback(() => {
    prevTickRef.current = null
    currTickRef.current = null
  }, [])

  const _lerped = useRef(new THREE.Vector3()).current

  // Interpolates each nearby obstacle between the previous and current tick's
  // cached world positions rather than lat/lng (avoids antimeridian/pole
  // wraparound and stays cheap: projection happens once per tick, not per frame).
  const getNearestObstacle = useCallback((shuttlePos: THREE.Vector3, now: number): NearestObstacle | null => {
    const curr = currTickRef.current
    if (!curr) return null
    const prev = prevTickRef.current ?? curr
    const t = Math.min(1, Math.max(0, (now - curr.receivedAt) / TICK_MS))

    const nearbyIds = queryNearbyIds(curr.grid, shuttlePos, CELL_SIZE)
    let best: NearestObstacle | null = null
    for (const id of nearbyIds) {
      const currPos = curr.positions.get(id)
      if (!currPos) continue
      const prevPos = prev.positions.get(id) ?? currPos
      _lerped.lerpVectors(prevPos, currPos, t)
      const distance = _lerped.distanceTo(shuttlePos)
      if (!best || distance < best.distance) best = { id, position: _lerped.clone(), distance }
    }
    return best
  }, [_lerped])

  return { scopedIds, getNearestObstacle, reset }
}
