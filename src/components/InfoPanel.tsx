import { X, Satellite, Gauge, TrendingUp, Clock, Globe2 } from 'lucide-react'
import type { SatelliteRecord, SatPosition } from '../types/satellite'
import { CATEGORY_LABELS, CATEGORY_COLORS } from '../lib/categories'

interface Props {
  sat: SatelliteRecord
  position: SatPosition | undefined
  onClose: () => void
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-slate-700/50 last:border-0">
      <span className="text-slate-400 w-4">{icon}</span>
      <span className="text-slate-400 text-xs w-20 shrink-0">{label}</span>
      <span className="text-slate-100 text-sm font-mono ml-auto">{value}</span>
    </div>
  )
}

export function InfoPanel({ sat, position, onClose }: Props) {
  const color = CATEGORY_COLORS[sat.category]

  return (
    <div className="absolute top-24 right-4 z-20 w-72 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
          <span className="text-white font-semibold text-sm truncate">{sat.name}</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors ml-2 shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      <div className="px-4 py-3 space-y-0">
        <Row
          icon={<Satellite size={12} />}
          label="NORAD ID"
          value={sat.id}
        />
        <Row
          icon={<span style={{ color }} className="text-xs">●</span>}
          label="Category"
          value={CATEGORY_LABELS[sat.category]}
        />
        {position && (
          <>
            <Row
              icon={<TrendingUp size={12} />}
              label="Altitude"
              value={`${position.alt.toFixed(1)} km`}
            />
            <Row
              icon={<Gauge size={12} />}
              label="Velocity"
              value={`${position.velocity.toFixed(2)} km/s`}
            />
            <Row
              icon={<Globe2 size={12} />}
              label="Latitude"
              value={`${position.lat.toFixed(3)}°`}
            />
            <Row
              icon={<Globe2 size={12} />}
              label="Longitude"
              value={`${position.lng.toFixed(3)}°`}
            />
          </>
        )}
        <Row
          icon={<Clock size={12} />}
          label="Period"
          value={`${sat.period.toFixed(1)} min`}
        />
        <Row
          icon={<TrendingUp size={12} />}
          label="Inclination"
          value={`${sat.inclination.toFixed(2)}°`}
        />
        {sat.apogee > 0 && (
          <Row
            icon={<TrendingUp size={12} />}
            label="Apogee"
            value={`${sat.apogee.toFixed(0)} km`}
          />
        )}
        {sat.perigee > 0 && (
          <Row
            icon={<TrendingUp size={12} />}
            label="Perigee"
            value={`${sat.perigee.toFixed(0)} km`}
          />
        )}
      </div>
    </div>
  )
}
