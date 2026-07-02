import type { PacmanScope } from '../types/game'

interface Props {
  onSelect: (scope: PacmanScope) => void
  onExit: () => void
}

export function PacmanStartScreen({ onSelect, onExit }: Props) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70">
      <div className="bg-slate-950 border border-slate-700 rounded-xl px-8 py-6 text-center font-mono max-w-sm">
        <p className="text-yellow-300 text-lg font-bold mb-1">Starlink Pacman</p>
        <p className="text-slate-500 text-xs mb-5">Choose a play area</p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => onSelect('region')}
            className="px-4 py-3 rounded-lg text-left border border-sky-400 text-sky-300 bg-sky-400/10 hover:bg-sky-400/20"
          >
            <span className="block text-sm font-bold">Regional Patch</span>
            <span className="block text-[10px] text-slate-400 mt-1 normal-case">A dense local cluster — quick, focused round</span>
          </button>
          <button
            onClick={() => onSelect('all')}
            className="px-4 py-3 rounded-lg text-left border border-yellow-400 text-yellow-300 bg-yellow-400/10 hover:bg-yellow-400/20"
          >
            <span className="block text-sm font-bold">All Starlink</span>
            <span className="block text-[10px] text-slate-400 mt-1 normal-case">Every Starlink satellite in the shell at once — more ghosts, faster, more chaos</span>
          </button>
        </div>
        <button onClick={onExit} className="mt-4 text-slate-500 hover:text-slate-300 text-xs">
          Cancel
        </button>
      </div>
    </div>
  )
}
