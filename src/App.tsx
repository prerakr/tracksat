import { useState, useEffect, useCallback, useMemo } from 'react'
import { GlobeView } from './components/GlobeView'
import { InfoPanel } from './components/InfoPanel'
import { StatsBar } from './components/StatsBar'
import { SearchBar } from './components/SearchBar'
import { FilterBar } from './components/FilterBar'
import { useSatellites } from './hooks/useSatellites'
import { useLivePositions } from './hooks/useLivePositions'
import { computeGroundTrack } from './lib/groundTrack'
import { ALL_CATEGORIES } from './lib/categories'
import type { SatelliteRecord, SatPosition, ArcSegment, SatCategory } from './types/satellite'

export default function App() {
  const { satellites, loading, error, lastFetch } = useSatellites()
  const positions = useLivePositions(satellites)

  const [selectedSat, setSelectedSat] = useState<(SatelliteRecord & SatPosition) | null>(null)
  const [groundTrack, setGroundTrack] = useState<ArcSegment[]>([])
  const [activeCategories, setActiveCategories] = useState<Set<SatCategory>>(new Set(ALL_CATEGORIES))

  useEffect(() => {
    if (!selectedSat) { setGroundTrack([]); return }
    setGroundTrack(computeGroundTrack(selectedSat, new Date()))
  }, [selectedSat])

  const handleSelectSat = useCallback((sat: SatelliteRecord & SatPosition) => {
    setSelectedSat(sat)
  }, [])

  const handleSearchSelect = useCallback((sat: SatelliteRecord) => {
    const pos = positions.get(sat.id)
    setSelectedSat(pos ? { ...sat, ...pos } : { ...sat, lat: 0, lng: 0, alt: 0, velocity: 0 })
  }, [positions])

  const toggleCategory = useCallback((cat: SatCategory) => {
    setActiveCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])

  const visibleCount = useMemo(() => {
    let count = 0
    for (const sat of satellites) {
      if (activeCategories.has(sat.category) && positions.has(sat.id)) count++
    }
    return count
  }, [satellites, positions, activeCategories])

  if (error) {
    return (
      <div className="flex items-center justify-center w-screen h-screen bg-slate-950 text-red-400 text-sm font-mono">
        Failed to load satellite data: {error}
      </div>
    )
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      <StatsBar
        total={satellites.length}
        visible={visibleCount}
        lastFetch={lastFetch}
        loading={loading}
      />

      <div className="absolute top-10 left-0 right-0 z-10 flex flex-wrap items-center gap-3 px-4 py-2 bg-slate-950/80 backdrop-blur border-b border-slate-800">
        <SearchBar satellites={satellites} onSelect={handleSearchSelect} />
        <FilterBar activeCategories={activeCategories} onToggle={toggleCategory} />
      </div>

      <div className="absolute inset-0 pt-20">
        <GlobeView
          satellites={satellites}
          positions={positions}
          activeCategories={activeCategories}
          groundTrack={groundTrack}
          onSelectSat={handleSelectSat}
        />
      </div>

      {selectedSat && (
        <InfoPanel
          sat={selectedSat}
          position={positions.get(selectedSat.id)}
          onClose={() => { setSelectedSat(null); setGroundTrack([]) }}
        />
      )}
    </div>
  )
}
