import { useRef, useCallback } from 'react'
import type * as THREE from 'three'
import { createShuttleState } from '../lib/shuttlePhysics'
import type { ShuttleState } from '../lib/shuttlePhysics'
import { resetShuttleState } from '../lib/shuttlePhysics'

export function useShuttleFlight() {
  const stateRef = useRef<ShuttleState>(createShuttleState())

  const reset = useCallback((position: THREE.Vector3, quaternion: THREE.Quaternion) => {
    resetShuttleState(stateRef.current, position, quaternion)
  }, [])

  return { stateRef, reset }
}
