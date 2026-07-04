import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { ShuttleTelemetry, GameOverState } from '../types/game'

export interface ShuttleHUDHandle {
  update: (telemetry: ShuttleTelemetry) => void
}

interface Props {
  gameOver: GameOverState | null
  onRestart: () => void
  onExit: () => void
}

export const ShuttleHUD = forwardRef<ShuttleHUDHandle, Props>(
  function ShuttleHUD({ gameOver, onRestart, onExit }, ref) {
    const speedRef = useRef<HTMLSpanElement>(null)
    const altRef = useRef<HTMLSpanElement>(null)
    const proxRef = useRef<HTMLSpanElement>(null)
    const timeRef = useRef<HTMLSpanElement>(null)
    const proxBarRef = useRef<HTMLDivElement>(null)

    useImperativeHandle(ref, () => ({
      update: (t: ShuttleTelemetry) => {
        if (speedRef.current) speedRef.current.textContent = `${t.speedPct.toFixed(0)}%`
        if (altRef.current) altRef.current.textContent = `${t.altitudeKm.toFixed(0)} km`
        if (timeRef.current) timeRef.current.textContent = `${t.elapsedSec.toFixed(1)}s`
        if (proxRef.current) proxRef.current.textContent = t.proximity != null ? t.proximity.toFixed(1) : '—'
        if (proxBarRef.current) {
          const danger = t.proximity != null ? Math.max(0, Math.min(1, 1 - t.proximity / 15)) : 0
          proxBarRef.current.style.width = `${danger * 100}%`
          proxBarRef.current.style.background = danger > 0.7 ? '#ef4444' : danger > 0.4 ? '#f97316' : '#22c55e'
        }
      },
    }), [])

    return (
      <>
        <div className="absolute top-24 right-4 z-20 bg-slate-950/80 backdrop-blur border border-slate-800 rounded-lg px-4 py-3 font-mono text-xs text-slate-300 w-48">
          <p className="text-slate-500 text-[10px] uppercase tracking-widest mb-2">Shuttle Telemetry</p>
          <div className="flex justify-between"><span>Speed</span><span ref={speedRef}>0%</span></div>
          <div className="flex justify-between"><span>Altitude</span><span ref={altRef}>0 km</span></div>
          <div className="flex justify-between mb-1"><span>Survived</span><span ref={timeRef}>0.0s</span></div>
          <div className="flex justify-between mb-1"><span>Nearest sat</span><span ref={proxRef}>—</span></div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div ref={proxBarRef} className="h-full transition-[width]" style={{ width: '0%' }} />
          </div>
        </div>

        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 font-mono text-[10px] text-slate-500 bg-slate-950/60 backdrop-blur px-3 py-1.5 rounded-full border border-slate-800 whitespace-nowrap">
          W/S throttle · A/D strafe · arrows pitch/yaw · Q/E roll · Shift boost
        </div>

        {gameOver && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70">
            <div className="bg-slate-950 border border-slate-700 rounded-xl px-8 py-6 text-center font-mono">
              <p className="text-red-400 text-lg font-bold mb-2">Collision!</p>
              <p className="text-slate-300 text-sm mb-4">Survived {gameOver.survivedSec.toFixed(1)}s</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={onRestart}
                  className="px-4 py-2 rounded-full text-xs border border-sky-400 text-sky-300 bg-sky-400/10 hover:bg-sky-400/20"
                >
                  Restart
                </button>
                <button
                  onClick={onExit}
                  className="px-4 py-2 rounded-full text-xs border border-slate-700 text-slate-400 hover:text-slate-200"
                >
                  Exit
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }
)
