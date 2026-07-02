import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { PacmanTelemetry, PacmanGameOverState } from '../types/game'

const POPUP_VISIBLE_MS = 3200

export interface PacmanHUDHandle {
  update: (telemetry: PacmanTelemetry) => void
  showPopup: (message: string) => void
}

interface Props {
  gameOver: PacmanGameOverState | null
  onRestart: () => void
  onExit: () => void
}

export const PacmanHUD = forwardRef<PacmanHUDHandle, Props>(
  function PacmanHUD({ gameOver, onRestart, onExit }, ref) {
    const scoreRef = useRef<HTMLSpanElement>(null)
    const pelletsRef = useRef<HTMLSpanElement>(null)
    const livesRef = useRef<HTMLSpanElement>(null)
    const powerRef = useRef<HTMLDivElement>(null)
    const popupRef = useRef<HTMLDivElement>(null)
    const popupTimeoutRef = useRef<number | undefined>(undefined)

    useImperativeHandle(ref, () => ({
      update: (t: PacmanTelemetry) => {
        if (scoreRef.current) scoreRef.current.textContent = `${t.score}`
        if (pelletsRef.current) pelletsRef.current.textContent = `${t.pelletsRemaining} / ${t.pelletsTotal}`
        if (livesRef.current) livesRef.current.textContent = '●'.repeat(Math.max(0, t.lives))
        if (powerRef.current) {
          powerRef.current.style.display = t.powered ? 'block' : 'none'
          powerRef.current.textContent = `POWERED ${t.powerRemainingSec.toFixed(1)}s`
        }
      },
      // Imperative like `update` above — popups fire off game-loop events,
      // not React state, so this pushes DOM directly rather than re-rendering.
      showPopup: (message: string) => {
        if (!popupRef.current) return
        popupRef.current.textContent = message
        popupRef.current.style.opacity = '1'
        window.clearTimeout(popupTimeoutRef.current)
        popupTimeoutRef.current = window.setTimeout(() => {
          if (popupRef.current) popupRef.current.style.opacity = '0'
        }, POPUP_VISIBLE_MS)
      },
    }), [])

    return (
      <>
        <div className="absolute top-24 right-4 z-20 bg-slate-950/80 backdrop-blur border border-slate-800 rounded-lg px-4 py-3 font-mono text-xs text-slate-300 w-48">
          <p className="text-slate-500 text-[10px] uppercase tracking-widest mb-2">Starlink Pacman</p>
          <div className="flex justify-between"><span>Score</span><span ref={scoreRef}>0</span></div>
          <div className="flex justify-between"><span>Pellets</span><span ref={pelletsRef}>0 / 0</span></div>
          <div className="flex justify-between mb-1"><span>Lives</span><span ref={livesRef} className="text-yellow-400">●●●</span></div>
          <div ref={powerRef} className="mt-1 text-center text-[10px] font-bold text-sky-300" style={{ display: 'none' }} />
        </div>

        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 font-mono text-[10px] text-slate-500 bg-slate-950/60 backdrop-blur px-3 py-1.5 rounded-full border border-slate-800 whitespace-nowrap">
          W/A/S/D to move · eat every Starlink dot · avoid ghosts · outer glowing dots = power pellets
        </div>

        <div
          ref={popupRef}
          className="absolute top-40 left-1/2 -translate-x-1/2 z-20 max-w-sm text-center font-mono text-xs text-yellow-300 bg-slate-950/85 backdrop-blur px-4 py-2 rounded-lg border border-yellow-400/30 shadow-lg transition-opacity duration-500 pointer-events-none"
          style={{ opacity: 0 }}
        />

        {gameOver && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70">
            <div className="bg-slate-950 border border-slate-700 rounded-xl px-8 py-6 text-center font-mono">
              <p className={`text-lg font-bold mb-2 ${gameOver.won ? 'text-emerald-400' : 'text-red-400'}`}>
                {gameOver.won ? 'Region Cleared!' : 'Caught!'}
              </p>
              <p className="text-slate-300 text-sm mb-1">Score {gameOver.score}</p>
              <p className="text-slate-500 text-xs mb-4 max-w-xs">{gameOver.message}</p>
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
