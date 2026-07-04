import type { ScaleMode } from './GlobeView'

interface Props {
  scaleMode: ScaleMode
  onChange: (mode: ScaleMode) => void
}

const OPTIONS: { mode: ScaleMode; label: string }[] = [
  { mode: 'compressed', label: 'Compressed' },
  { mode: 'true', label: 'True Scale' },
]

export function ScaleToggle({ scaleMode, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1 bg-slate-950/80 backdrop-blur border border-slate-800 rounded-lg px-3 py-2">
      <p className="text-slate-500 text-[10px] uppercase tracking-widest mb-1 font-mono">Altitude Scale</p>
      <div className="flex gap-1">
        {OPTIONS.map(opt => {
          const active = scaleMode === opt.mode
          return (
            <button
              key={opt.mode}
              onClick={() => onChange(opt.mode)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-mono border transition-colors ${
                active
                  ? 'border-sky-400 text-sky-300 bg-sky-400/10'
                  : 'border-slate-700 text-slate-500 hover:text-slate-300'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
