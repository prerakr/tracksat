import { useEffect, useRef } from 'react'

export interface FlightKeyState {
  forward: boolean
  backward: boolean
  strafeLeft: boolean
  strafeRight: boolean
  pitchUp: boolean
  pitchDown: boolean
  yawLeft: boolean
  yawRight: boolean
  rollLeft: boolean
  rollRight: boolean
  boost: boolean
}

function emptyKeyState(): FlightKeyState {
  return {
    forward: false, backward: false, strafeLeft: false, strafeRight: false,
    pitchUp: false, pitchDown: false, yawLeft: false, yawRight: false,
    rollLeft: false, rollRight: false, boost: false,
  }
}

const KEY_MAP: Record<string, keyof FlightKeyState> = {
  KeyW: 'forward',
  KeyS: 'backward',
  KeyA: 'strafeLeft',
  KeyD: 'strafeRight',
  ArrowUp: 'pitchUp',
  ArrowDown: 'pitchDown',
  ArrowLeft: 'yawLeft',
  ArrowRight: 'yawRight',
  KeyQ: 'rollLeft',
  KeyE: 'rollRight',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
}

// Ref-backed so 60fps reads never go through React state/re-renders.
export function useKeyboardInput(active: boolean) {
  const keysRef = useRef<FlightKeyState>(emptyKeyState())

  useEffect(() => {
    if (!active) return

    const onKeyDown = (e: KeyboardEvent) => {
      const field = KEY_MAP[e.code]
      if (!field) return
      keysRef.current[field] = true
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const field = KEY_MAP[e.code]
      if (!field) return
      keysRef.current[field] = false
      e.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      keysRef.current = emptyKeyState()
    }
  }, [active])

  return keysRef
}
