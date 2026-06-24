import { useRef, useEffect, useMemo, useCallback } from 'react'
import Globe from 'react-globe.gl'
import type { GlobeMethods } from 'react-globe.gl'
import * as THREE from 'three'
import type { SatelliteRecord, SatPosition, ArcSegment } from '../types/satellite'
import type { SatCategory } from '../types/satellite'

interface PointDatum extends SatelliteRecord {
  lat: number
  lng: number
  alt: number
  velocity: number
}

interface Props {
  satellites: SatelliteRecord[]
  positions: Map<string, SatPosition>
  activeCategories: Set<SatCategory>
  groundTrack: ArcSegment[]
  onSelectSat: (sat: SatelliteRecord & SatPosition) => void
}

// Log scale so LEO (~400 km) and GEO (~36 000 km) are both legible.
// 0 = surface, ~0.05 = ISS, ~0.6 = GPS, ~0.8 = GEO.
function altToVisual(altKm: number): number {
  if (altKm <= 0) return 0
  const clamped = Math.min(altKm, 42_164)
  return Math.log(clamped / 150 + 1) / Math.log(42_164 / 150 + 1) * 0.8
}

// One geometry shared by all dots; one material per colour (7 total).
const _satGeo = new THREE.SphereGeometry(0.5, 5, 4)
const _matCache = new Map<string, THREE.MeshBasicMaterial>()
function getMat(color: string): THREE.MeshBasicMaterial {
  let m = _matCache.get(color)
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); _matCache.set(color, m) }
  return m
}

export function GlobeView({ satellites, positions, activeCategories, groundTrack, onSelectSat }: Props) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined)

  useEffect(() => {
    if (!globeRef.current) return
    const controls = globeRef.current.controls() as {
      autoRotate: boolean
      autoRotateSpeed: number
      addEventListener: (event: string, cb: () => void) => void
    }
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.3
    controls.addEventListener('start', () => { controls.autoRotate = false })
  }, [])

  const pointsData = useMemo<PointDatum[]>(() => {
    const result: PointDatum[] = []
    for (const sat of satellites) {
      if (!activeCategories.has(sat.category)) continue
      const pos = positions.get(sat.id)
      if (!pos) continue
      result.push({ ...sat, lat: pos.lat, lng: pos.lng, alt: pos.alt, velocity: pos.velocity })
    }
    return result
  }, [satellites, positions, activeCategories])

  const handleCustomClick = useCallback((obj: object) => {
    if (globeRef.current) {
      const controls = globeRef.current.controls() as { autoRotate: boolean }
      controls.autoRotate = false
    }
    onSelectSat(obj as PointDatum)
  }, [onSelectSat])

  return (
    <Globe
      ref={globeRef}
      globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
      backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
      customLayerData={pointsData}
      customThreeObject={(d: object) => {
        const p = d as PointDatum
        return new THREE.Mesh(_satGeo, getMat(p.color))
      }}
      customThreeObjectUpdate={(obj, d: object) => {
        const p = d as PointDatum
        const coords = globeRef.current?.getCoords(p.lat, p.lng, altToVisual(p.alt))
        if (coords) obj.position.set(coords.x, coords.y, coords.z)
      }}
      customLayerLabel={(d: object) => {
        const p = d as PointDatum
        return `<div style="font-family:monospace;background:#0f172a;color:#e2e8f0;padding:6px 10px;border-radius:6px;font-size:12px;border:1px solid #334155">
          <div style="font-weight:bold;color:#38bdf8">${p.name}</div>
          <div>NORAD: ${p.id}</div>
          <div>Alt: ${p.alt.toFixed(0)} km</div>
          <div>Vel: ${p.velocity.toFixed(2)} km/s</div>
        </div>`
      }}
      onCustomLayerClick={(obj: object) => handleCustomClick(obj)}
      arcsData={groundTrack}
      arcStartLat="startLat"
      arcStartLng="startLng"
      arcEndLat="endLat"
      arcEndLng="endLng"
      arcStartAltitude={(d: object) => altToVisual((d as ArcSegment).altKm)}
      arcEndAltitude={(d: object) => altToVisual((d as ArcSegment).altKm)}
      arcAltitude={(d: object) => altToVisual((d as ArcSegment).altKm)}
      arcColor={() => '#14b8a6'}
      arcStroke={0.5}
      arcDashLength={0.4}
      arcDashGap={0.2}
      arcDashAnimateTime={3000}
      width={window.innerWidth}
      height={window.innerHeight}
    />
  )
}
