import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { LocateFixed } from 'lucide-react'
import { GlobeView, ORBITAL_ZONES } from './components/GlobeView'
import type { GlobeViewHandle, ScaleMode } from './components/GlobeView'
import { ZoneLegend } from './components/ZoneLegend'
import { ScaleToggle } from './components/ScaleToggle'
import { GameModeToggle } from './components/GameModeToggle'
import { ShuttleHUD } from './components/ShuttleHUD'
import type { ShuttleHUDHandle } from './components/ShuttleHUD'
import { PacmanHUD } from './components/PacmanHUD'
import type { PacmanHUDHandle } from './components/PacmanHUD'
import { PacmanStartScreen } from './components/PacmanStartScreen'
import { InfoPanel } from './components/InfoPanel'
import { StatsBar } from './components/StatsBar'
import { SearchBar } from './components/SearchBar'
import { FilterBar } from './components/FilterBar'
import { useSatellites } from './hooks/useSatellites'
import { useLivePositions } from './hooks/useLivePositions'
import { useUserLocation } from './hooks/useUserLocation'
import { computeGroundTrack } from './lib/groundTrack'
import { ALL_CATEGORIES } from './lib/categories'
import type { SatelliteRecord, SatPosition, ArcSegment, SatCategory } from './types/satellite'
import type { ShuttleTelemetry, GameOverState, PacmanTelemetry, PacmanGameOverState, GameMode, PacmanScope } from './types/game'

export default function App() {
  const { satellites, loading, error, lastFetch } = useSatellites()
  const positions = useLivePositions(satellites)
  const { location: userLocation } = useUserLocation()
  const globeViewRef = useRef<GlobeViewHandle>(null)

  const [selectedSat, setSelectedSat] = useState<(SatelliteRecord & SatPosition) | null>(null)
  const [groundTrack, setGroundTrack] = useState<ArcSegment[]>([])
  const [activeCategories, setActiveCategories] = useState<Set<SatCategory>>(new Set(ALL_CATEGORIES))
  const [visibleZones, setVisibleZones] = useState<Set<string>>(new Set(ORBITAL_ZONES.map(z => z.name)))
  const [scaleMode, setScaleMode] = useState<ScaleMode>('compressed')
  const [gameMode, setGameMode] = useState<GameMode>(null)
  const [pacmanScope, setPacmanScope] = useState<PacmanScope | null>(null)
  const [gameOver, setGameOver] = useState<GameOverState | null>(null)
  const [pacmanGameOver, setPacmanGameOver] = useState<PacmanGameOverState | null>(null)
  const [restartKey, setRestartKey] = useState(0)
  const hudRef = useRef<ShuttleHUDHandle>(null)
  const pacmanHudRef = useRef<PacmanHUDHandle>(null)

  const handleGameModeChange = useCallback((mode: GameMode) => {
    setGameMode(mode)
    setGameOver(null)
    setPacmanGameOver(null)
    // Always re-prompt for a play area on (re-)entering Pacman rather than
    // reusing whatever was picked last session.
    setPacmanScope(null)
    // True-scale spacing would make the game's play area essentially empty —
    // force the shared frame the shuttle/pacman/obstacles rely on while playing.
    if (mode !== null) setScaleMode('compressed')
  }, [])

  const handleCollision = useCallback((survivedSec: number) => {
    setGameOver({ survivedSec })
  }, [])

  const handleTelemetry = useCallback((t: ShuttleTelemetry) => {
    hudRef.current?.update(t)
  }, [])

  const handlePacmanTelemetry = useCallback((t: PacmanTelemetry) => {
    pacmanHudRef.current?.update(t)
  }, [])

  const handlePacmanGameOver = useCallback((s: PacmanGameOverState) => {
    setPacmanGameOver(s)
  }, [])

  const handleRestart = useCallback(() => {
    setGameOver(null)
    setPacmanGameOver(null)
    setRestartKey(k => k + 1)
  }, [])

  const handleExitFromGameOver = useCallback(() => {
    setGameOver(null)
    setPacmanGameOver(null)
    setGameMode(null)
  }, [])

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
          scaleMode={scaleMode}
          gameMode={gameMode}
          pacmanScope={pacmanScope}
          restartKey={restartKey}
          onSelectSat={handleSelectSat}
          onCollision={handleCollision}
          onTelemetry={handleTelemetry}
          onPacmanTelemetry={handlePacmanTelemetry}
          onPacmanGameOver={handlePacmanGameOver}
        />
      </div>

      {gameMode === 'shuttle' && (
        <ShuttleHUD ref={hudRef} gameOver={gameOver} onRestart={handleRestart} onExit={handleExitFromGameOver} />
      )}
      {gameMode === 'pacman' && pacmanScope === null && (
        <PacmanStartScreen onSelect={setPacmanScope} onExit={handleExitFromGameOver} />
      )}
      {gameMode === 'pacman' && pacmanScope !== null && (
        <PacmanHUD ref={pacmanHudRef} gameOver={pacmanGameOver} onRestart={handleRestart} onExit={handleExitFromGameOver} />
      )}

      <div className="absolute bottom-6 left-4 z-20 flex flex-col gap-2">
        {gameMode === null && <ScaleToggle scaleMode={scaleMode} onChange={setScaleMode} />}
        <ZoneLegend visibleZones={visibleZones} onToggle={toggleZone} />
        <GameModeToggle mode={gameMode} onChange={handleGameModeChange} />
      </div>

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
