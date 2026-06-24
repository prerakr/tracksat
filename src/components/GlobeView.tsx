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
  enterXR: (session: XRSession) => Promise<void>
  exitXR: () => void
}

interface Props {
  satellites: SatelliteRecord[]
  positions: Map<string, SatPosition>
  activeCategories: Set<SatCategory>
  groundTrack: ArcSegment[]
  userLocation: UserLocation | null
  visibleZones: Set<string>
  onSelectSat: (sat: SatelliteRecord & SatPosition) => void
}

// Log scale: 0 = surface, ~0.05 = ISS, ~0.6 = GPS, ~0.8 = GEO
function altToVisual(altKm: number): number {
  if (altKm <= 0) return 0
  const clamped = Math.min(altKm, 42_164)
  return Math.log(clamped / 150 + 1) / Math.log(42_164 / 150 + 1) * 0.8
}

// Shared geometry + per-colour material cache
const _satGeo = new THREE.SphereGeometry(0.5, 5, 4)
const _matCache = new Map<string, THREE.MeshBasicMaterial>()
function getMat(color: string): THREE.MeshBasicMaterial {
  let m = _matCache.get(color)
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); _matCache.set(color, m) }
  return m
}

const _orbitMat = new THREE.LineDashedMaterial({
  color: '#14b8a6', dashSize: 3, gapSize: 1.5, opacity: 0.85, transparent: true,
})
const _rayMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5 })
const _rayGeo = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, -2), // 2 m forward in XR world space
])

// XR handheld scale constants
const XR_SCALE  = 0.003  // 0.3 m radius → 60 cm diameter globe
const XR_HEIGHT = 1.1    // m above floor
const XR_DEPTH  = -0.7   // m in front of user
const XR_AUTO_ROTATE = 0.0003 // rad/frame slow spin
const XR_INERTIA     = 0.96   // per-frame velocity decay

export const ORBITAL_ZONES = [
  { name: 'LEO', altKm: 2_000,  color: '#60a5fa', label: '160 – 2,000 km' },
  { name: 'MEO', altKm: 20_200, color: '#a78bfa', label: '2,000 – 35,786 km (GPS ≈ 20,200 km)' },
  { name: 'GEO', altKm: 35_786, color: '#f97316', label: '≈ 35,786 km' },
] as const

export const GlobeView = forwardRef<GlobeViewHandle, Props>(
  function GlobeView({ satellites, positions, activeCategories, groundTrack, userLocation, visibleZones, onSelectSat }, ref) {
    const globeRef = useRef<GlobeMethods | undefined>(undefined)
    const orbitLineRef = useRef<THREE.Line | null>(null)
    const zoneShellsRef = useRef<THREE.Group[]>([])

    // Keep a stable ref to onSelectSat so XR closures don't go stale
    const onSelectSatRef = useRef(onSelectSat)
    useEffect(() => { onSelectSatRef.current = onSelectSat }, [onSelectSat])

    // XR mutable state in a single ref (no re-renders needed)
    const xr = useRef({
      angVelY: XR_AUTO_ROTATE,
      isGrabbing: false,
      prevGrabAngle: 0,
      controllers: [] as THREE.XRTargetRaySpace[],
      origBackground: null as THREE.Color | THREE.Texture | null,
    })

    useImperativeHandle(ref, () => ({
      flyTo: (lat, lng, altitude = 1.5) => {
        globeRef.current?.pointOfView({ lat, lng, altitude }, 1200)
      },

      enterXR: async (session) => {
        const globe = globeRef.current
        if (!globe) return
        const renderer = globe.renderer() as THREE.WebGLRenderer
        const scene   = globe.scene()
        const camera  = globe.camera()
        const state   = xr.current

        // Scale the scene so the globe becomes a handheld-sized object
        scene.scale.setScalar(XR_SCALE)
        scene.position.set(0, XR_HEIGHT, XR_DEPTH)

        // Make renderer background transparent (reveals passthrough video)
        state.origBackground = scene.background as THREE.Color | THREE.Texture | null
        scene.background = null
        renderer.setClearColor(0x000000, 0)

        // Disable OrbitControls so they don't fight XR input
        const controls = globe.controls() as { enabled: boolean; autoRotate: boolean }
        controls.enabled     = false
        controls.autoRotate  = false

        // Set up controllers — Three.js sets matrixWorld in XR world space directly,
        // so scene scale does not affect their rendered position or ray picking.
        for (let i = 0; i < 2; i++) {
          const ctrl = renderer.xr.getController(i) as THREE.XRTargetRaySpace
          ctrl.add(new THREE.Line(_rayGeo, _rayMat))
          scene.add(ctrl)
          state.controllers.push(ctrl)
        }

        const [ctrl0] = state.controllers

        // Squeeze = grab to rotate the globe
        const onSqueezeStart = () => {
          state.isGrabbing  = true
          state.angVelY     = 0
          const cp = new THREE.Vector3().setFromMatrixPosition(ctrl0.matrixWorld)
          state.prevGrabAngle = Math.atan2(cp.x - scene.position.x, cp.z - scene.position.z)
        }
        const onSqueezeEnd = () => { state.isGrabbing = false }

        // Trigger = point-and-select satellite
        const raycaster = new THREE.Raycaster()
        const tmpMat = new THREE.Matrix4()
        const onSelectEnd = () => {
          tmpMat.identity().extractRotation(ctrl0.matrixWorld)
          raycaster.ray.origin.setFromMatrixPosition(ctrl0.matrixWorld)
          raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat)

          const hits: Array<{ distance: number; object: THREE.Object3D }> = []
          scene.traverse(obj => {
            if (!(obj instanceof THREE.Mesh) || obj.geometry !== _satGeo) return
            const res = raycaster.intersectObject(obj, false)
            if (res.length > 0) hits.push({ distance: res[0].distance, object: obj })
          })
          if (hits.length === 0) return
          hits.sort((a, b) => a.distance - b.distance)
          const datum = hits[0].object.userData as PointDatum
          if (datum?.id) onSelectSatRef.current(datum)
        }

        ctrl0.addEventListener('squeezestart', onSqueezeStart)
        ctrl0.addEventListener('squeezeend',   onSqueezeEnd)
        ctrl0.addEventListener('selectend',    onSelectEnd)

        // Pause react-globe.gl's rAF loop; take over rendering ourselves
        globe.pauseAnimation()
        renderer.xr.enabled = true

        renderer.setAnimationLoop(() => {
          // Globe rotation: grab-drag with inertia, or slow auto-spin
          if (state.isGrabbing) {
            const cp = new THREE.Vector3().setFromMatrixPosition(ctrl0.matrixWorld)
            const currAngle = Math.atan2(cp.x - scene.position.x, cp.z - scene.position.z)
            const delta = currAngle - state.prevGrabAngle
            state.angVelY     = delta
            scene.rotation.y += delta
            state.prevGrabAngle = currAngle
          } else {
            if (Math.abs(state.angVelY) < XR_AUTO_ROTATE) state.angVelY = XR_AUTO_ROTATE
            scene.rotation.y += state.angVelY
            state.angVelY    *= XR_INERTIA
          }
          renderer.render(scene, camera)
        })

        await renderer.xr.setSession(session)
      },

      exitXR: () => {
        const globe = globeRef.current
        if (!globe) return
        const renderer = globe.renderer() as THREE.WebGLRenderer
        const scene    = globe.scene()
        const state    = xr.current

        // Stop XR render loop
        renderer.setAnimationLoop(null)

        // Remove controllers
        for (const ctrl of state.controllers) scene.remove(ctrl)
        state.controllers = []

        // Restore scene transform and background
        scene.scale.setScalar(1)
        scene.position.set(0, 0, 0)
        scene.rotation.set(0, 0, 0)
        scene.background = state.origBackground
        renderer.setClearColor(0x000000, 1)

        // Re-enable OrbitControls and auto-rotate
        const controls = globe.controls() as { enabled: boolean; autoRotate: boolean; autoRotateSpeed: number }
        controls.enabled        = true
        controls.autoRotate     = false  // user will trigger it again on next interaction

        // Resume react-globe.gl's own loop
        globe.resumeAnimation()
      },
    }))

    // Zone boundary shells
    const initZones = useCallback(() => {
      const globe = globeRef.current
      if (!globe || zoneShellsRef.current.length > 0) return
      const scene = globe.scene()

      for (const z of ORBITAL_ZONES) {
        const visualAlt = altToVisual(z.altKm)
        const mat = new THREE.LineBasicMaterial({ color: z.color, transparent: true, opacity: 0.45 })
        const group = new THREE.Group()

        for (const lat of [-60, -30, 0, 30, 60]) {
          const pts: THREE.Vector3[] = []
          for (let i = 0; i <= 128; i++) {
            const lng = (i / 128) * 360 - 180
            const c = globe.getCoords(lat, lng, visualAlt)
            pts.push(new THREE.Vector3(c.x, c.y, c.z))
          }
          group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat))
        }

        for (let lng = 0; lng < 360; lng += 45) {
          const pts: THREE.Vector3[] = []
          for (let i = 0; i <= 128; i++) {
            const lat = (i / 128) * 180 - 90
            const c = globe.getCoords(lat, lng, visualAlt)
            pts.push(new THREE.Vector3(c.x, c.y, c.z))
          }
          group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat))
        }

        scene.add(group)
        zoneShellsRef.current.push(group)
      }
    }, [])

    useEffect(() => {
      zoneShellsRef.current.forEach((group, i) => {
        group.visible = visibleZones.has(ORBITAL_ZONES[i].name)
      })
    }, [visibleZones])

    useEffect(() => {
      if (!globeRef.current) return
      const controls = globeRef.current.controls() as {
        autoRotate: boolean; autoRotateSpeed: number
        addEventListener: (event: string, cb: () => void) => void
      }
      controls.autoRotate = true
      controls.autoRotateSpeed = 0.3
      controls.addEventListener('start', () => { controls.autoRotate = false })
    }, [])

    useEffect(() => {
      return () => {
        const globe = globeRef.current
        if (!globe) return
        const scene = globe.scene()
        for (const g of zoneShellsRef.current) {
          scene.remove(g)
          g.traverse(obj => {
            if (obj instanceof THREE.Line) {
              obj.geometry.dispose()
              ;(obj.material as THREE.Material).dispose()
            }
          })
        }
        zoneShellsRef.current = []
      }
    }, [])

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

      return () => { scene.remove(line); geo.dispose() }
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

    const locationRings = useMemo(() => (userLocation ? [userLocation] : []), [userLocation])

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
          const mesh = new THREE.Mesh(_satGeo, getMat(p.color))
          mesh.userData = p  // stored for XR trigger picking
          return mesh
        }}
        customThreeObjectUpdate={(obj, d: object) => {
          const p = d as PointDatum
          const coords = globeRef.current?.getCoords(p.lat, p.lng, altToVisual(p.alt))
          if (coords) obj.position.set(coords.x, coords.y, coords.z)
          obj.userData = p  // keep datum fresh (alt/vel update each tick)
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
        onGlobeReady={initZones}
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
