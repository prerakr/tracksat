import { useState, useRef, useEffect } from 'react'
import { Search, X } from 'lucide-react'
import type { SatelliteRecord } from '../types/satellite'
import { CATEGORY_COLORS } from '../lib/categories'

interface Props {
  satellites: SatelliteRecord[]
  onSelect: (sat: SatelliteRecord) => void
}

export function SearchBar({ satellites, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const results = query.trim().length < 2 ? [] : satellites
    .filter(s =>
      s.name.toUpperCase().includes(query.toUpperCase()) ||
      s.id.includes(query)
    )
    .slice(0, 8)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleSelect(sat: SatelliteRecord) {
    onSelect(sat)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative w-56">
      <div className="flex items-center gap-2 bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5">
        <Search size={14} className="text-slate-400 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Search satellites…"
          className="bg-transparent text-sm text-slate-200 placeholder-slate-500 outline-none w-full"
        />
        {query && (
          <button onClick={() => { setQuery(''); setOpen(false) }}>
            <X size={12} className="text-slate-400 hover:text-white" />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-slate-900 border border-slate-700 rounded-lg overflow-hidden shadow-xl z-30">
          {results.map(sat => (
            <button
              key={sat.id}
              onClick={() => handleSelect(sat)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-800 text-left transition-colors"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: CATEGORY_COLORS[sat.category] }}
              />
              <span className="text-slate-200 text-xs truncate">{sat.name}</span>
              <span className="text-slate-500 text-xs ml-auto shrink-0">{sat.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
