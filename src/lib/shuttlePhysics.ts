import * as THREE from 'three'
import type { FlightKeyState } from '../hooks/useKeyboardInput'

export interface ShuttleState {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  speed: number
  strafeSpeed: number
  pitchRate: number
  yawRate: number
  rollRate: number
}

export function createShuttleState(): ShuttleState {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    speed: 0,
    strafeSpeed: 0,
    pitchRate: 0,
    yawRate: 0,
    rollRate: 0,
  }
}

export function resetShuttleState(state: ShuttleState, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
  state.position.copy(position)
  state.quaternion.copy(quaternion)
  state.speed = 0
  state.strafeSpeed = 0
  state.pitchRate = 0
  state.yawRate = 0
  state.rollRate = 0
}

// Tuning constants expressed as fractions of the globe radius (world units) so
// the flight feel stays consistent if the underlying globe.gl radius ever changes.
export const MAX_SPEED_FRAC = 0.22
const REVERSE_SPEED_FRAC = 0.08
const BOOST_MULT = 1.8
const MAX_STRAFE_FRAC = 0.12
const MAX_PITCH_RATE = 1.4 // rad/s
const MAX_YAW_RATE = 1.1 // rad/s
const MAX_ROLL_RATE = 2.0 // rad/s
const LINEAR_DAMPING = 3.5 // higher = snappier throttle response
const ANGULAR_DAMPING = 5.0

// Free 6DOF flight has no notion of "stay in orbit" — even modest pitch/yaw
// drift compounds over a few seconds of thrust into flying clean off the
// (very thin, log-compressed) obstacle shell the game is scoped to. This
// gently pulls the shuttle's distance from the globe center back toward the
// shell it spawned in without constraining its heading or tangential motion.
const RADIAL_HOLD_STRENGTH = 0.6 // per second

const _deltaEuler = new THREE.Euler()
const _deltaQuat = new THREE.Quaternion()
const _forward = new THREE.Vector3()
const _right = new THREE.Vector3()

export function tickShuttle(state: ShuttleState, keys: FlightKeyState, dt: number, worldRadius: number, shellRadius: number): void {
  const boost = keys.boost ? BOOST_MULT : 1

  const targetSpeed = keys.forward
    ? worldRadius * MAX_SPEED_FRAC * boost
    : keys.backward
      ? -worldRadius * REVERSE_SPEED_FRAC
      : 0
  const targetStrafe = keys.strafeRight
    ? worldRadius * MAX_STRAFE_FRAC
    : keys.strafeLeft
      ? -worldRadius * MAX_STRAFE_FRAC
      : 0
  const targetPitch = keys.pitchUp ? MAX_PITCH_RATE : keys.pitchDown ? -MAX_PITCH_RATE : 0
  const targetYaw = keys.yawLeft ? MAX_YAW_RATE : keys.yawRight ? -MAX_YAW_RATE : 0
  const targetRoll = keys.rollLeft ? MAX_ROLL_RATE : keys.rollRight ? -MAX_ROLL_RATE : 0

  const linT = Math.min(1, LINEAR_DAMPING * dt)
  const angT = Math.min(1, ANGULAR_DAMPING * dt)
  state.speed += (targetSpeed - state.speed) * linT
  state.strafeSpeed += (targetStrafe - state.strafeSpeed) * linT
  state.pitchRate += (targetPitch - state.pitchRate) * angT
  state.yawRate += (targetYaw - state.yawRate) * angT
  state.rollRate += (targetRoll - state.rollRate) * angT

  // Local-space intrinsic rotation (pitch=X, yaw=Y, roll=Z), applied as a
  // post-multiply so it rotates the shuttle relative to its own current heading.
  _deltaEuler.set(state.pitchRate * dt, state.yawRate * dt, state.rollRate * dt, 'XYZ')
  _deltaQuat.setFromEuler(_deltaEuler)
  state.quaternion.multiply(_deltaQuat)

  _forward.set(0, 0, -1).applyQuaternion(state.quaternion)
  _right.set(1, 0, 0).applyQuaternion(state.quaternion)
  state.position.addScaledVector(_forward, state.speed * dt)
  state.position.addScaledVector(_right, state.strafeSpeed * dt)

  const currentRadius = state.position.length()
  if (currentRadius > 0) {
    const pull = (shellRadius - currentRadius) * RADIAL_HOLD_STRENGTH * dt
    state.position.addScaledVector(state.position, pull / currentRadius)
  }
}
