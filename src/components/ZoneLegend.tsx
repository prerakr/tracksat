import { ORBITAL_ZONES } from './GlobeView'

interface Props {
  visibleZones: Set<string>
  onToggle: (name: string) => void
}

export function ZoneLegend({ visibleZones, onToggle }: Props) {
  return (
    <div className="flex flex-col gap-1 bg-slate-950/80 backdrop-blur border border-slate-800 rounded-lg px-3 py-2">
      <p className="text-slate-500 text-[10px] uppercase tracking-widest mb-1 font-mono">Orbital Zones</p>
      {ORBITAL_ZONES.map(z => {
        const active = visibleZones.has(z.name)
        return (
          <button
            key={z.name}
            onClick={() => onToggle(z.name)}
            className={`flex items-center gap-2 text-left transition-opacity ${active ? 'opacity-100' : 'opacity-35'} hover:opacity-80`}
          >
            <span
              style={{ backgroundColor: z.color, height: '2px', minWidth: '12px', opacity: active ? 0.9 : 0.4 }}
              className="inline-block rounded-full"
            />
            <span className="font-mono text-[11px]" style={{ color: z.color }}>{z.name}</span>
            <span className="font-mono text-[11px] text-slate-400">{z.label}</span>
          </button>
        )
      })}
    </div>
  )
}
