import { useCallback, useEffect, useRef } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'

export interface JoystickVector {
  x: number // -1 (left) .. 1 (right)
  y: number // -1 (back) .. 1 (forward)
}

// Knob travel radius in px: TouchJoystick.tsx's base circle is 56px in radius
// (w-28) and its knob 24px in radius (w-12), so 32px keeps the knob's edge
// inside the base at full deflection instead of poking out past it.
const MAX_RADIUS = 32
const DEADZONE = 0.15

function emptyVector(): JoystickVector {
  return { x: 0, y: 0 }
}

// Ref-backed like useKeyboardInput's FlightKeyState — GlobeView's pacman game
// loop reads this every frame, so updates must never trigger a React re-render.
export function useTouchJoystick(active: boolean) {
  const vectorRef = useRef<JoystickVector>(emptyVector())
  const knobRef = useRef<HTMLDivElement>(null)
  const touchIdRef = useRef<number | null>(null)
  const originRef = useRef({ x: 0, y: 0 })

  const setKnobOffset = useCallback((dx: number, dy: number) => {
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`
  }, [])

  const reset = useCallback(() => {
    touchIdRef.current = null
    vectorRef.current.x = 0
    vectorRef.current.y = 0
    setKnobOffset(0, 0)
  }, [setKnobOffset])

  const updateFromPoint = useCallback((clientX: number, clientY: number) => {
    let dx = clientX - originRef.current.x
    let dy = clientY - originRef.current.y
    const dist = Math.hypot(dx, dy)
    if (dist > MAX_RADIUS) {
      dx = (dx / dist) * MAX_RADIUS
      dy = (dy / dist) * MAX_RADIUS
    }
    setKnobOffset(dx, dy)

    const nx = dx / MAX_RADIUS
    const ny = -dy / MAX_RADIUS // screen y grows downward; forward is visually "up"
    vectorRef.current.x = Math.hypot(nx, ny) < DEADZONE ? 0 : nx
    vectorRef.current.y = Math.hypot(nx, ny) < DEADZONE ? 0 : ny
  }, [setKnobOffset])

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    if (touchIdRef.current !== null) return
    const touch = e.changedTouches[0]
    touchIdRef.current = touch.identifier
    originRef.current = { x: touch.clientX, y: touch.clientY }
    updateFromPoint(touch.clientX, touch.clientY)
  }, [updateFromPoint])

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    if (touchIdRef.current === null) return
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]
      if (touch.identifier === touchIdRef.current) {
        updateFromPoint(touch.clientX, touch.clientY)
        break
      }
    }
  }, [updateFromPoint])

  const onTouchEnd = useCallback((e: ReactTouchEvent) => {
    if (touchIdRef.current === null) return
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchIdRef.current) {
        reset()
        break
      }
    }
  }, [reset])

  // Dropping mid-drag (e.g. exiting the game while touching) would otherwise
  // leave a stale non-zero vector driving movement with no way to release it.
  useEffect(() => {
    if (!active) reset()
  }, [active, reset])

  return { vectorRef, knobRef, onTouchStart, onTouchMove, onTouchEnd }
}
