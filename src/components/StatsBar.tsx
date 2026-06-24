import { Satellite } from 'lucide-react'

interface Props {
  total: number
  visible: number
  lastFetch: Date | null
  loading: boolean
}

export function StatsBar({ total, visible, lastFetch, loading }: Props) {
  return (
    <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-4 px-4 py-2 bg-slate-950/90 backdrop-blur border-b border-slate-800">
      <div className="flex items-center gap-2">
        <Satellite size={16} className="text-sky-400" />
        <span className="text-white font-bold text-sm tracking-wider">TRACKSAT</span>
      </div>

      <div className="flex items-center gap-1.5 ml-2">
        <span
          className={`w-2 h-2 rounded-full ${loading ? 'bg-yellow-400 animate-pulse' : 'bg-emerald-400'}`}
        />
        <span className="text-slate-300 text-xs">
          {loading ? 'Loading…' : 'Live'}
        </span>
      </div>

      <div className="text-slate-400 text-xs">
        <span className="text-slate-200 font-mono">{visible.toLocaleString()}</span>
        {' / '}
        <span className="font-mono">{total.toLocaleString()}</span>
        {' satellites'}
      </div>

      {lastFetch && (
        <div className="text-slate-500 text-xs ml-auto">
          TLE updated {lastFetch.toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
