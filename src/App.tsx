import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { LocateFixed } from 'lucide-react'
import { GlobeView, ORBITAL_ZONES } from './components/GlobeView'
import type { GlobeViewHandle } from './components/GlobeView'
import { ZoneLegend } from './components/ZoneLegend'
import { InfoPanel } from './components/InfoPanel'
import { StatsBar } from './components/StatsBar'
import { SearchBar } from './components/SearchBar'
import { FilterBar } from './components/FilterBar'
import { useSatellites } from './hooks/useSatellites'
import { useLivePositions } from './hooks/useLivePositions'
import { useUserLocation } from './hooks/useUserLocation'
import { useWebXR } from './hooks/useWebXR'
import { XRButton } from './components/XRButton'
import { computeGroundTrack } from './lib/groundTrack'
import { ALL_CATEGORIES } from './lib/categories'
import type { SatelliteRecord, SatPosition, ArcSegment, SatCategory } from './types/satellite'

export default function App() {
  const { satellites, loading, error, lastFetch } = useSatellites()
  const positions = useLivePositions(satellites)
  const { location: userLocation } = useUserLocation()
  const { isSupported: xrSupported, isPresenting: xrPresenting, enter: enterXR, exit: exitXR } = useWebXR()
  const globeViewRef = useRef<GlobeViewHandle>(null)

  const handleEnterXR = useCallback(async () => {
    const session = await enterXR()
    if (session) await globeViewRef.current?.enterXR(session)
  }, [enterXR])

  const handleExitXR = useCallback(() => {
    globeViewRef.current?.exitXR()
    exitXR()
  }, [exitXR])

  const [selectedSat, setSelectedSat] = useState<(SatelliteRecord & SatPosition) | null>(null)
  const [groundTrack, setGroundTrack] = useState<ArcSegment[]>([])
  const [activeCategories, setActiveCategories] = useState<Set<SatCategory>>(new Set(ALL_CATEGORIES))
  const [visibleZones, setVisibleZones] = useState<Set<string>>(new Set(ORBITAL_ZONES.map(z => z.name)))

  const toggleZone = useCallback((name: string) => {
    setVisibleZones(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

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
          ref={globeViewRef}
          satellites={satellites}
          positions={positions}
          activeCategories={activeCategories}
          groundTrack={groundTrack}
          userLocation={userLocation}
          visibleZones={visibleZones}
          onSelectSat={handleSelectSat}
        />
      </div>

      <ZoneLegend visibleZones={visibleZones} onToggle={toggleZone} />

      <XRButton
        isSupported={xrSupported}
        isPresenting={xrPresenting}
        onEnter={handleEnterXR}
        onExit={handleExitXR}
      />

      {userLocation && (
        <button
          onClick={() => globeViewRef.current?.flyTo(userLocation.lat, userLocation.lng)}
          title="Center on my location"
          className="absolute bottom-6 right-6 z-20 flex items-center justify-center w-10 h-10 rounded-full bg-slate-800/90 border border-slate-600 text-blue-400 hover:bg-slate-700 hover:border-blue-500 hover:text-blue-300 transition-colors shadow-lg backdrop-blur"
        >
          <LocateFixed size={18} />
        </button>
      )}

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
