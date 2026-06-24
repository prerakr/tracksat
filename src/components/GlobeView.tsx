import { useRef, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react'
import Globe from 'react-globe.gl'
import type { GlobeMethods } from 'react-globe.gl'
import * as THREE from 'three'
import type { SatelliteRecord, SatPosition, ArcSegment } from '../types/satellite'
import type { SatCategory } from '../types/satellite'
import type { UserLocation } from '../hooks/useUserLocation'

interface PointDatum extends SatelliteRecord {
  lat: number
  lng: number
  alt: number
  velocity: number
}

export interface GlobeViewHandle {
  flyTo: (lat: number, lng: number, altitude?: number) => void
}

interface Props {
  satellites: SatelliteRecord[]
  positions: Map<string, SatPosition>
  activeCategories: Set<SatCategory>
  groundTrack: ArcSegment[]
  userLocation: UserLocation | null
  onSelectSat: (sat: SatelliteRecord & SatPosition) => void
}

// Log scale: 0 = surface, ~0.05 = ISS, ~0.6 = GPS, ~0.8 = GEO
function altToVisual(altKm: number): number {
  if (altKm <= 0) return 0
  const clamped = Math.min(altKm, 42_164)
  return Math.log(clamped / 150 + 1) / Math.log(42_164 / 150 + 1) * 0.8
}

// Shared geometry + per-colour material cache — avoids re-allocating for 5000+ dots
const _satGeo = new THREE.SphereGeometry(0.5, 5, 4)
const _matCache = new Map<string, THREE.MeshBasicMaterial>()
function getMat(color: string): THREE.MeshBasicMaterial {
  let m = _matCache.get(color)
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); _matCache.set(color, m) }
  return m
}

const _orbitMat = new THREE.LineDashedMaterial({
  color: '#14b8a6',
  dashSize: 3,
  gapSize: 1.5,
  opacity: 0.85,
  transparent: true,
})

export const GlobeView = forwardRef<GlobeViewHandle, Props>(
  function GlobeView({ satellites, positions, activeCategories, groundTrack, userLocation, onSelectSat }, ref) {
    const globeRef = useRef<GlobeMethods | undefined>(undefined)
    const orbitLineRef = useRef<THREE.Line | null>(null)

    useImperativeHandle(ref, () => ({
      flyTo: (lat, lng, altitude = 1.5) => {
        globeRef.current?.pointOfView({ lat, lng, altitude }, 1200)
      },
    }))

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

    // Orbit line: single THREE.Line — 1 draw call, no per-frame animation
    useEffect(() => {
      const globe = globeRef.current
      if (!globe) return
      const scene = globe.scene()

      if (orbitLineRef.current) {
        scene.remove(orbitLineRef.current)
        orbitLineRef.current.geometry.dispose()
        orbitLineRef.current = null
      }

      if (groundTrack.length === 0) return

      const pts: THREE.Vector3[] = []
      for (let i = 0; i < groundTrack.length; i++) {
        const seg = groundTrack[i]
        if (i === 0) {
          const c = globe.getCoords(seg.startLat, seg.startLng, altToVisual(seg.altKm))
          pts.push(new THREE.Vector3(c.x, c.y, c.z))
        }
        const c = globe.getCoords(seg.endLat, seg.endLng, altToVisual(seg.altKm))
        pts.push(new THREE.Vector3(c.x, c.y, c.z))
      }

      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const line = new THREE.Line(geo, _orbitMat)
      line.computeLineDistances()
      scene.add(line)
      orbitLineRef.current = line

      return () => {
        scene.remove(line)
        geo.dispose()
      }
    }, [groundTrack])

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

    const locationRings = useMemo(
      () => (userLocation ? [userLocation] : []),
      [userLocation],
    )

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
        ringsData={locationRings}
        ringLat="lat"
        ringLng="lng"
        ringColor={() => (t: number) => `rgba(96,165,250,${1 - t})`}
        ringMaxRadius={4}
        ringPropagationSpeed={1.5}
        ringRepeatPeriod={1800}
        ringAltitude={0.001}
        width={window.innerWidth}
        height={window.innerHeight}
      />
    )
  }
)
