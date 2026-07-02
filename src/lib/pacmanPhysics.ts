import * as THREE from 'three'
import type { FlightKeyState } from '../hooks/useKeyboardInput'

export const PLAYER_SPEED_FRAC = 0.24 // fraction of world radius per second
export const GHOST_SPEED_FRAC = 0.16
export const GHOST_FRIGHTENED_SPEED_FRAC = 0.1
export const GHOST_AGGRO_RADIUS = 11 // world units
export const PELLET_EAT_RADIUS = 3
export const GHOST_CATCH_RADIUS = 3.5
export const POWER_DURATION_SEC = 7
export const PLAYER_LIVES = 3
export const GHOST_COLORS = ['#ef4444', '#f472b6', '#22d3ee', '#fb923c']

// An orthonormal tangent-plane basis at some point on the shell. Used two
// ways: as a one-off fixed frame anchored at the level center (for ghost
// waypoint sampling), and as mutable per-actor state that gets carried
// forward each tick (see PacmanActor below) — screen-relative WASD movement
// stays "up is up" without being relative to the player's own heading like
// the shuttle's free flight.
export interface TangentFrame {
  north: THREE.Vector3
  east: THREE.Vector3
}

export function buildTangentFrame(center: THREE.Vector3): TangentFrame {
  const radial = center.clone().normalize()
  // Near the poles, world-up is nearly parallel to radial and east would
  // collapse toward zero — fall back to a different reference axis so the
  // frame stays well-defined. This gets called every frame for player
  // movement now, which can wander anywhere, including near-polar shells.
  const worldUp = Math.abs(radial.y) > 0.999 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const east = worldUp.clone().cross(radial).normalize()
  const north = radial.clone().cross(east).normalize()
  return { north, east }
}

export interface PacmanActor {
  position: THREE.Vector3
  // Carried tangent frame — rotated along with position each tick (parallel
  // transport) rather than rebuilt from world-up every frame. Rebuilding
  // from world-up has a coordinate singularity at the poles (the azimuth of
  // "north" spins arbitrarily fast as you approach one), which trapped
  // players in a loop near a pole instead of crossing it — very reachable in
  // the All Starlink scope, since some Starlink shells are near-polar.
  // Carrying the frame forward is exact and singularity-free everywhere, at
  // the cost of "north" no longer meaning true-north after a long, winding
  // path — an acceptable trade since it never gets stuck.
  frame: TangentFrame
}

const _move = new THREE.Vector3()
const _axis = new THREE.Vector3()

// Parallel transport alone is exact locally but accumulates *holonomy* over
// paths that enclose area on the sphere (Gauss-Bonnet) — looping anywhere
// near a pole can rotate the carried frame by up to ~180° relative to true
// north. Since the camera's "up" stays fixed to true north, enough drift
// makes WASD feel inverted. Gently nudging the carried frame back toward
// the freshly computed true-north frame keeps it aligned with the screen
// over the course of normal play.
//
// This has to stay off entirely within POLE_DEADZONE_DEG of either pole:
// true north's *azimuth* changes arbitrarily fast in a small neighborhood
// of a pole (meridians all converge there), so even a slow, heavily-damped
// pull toward it measurably perturbs movement and can trap the player in a
// short loop right at a pole-crossing instead of carrying them through —
// tuned empirically against a standalone rotation-math test harness (rate
// any higher, or a dead zone much smaller, reintroduces multi-second
// entrapment; both eliminate it down to a sub-frame-perceptible ~0.3s blip).
const FRAME_REALIGN_RATE = 0.5 // per second
const POLE_DEADZONE_DEG = 25

const _realignRadial = new THREE.Vector3()
const _realignCross = new THREE.Vector3()

function realignFrameTowardTrueNorth(actor: PacmanActor, dt: number): void {
  _realignRadial.copy(actor.position).normalize()
  const colatitudeDeg = Math.acos(Math.max(-1, Math.min(1, _realignRadial.y))) * (180 / Math.PI)
  const distToPoleDeg = Math.min(colatitudeDeg, 180 - colatitudeDeg)
  if (distToPoleDeg < POLE_DEADZONE_DEG) return

  const trueFrame = buildTangentFrame(actor.position)
  _realignCross.copy(actor.frame.north).cross(trueFrame.north)
  const angle = Math.atan2(_realignCross.dot(_realignRadial), actor.frame.north.dot(trueFrame.north))

  const t = Math.min(1, FRAME_REALIGN_RATE * dt) * angle
  actor.frame.north.applyAxisAngle(_realignRadial, t)
  actor.frame.east.applyAxisAngle(_realignRadial, t)
}

// Hard-snapped to the shell (no free-flight drift) since precise maze-like
// movement matters more here than the smooth momentum shuttlePhysics goes for.
//
// Movement is applied as an exact rotation of the position vector (and the
// carried frame, to keep it tangent) rather than a tangent-plane offset — a
// tangent-plane offset is only accurate near its anchor point; far away,
// most of the step becomes a radial component that renormalizing back onto
// the shell just discards, which is what made movement feel like it was
// slowing to a crawl far from spawn (worst in the All Starlink scope).
export function tickPacmanPlayer(
  actor: PacmanActor,
  keys: FlightKeyState,
  dt: number,
  worldRadius: number,
  shellRadius: number,
): void {
  _move.set(0, 0, 0)
  if (keys.forward) _move.addScaledVector(actor.frame.north, 1)
  if (keys.backward) _move.addScaledVector(actor.frame.north, -1)
  if (keys.strafeRight) _move.addScaledVector(actor.frame.east, 1)
  if (keys.strafeLeft) _move.addScaledVector(actor.frame.east, -1)
  if (_move.lengthSq() > 0) {
    _move.normalize()
    // Rotating a point C around axis A moves it in direction A×C. We want
    // that to equal `_move`, which needs A = C×_move (position×move) — not
    // move×position. The cross-product order matters: swapped, this rotates
    // the player in exactly the opposite of the intended direction.
    _axis.copy(actor.position).cross(_move).normalize()
    const angle = (worldRadius * PLAYER_SPEED_FRAC * dt) / shellRadius
    actor.position.applyAxisAngle(_axis, angle)
    actor.frame.north.applyAxisAngle(_axis, angle)
    actor.frame.east.applyAxisAngle(_axis, angle)
  }

  realignFrameTowardTrueNorth(actor, dt)
}

export type GhostMode = 'wander' | 'chase' | 'frightened'

export interface GhostActor {
  position: THREE.Vector3
  waypoint: THREE.Vector3
  mode: GhostMode
}

// Wander waypoints stay in the play area's outer annulus (never the inner
// 40% of extentRadius) so ghost patrol paths don't sweep back through the
// player's spawn point at the center — the player spawns there and needs
// real breathing room.
const WANDER_MIN_FRAC = 0.4

const _waypointTangent = new THREE.Vector3()
const _waypointRadial = new THREE.Vector3()
const _waypointAxis = new THREE.Vector3()

// Picks a point genuinely `r` world-units (chord distance) from `center` in a
// uniformly random bearing, however large `r` is, by rotating `center` by the
// exact corresponding great-circle angle around a random tangent axis —
// unlike a tangent-plane offset (center + r*north), which is only accurate
// for small r and otherwise collapses waypoints toward a couple of fixed
// directions instead of spreading across the play area (very visible once
// extentRadius spans a large chunk of the shell, as in the All Starlink scope).
export function pickWanderWaypoint(
  center: THREE.Vector3,
  frame: TangentFrame,
  extentRadius: number,
  shellRadius: number,
): THREE.Vector3 {
  const minR = extentRadius * WANDER_MIN_FRAC
  // sqrt sampling over [minR, extentRadius] gives uniform-in-area coverage of
  // the annulus; plain linear random() would bias waypoints toward its inner
  // edge instead of spreading them evenly across the patrolled ring.
  const r = Math.min(2 * shellRadius, Math.sqrt(minR * minR + Math.random() * (extentRadius * extentRadius - minR * minR)))
  const travelAngle = 2 * Math.asin(r / (2 * shellRadius))

  const bearing = Math.random() * Math.PI * 2
  _waypointTangent.copy(frame.north).multiplyScalar(Math.cos(bearing)).addScaledVector(frame.east, Math.sin(bearing))
  _waypointRadial.copy(center).normalize()
  _waypointAxis.copy(_waypointTangent).cross(_waypointRadial).normalize()

  return center.clone().applyAxisAngle(_waypointAxis, travelAngle)
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
  extentRadius: number,
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
      ghost.waypoint = pickWanderWaypoint(center, frame, extentRadius, shellRadius)
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
