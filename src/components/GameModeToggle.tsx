import type { GameMode } from '../types/game'

interface Props {
  mode: GameMode
  onChange: (mode: GameMode) => void
}

export function GameModeToggle({ mode, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1 bg-slate-950/80 backdrop-blur border border-slate-800 rounded-lg px-3 py-2">
      <p className="text-slate-500 text-[10px] uppercase tracking-widest mb-1 font-mono">Game Mode</p>
      <div className="flex gap-2">
        <button
          onClick={() => onChange(mode === 'shuttle' ? null : 'shuttle')}
          className={`px-2.5 py-1 rounded-full text-[11px] font-mono border transition-colors ${
            mode === 'shuttle'
              ? 'border-orange-400 text-orange-300 bg-orange-400/10'
              : 'border-slate-700 text-slate-500 hover:text-slate-300'
          }`}
        >
          {mode === 'shuttle' ? 'Exit Flight' : 'Fly Shuttle'}
        </button>
        <button
          onClick={() => onChange(mode === 'pacman' ? null : 'pacman')}
          className={`px-2.5 py-1 rounded-full text-[11px] font-mono border transition-colors ${
            mode === 'pacman'
              ? 'border-yellow-400 text-yellow-300 bg-yellow-400/10'
              : 'border-slate-700 text-slate-500 hover:text-slate-300'
          }`}
        >
          {mode === 'pacman' ? 'Exit Pacman' : 'Starlink Pacman'}
        </button>
      </div>
    </div>
  )
}
