import { useState } from 'react'
import type { RefObject, TouchEvent as ReactTouchEvent } from 'react'

interface Props {
  knobRef: RefObject<HTMLDivElement | null>
  onTouchStart: (e: ReactTouchEvent) => void
  onTouchMove: (e: ReactTouchEvent) => void
  onTouchEnd: (e: ReactTouchEvent) => void
}

// `(pointer: coarse)` targets touch as the *primary* pointer, unlike
// `ontouchstart in window`, which also fires true on touchscreen laptops
// where a mouse is the primary input — those don't need an on-screen pad.
function hasCoarsePointer(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
}

export function TouchJoystick({ knobRef, onTouchStart, onTouchMove, onTouchEnd }: Props) {
  const [coarsePointer] = useState(hasCoarsePointer)
  if (!coarsePointer) return null

  return (
    <div
      className="absolute bottom-24 right-6 z-30 w-28 h-28 rounded-full bg-slate-950/60 border border-slate-700 backdrop-blur select-none"
      style={{ touchAction: 'none' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        ref={knobRef}
        className="absolute top-1/2 left-1/2 w-12 h-12 -ml-6 -mt-6 rounded-full bg-yellow-400/70 border border-yellow-200/80 shadow-lg"
      />
    </div>
  )
}
