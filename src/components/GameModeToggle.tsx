interface Props {
  active: boolean
  onChange: (active: boolean) => void
}

export function GameModeToggle({ active, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1 bg-slate-950/80 backdrop-blur border border-slate-800 rounded-lg px-3 py-2">
      <p className="text-slate-500 text-[10px] uppercase tracking-widest mb-1 font-mono">Shuttle Dodge</p>
      <button
        onClick={() => onChange(!active)}
        className={`px-2.5 py-1 rounded-full text-[11px] font-mono border transition-colors ${
          active
            ? 'border-orange-400 text-orange-300 bg-orange-400/10'
            : 'border-slate-700 text-slate-500 hover:text-slate-300'
        }`}
      >
        {active ? 'Exit Flight' : 'Fly Shuttle'}
      </button>
    </div>
  )
}
