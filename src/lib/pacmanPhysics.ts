import * as THREE from 'three'
import type { FlightKeyState } from '../hooks/useKeyboardInput'

export const PLAYER_SPEED_FRAC = 0.11 // fraction of world radius per second
export const GHOST_SPEED_FRAC = 0.07
export const GHOST_FRIGHTENED_SPEED_FRAC = 0.045
export const GHOST_AGGRO_RADIUS = 9 // world units
export const PELLET_EAT_RADIUS = 2.5
export const GHOST_CATCH_RADIUS = 3
export const POWER_DURATION_SEC = 7
export const PLAYER_LIVES = 3
export const GHOST_COLORS = ['#ef4444', '#f472b6', '#22d3ee', '#fb923c']

// A fixed tangent-plane basis at the region center — screen-relative WASD
// movement stays "up is up" everywhere in the (small) play region instead of
// being relative to the player's own heading like the shuttle's free flight.
export interface TangentFrame {
  north: THREE.Vector3
  east: THREE.Vector3
}

export function buildTangentFrame(center: THREE.Vector3): TangentFrame {
  const radial = center.clone().normalize()
  const east = new THREE.Vector3(0, 1, 0).cross(radial).normalize()
  const north = radial.clone().cross(east).normalize()
  return { north, east }
}

export interface PacmanActor {
  position: THREE.Vector3
  heading: THREE.Vector3
}

const _move = new THREE.Vector3()

// Hard-snapped to the shell (no free-flight drift) since precise maze-like
// movement matters more here than the smooth momentum shuttlePhysics goes for.
export function tickPacmanPlayer(
  actor: PacmanActor,
  keys: FlightKeyState,
  dt: number,
  worldRadius: number,
  shellRadius: number,
  frame: TangentFrame,
): void {
  _move.set(0, 0, 0)
  if (keys.forward) _move.addScaledVector(frame.north, 1)
  if (keys.backward) _move.addScaledVector(frame.north, -1)
  if (keys.strafeRight) _move.addScaledVector(frame.east, 1)
  if (keys.strafeLeft) _move.addScaledVector(frame.east, -1)
  if (_move.lengthSq() === 0) return

  _move.normalize()
  actor.heading.copy(_move)
  actor.position.addScaledVector(_move, worldRadius * PLAYER_SPEED_FRAC * dt)
  actor.position.setLength(shellRadius)
}

export type GhostMode = 'wander' | 'chase' | 'frightened'

export interface GhostActor {
  position: THREE.Vector3
  waypoint: THREE.Vector3
  mode: GhostMode
}

// Wander waypoints stay in the region's outer annulus (never the inner 40%)
// so ghost patrol paths don't sweep back through the player's spawn point at
// the region center — the player spawns there and needs real breathing room.
const WANDER_MIN_FRAC = 0.4

export function pickWanderWaypoint(
  center: THREE.Vector3,
  frame: TangentFrame,
  regionRadius: number,
  shellRadius: number,
): THREE.Vector3 {
  const angle = Math.random() * Math.PI * 2
  const minR = regionRadius * WANDER_MIN_FRAC
  // sqrt sampling over [minR, regionRadius] gives uniform-in-area coverage of
  // the annulus; plain linear random() would bias waypoints toward its inner
  // edge instead of spreading them evenly across the patrolled ring.
  const r = Math.sqrt(minR * minR + Math.random() * (regionRadius * regionRadius - minR * minR))
  return center.clone()
    .addScaledVector(frame.north, Math.cos(angle) * r)
    .addScaledVector(frame.east, Math.sin(angle) * r)
    .setLength(shellRadius)
}

const _dir = new THREE.Vector3()
const _radial = new THREE.Vector3()

// Ghosts wander a random waypoint until the player strays inside the aggro
// radius, then chase directly; while frightened they flee instead. Movement
// is projected onto each ghost's own local tangent plane so it stays glued
// to the shell without needing the fixed region frame the player uses.
export function tickGhost(
  ghost: GhostActor,
  playerPos: THREE.Vector3,
  center: THREE.Vector3,
  frame: TangentFrame,
  regionRadius: number,
  frightened: boolean,
  dt: number,
  worldRadius: number,
  shellRadius: number,
): void {
  ghost.mode = frightened
    ? 'frightened'
    : ghost.position.distanceTo(playerPos) <= GHOST_AGGRO_RADIUS ? 'chase' : 'wander'

  if (ghost.mode === 'frightened') {
    _dir.copy(ghost.position).sub(playerPos)
  } else if (ghost.mode === 'chase') {
    _dir.copy(playerPos).sub(ghost.position)
  } else {
    if (ghost.position.distanceTo(ghost.waypoint) < 2) {
      ghost.waypoint = pickWanderWaypoint(center, frame, regionRadius, shellRadius)
    }
    _dir.copy(ghost.waypoint).sub(ghost.position)
  }

  if (_dir.lengthSq() < 1e-6) return
  _radial.copy(ghost.position).normalize()
  _dir.addScaledVector(_radial, -_dir.dot(_radial))
  if (_dir.lengthSq() < 1e-6) return
  _dir.normalize()

  const speed = worldRadius * (ghost.mode === 'frightened' ? GHOST_FRIGHTENED_SPEED_FRAC : GHOST_SPEED_FRAC)
  ghost.position.addScaledVector(_dir, speed * dt)
  ghost.position.setLength(shellRadius)
}
