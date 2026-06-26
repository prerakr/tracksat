import { useRef, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle, useState } from 'react'
import Globe from 'react-globe.gl'
import type { GlobeMethods } from 'react-globe.gl'
import * as THREE from 'three'
import type { SatelliteRecord, SatPosition, ArcSegment } from '../types/satellite'
import type { SatCategory } from '../types/satellite'
import type { UserLocation } from '../hooks/useUserLocation'
import { ALL_CATEGORIES, CATEGORY_LABELS, CATEGORY_COLORS } from '../lib/categories'
import { XRMenu } from '../lib/xrMenu'
import type { XRMenuState } from '../lib/xrMenu'

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
  togglePassthrough: () => void
}

interface Props {
  satellites: SatelliteRecord[]
  positions: Map<string, SatPosition>
  activeCategories: Set<SatCategory>
  groundTrack: ArcSegment[]
  userLocation: UserLocation | null
  visibleZones: Set<string>
  onSelectSat: (sat: SatelliteRecord & SatPosition) => void
  // XR menu wiring — the in-scene 3D menu fires these
  visibleCount: number
  totalCount: number
  onToggleCategory: (cat: SatCategory) => void
  onToggleZone: (name: string) => void
  onTogglePassthrough: () => void
  onLocateXR: () => void
  onExitXR: () => void
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

// XR pointer ray (3 m, in unscaled rig space) + move handle
const _rayGeo = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, -3),
])
const _handleGeo = new THREE.SphereGeometry(0.045, 20, 14)  // 4.5 cm grab handle

// XR scale constants
const XR_SCALE     = 0.003   // 0.3 m radius → 60 cm diameter globe
const XR_HEIGHT    = 1.1     // m above floor
const XR_DEPTH     = -0.7    // m in front of user
const XR_INERTIA   = 0.92    // per-frame rotation decay after release
const SAT_PICK_RAD = 0.06    // rad (~3.4°) angular tolerance for ray satellite picking
const TAP_MAX_TURN = 0.10    // rad of accumulated rotation under which a grab counts as a tap

export const ORBITAL_ZONES = [
  { name: 'LEO', altKm: 2_000,  color: '#60a5fa', label: '160 – 2,000 km' },
  { name: 'MEO', altKm: 20_200, color: '#a78bfa', label: '2,000 – 35,786 km (GPS ≈ 20,200 km)' },
  { name: 'GEO', altKm: 35_786, color: '#f97316', label: '≈ 35,786 km' },
] as const

// Per-controller grab state (one entry per XR input source / hand)
type GrabMode = '' | 'menu' | 'move' | 'globe'
interface Grab {
  active: boolean
  mode: GrabMode
  offset: THREE.Vector3   // move mode: scene.position − controller world pos at grab
  startAngle: number      // globe mode: yaw of controller around globe at grab
  turned: number          // accumulated |Δyaw| while grabbing — distinguishes tap vs drag
  sat: PointDatum | null  // satellite under the ray at grab time (tap selects it)
}
function makeGrab(): Grab {
  return { active: false, mode: '', offset: new THREE.Vector3(), startAngle: 0, turned: 0, sat: null }
}

const _v = new THREE.Vector3()
function ctrlWorldPos(ctrl: THREE.Object3D): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld)
}
// Aim a raycaster down the controller's −Z (the XR target ray).
function rayFromController(ctrl: THREE.Object3D, rc: THREE.Raycaster) {
  rc.ray.origin.setFromMatrixPosition(ctrl.matrixWorld)
  rc.ray.direction.set(0, 0, -1).transformDirection(ctrl.matrixWorld)
}

const SKY_URL = '//unpkg.com/three-globe/example/img/night-sky.png'

export const GlobeView = forwardRef<GlobeViewHandle, Props>(
  function GlobeView({
    satellites, positions, activeCategories, groundTrack, userLocation, visibleZones, onSelectSat,
    visibleCount, totalCount, onToggleCategory, onToggleZone, onTogglePassthrough, onLocateXR, onExitXR,
  }, ref) {
    const globeRef = useRef<GlobeMethods | undefined>(undefined)
    const orbitLineRef = useRef<THREE.Line | null>(null)
    const zoneShellsRef = useRef<THREE.Group[]>([])

    // Controls react-globe.gl's skysphere visibility. Empty string → skysphere hidden.
    // This is the only reliable way to hide the background in XR: the library owns
    // a BackSide sphere mesh that is not accessible via scene.background.
    const [bgUrl, setBgUrl] = useState(SKY_URL)

    const onSelectSatRef = useRef(onSelectSat)
    useEffect(() => { onSelectSatRef.current = onSelectSat }, [onSelectSat])

    // Latest XR menu callbacks (kept in a ref so the render loop always sees fresh ones)
    const menuCbRef = useRef({ onToggleCategory, onToggleZone, onTogglePassthrough, onLocateXR, onExitXR })
    useEffect(() => {
      menuCbRef.current = { onToggleCategory, onToggleZone, onTogglePassthrough, onLocateXR, onExitXR }
    }, [onToggleCategory, onToggleZone, onTogglePassthrough, onLocateXR, onExitXR])

    // Snapshot of state the 3D menu draws from; refreshed whenever inputs change.
    const menuStateRef = useRef<XRMenuState>({
      visibleCount: 0, totalCount: 0, passthrough: true, hasLocation: false,
      categories: [], zones: [],
    })
    useEffect(() => {
      menuStateRef.current = {
        visibleCount, totalCount,
        passthrough: xr.current.isPassthrough,
        hasLocation: !!userLocation,
        categories: ALL_CATEGORIES.map(c => ({
          id: c, label: CATEGORY_LABELS[c], color: CATEGORY_COLORS[c], active: activeCategories.has(c),
        })),
        zones: ORBITAL_ZONES.map(z => ({
          id: z.name, label: z.name, color: z.color, active: visibleZones.has(z.name),
        })),
      }
      xr.current.menu?.redraw()
    }, [visibleCount, totalCount, userLocation, activeCategories, visibleZones])

    const xr = useRef({
      angVelY: 0,
      // Unscaled rig holding controllers, ray pointers, the move handle and the menu
      rig: null as THREE.Scene | null,
      controllers: [] as THREE.XRTargetRaySpace[],
      rays: [] as THREE.Line[],
      moveHandle: null as THREE.Mesh | null,
      raycaster: new THREE.Raycaster(),
      // 3D in-scene menu (Quest dom-overlay is unreliable, so UI lives in the scene)
      menu: null as XRMenu | null,
      // Per-controller grab + two-hand pinch state
      grabs: [makeGrab(), makeGrab()],
      twoHandActive: false,
      twoHandStartDist: 0,
      twoHandStartScale: XR_SCALE,
      twoHandStartScenePos: new THREE.Vector3(),
      twoHandStartMid: new THREE.Vector3(),
      // Passthrough
      isPassthrough: true,
      // Guards exitXR from running twice (e.g. button + unexpected session end)
      isActive: false,
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

        scene.scale.setScalar(XR_SCALE)
        scene.position.set(0, XR_HEIGHT, XR_DEPTH)

        state.isPassthrough = true
        // Hide the skysphere mesh react-globe.gl manages internally.
        // scene.background is always null in react-globe.gl (background is via
        // a BackSide sphere mesh), so we must drive it through the prop.
        setBgUrl('')
        renderer.setClearColor(0x000000, 0)
        // The canvas element lives inside the dom-overlay root and would show
        // the stale last desktop frame on top of the XR view. Hide it so only
        // the XR framebuffer (where Three.js renders in XR mode) is visible.
        renderer.domElement.style.opacity = '0'

        const controls = globe.controls() as { enabled: boolean; autoRotate: boolean }
        controls.enabled    = false
        controls.autoRotate = false

        // Unscaled rig holds everything the user points/grabs with, at real-world
        // metres. Controllers MUST NOT be parented to the 0.003-scaled globe scene
        // — that shrinks their rays to millimetres and corrupts world-space picking.
        const rig = new THREE.Scene()
        state.rig = rig

        // Controllers (these also carry the hand "pinch-aim" target ray + select
        // events on Quest, so the same code drives controllers and bare hands).
        for (let i = 0; i < 2; i++) {
          const ctrl = renderer.xr.getController(i) as THREE.XRTargetRaySpace
          const ray = new THREE.Line(_rayGeo, new THREE.LineBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.6,
          }))
          ctrl.add(ray)
          rig.add(ctrl)
          state.controllers.push(ctrl)
          state.rays.push(ray)
        }

        // Grab handle that follows the globe; pinch/grip it to reposition the globe.
        const handle = new THREE.Mesh(_handleGeo, new THREE.MeshBasicMaterial({
          color: 0x22d3ee, transparent: true, opacity: 0.85,
        }))
        rig.add(handle)
        state.moveHandle = handle

        // 3D in-scene control menu, added to the rig (rendered in the overlay pass)
        state.menu = new XRMenu(
          () => menuStateRef.current,
          {
            onToggleCategory: (id) => menuCbRef.current.onToggleCategory(id),
            onToggleZone:     (id) => menuCbRef.current.onToggleZone(id),
            onTogglePassthrough: () => menuCbRef.current.onTogglePassthrough(),
            onLocate: () => menuCbRef.current.onLocateXR(),
            onExit:   () => menuCbRef.current.onExitXR(),
          },
        )
        rig.add(state.menu.mesh)

        const rc = state.raycaster

        // Soft satellite picking: exact ray/sphere hits are hopeless at 1.5 mm
        // dots, so pick the satellite whose direction is closest to the ray within
        // a small angular cone.
        const softPickSat = (): PointDatum | null => {
          let best: PointDatum | null = null
          let bestAng = SAT_PICK_RAD
          const o = rc.ray.origin, d = rc.ray.direction
          scene.traverse(obj => {
            if (!(obj instanceof THREE.Mesh) || obj.geometry !== _satGeo) return
            _v.setFromMatrixPosition(obj.matrixWorld).sub(o)
            const len = _v.length()
            if (len < 0.05) return
            _v.divideScalar(len)
            const cos = _v.dot(d)
            if (cos <= 0) return
            const ang = Math.acos(Math.min(1, cos))
            if (ang < bestAng) { bestAng = ang; best = obj.userData as PointDatum }
          })
          return best
        }

        const onSelectStart = (i: number) => {
          const ctrl = state.controllers[i]
          const grab = state.grabs[i]
          ctrl.updateMatrixWorld()  // pose just updated this frame; refresh before picking
          rayFromController(ctrl, rc)
          ;(state.rays[i].material as THREE.LineBasicMaterial).color.set(0x22d3ee)
          state.angVelY = 0

          // 1. Menu (fires the button immediately on press)
          if (state.menu?.hitFromRay(rc)) { grab.active = true; grab.mode = 'menu'; return }

          // 2. Move handle → drag the globe
          if (rc.intersectObject(handle, false).length > 0) {
            grab.active = true; grab.mode = 'move'
            grab.offset.copy(scene.position).sub(ctrlWorldPos(ctrl))
            return
          }

          // 3. Otherwise grab the globe: rotate on drag, or tap to select a satellite
          grab.active = true; grab.mode = 'globe'; grab.turned = 0
          grab.sat = softPickSat()
          const cp = ctrlWorldPos(ctrl)
          grab.startAngle = Math.atan2(cp.x - scene.position.x, cp.z - scene.position.z)
        }

        const onSelectEnd = (i: number) => {
          const grab = state.grabs[i]
          ;(state.rays[i].material as THREE.LineBasicMaterial).color.set(0xffffff)
          // A short grab on the globe with a satellite under the ray = a tap-select
          if (grab.mode === 'globe' && grab.sat && grab.turned < TAP_MAX_TURN) {
            onSelectSatRef.current(grab.sat)
          }
          grab.active = false; grab.mode = ''; grab.sat = null
        }

        for (let i = 0; i < 2; i++) {
          state.controllers[i].addEventListener('selectstart', () => onSelectStart(i))
          state.controllers[i].addEventListener('selectend',   () => onSelectEnd(i))
        }

        globe.pauseAnimation()
        renderer.xr.enabled = true
        // Connect to the XR session FIRST so the first renderer.render() call
        // inside the loop already targets the XR framebuffer, not the canvas.
        await renderer.xr.setSession(session)
        state.isActive = true

        renderer.setAnimationLoop(() => {
          try {
            // Controller poses were updated by the XR manager for this frame, but
            // their world matrices are only recomputed at render — refresh now so
            // grab math reads current-frame positions.
            rig.updateMatrixWorld(true)
            const [c0, c1] = state.controllers
            const [g0, g1] = state.grabs

            // Park the move handle just under the globe's south pole (three-globe's
            // sphere radius is 100 units, so world radius = 100 × scene scale) where
            // it's visible and grabbable rather than buried inside the globe.
            const worldRadius = 100 * scene.scale.x
            handle.position.set(
              scene.position.x,
              scene.position.y - worldRadius - 0.04,
              scene.position.z,
            )
            handle.scale.setScalar(Math.max(0.6, Math.min(2.2, worldRadius / 0.3)))

            const t0 = g0.active && (g0.mode === 'globe' || g0.mode === 'move')
            const t1 = g1.active && (g1.mode === 'globe' || g1.mode === 'move')

            if (t0 && t1) {
              // Two-handed: scale by the change in controller separation, and
              // translate by the shift of their midpoint.
              const p0 = ctrlWorldPos(c0), p1 = ctrlWorldPos(c1)
              const dist = p0.distanceTo(p1)
              const midX = (p0.x + p1.x) * 0.5, midY = (p0.y + p1.y) * 0.5, midZ = (p0.z + p1.z) * 0.5
              if (!state.twoHandActive) {
                state.twoHandActive = true
                state.twoHandStartDist = dist || 1e-4
                state.twoHandStartScale = scene.scale.x
                state.twoHandStartScenePos.copy(scene.position)
                state.twoHandStartMid.set(midX, midY, midZ)
              }
              const ratio = dist / state.twoHandStartDist
              scene.scale.setScalar(Math.max(0.0008, Math.min(0.02, state.twoHandStartScale * ratio)))
              scene.position.set(
                state.twoHandStartScenePos.x + (midX - state.twoHandStartMid.x),
                state.twoHandStartScenePos.y + (midY - state.twoHandStartMid.y),
                state.twoHandStartScenePos.z + (midZ - state.twoHandStartMid.z),
              )
            } else {
              state.twoHandActive = false
              const i = t0 ? 0 : t1 ? 1 : -1
              if (i >= 0) {
                const ctrl = state.controllers[i], grab = state.grabs[i]
                const cp = ctrlWorldPos(ctrl)
                if (grab.mode === 'move') {
                  scene.position.copy(cp).add(grab.offset)
                } else {
                  // Rotate the globe around Y by how far the controller swung around it
                  const angle = Math.atan2(cp.x - scene.position.x, cp.z - scene.position.z)
                  const delta = angle - grab.startAngle
                  state.angVelY = delta
                  scene.rotation.y += delta
                  grab.turned += Math.abs(delta)
                  grab.startAngle = angle
                }
              } else {
                // No active grab — let the spin coast to a stop
                scene.rotation.y += state.angVelY
                state.angVelY *= XR_INERTIA
              }
            }

            renderer.render(scene, camera)

            // Overlay pass: rays, handle and menu at real-world scale. autoClear off
            // preserves the globe + passthrough; depth from the globe pass is kept so
            // rays/handle occlude correctly. The menu has depthTest:false (always on top).
            renderer.autoClear = false
            renderer.render(rig, camera)
            renderer.autoClear = true
          } catch (err) {
            console.error('[XR] render error:', err)
          }
        })
      },

      exitXR: () => {
        const state = xr.current
        if (!state.isActive) return  // no-op if session never started or already cleaned up
        state.isActive = false

        const globe = globeRef.current
        if (!globe) return
        const renderer = globe.renderer() as THREE.WebGLRenderer
        const scene    = globe.scene()

        renderer.setAnimationLoop(null)

        // Tear down the XR rig (controllers, rays, handle, menu)
        const rig = state.rig
        if (rig) {
          for (const ray of state.rays) (ray.material as THREE.Material).dispose()
          for (const ctrl of state.controllers) rig.remove(ctrl)
          state.menu?.dispose()
          if (state.moveHandle) {
            rig.remove(state.moveHandle)
            ;(state.moveHandle.material as THREE.Material).dispose()
          }
        }
        state.controllers = []
        state.rays = []
        state.moveHandle = null
        state.menu = null
        state.rig = null
        state.grabs = [makeGrab(), makeGrab()]
        state.twoHandActive = false

        scene.scale.setScalar(1)
        scene.position.set(0, 0, 0)
        scene.rotation.set(0, 0, 0)
        setBgUrl(SKY_URL)
        renderer.setClearColor(0x000000, 1)
        renderer.domElement.style.opacity = ''  // restore canvas visibility

        const controls = globe.controls() as { enabled: boolean; autoRotate: boolean }
        controls.enabled    = true
        controls.autoRotate = false

        globe.resumeAnimation()
      },

      togglePassthrough: () => {
        const globe = globeRef.current
        if (!globe) return
        const renderer = globe.renderer() as THREE.WebGLRenderer
        const state    = xr.current

        state.isPassthrough = !state.isPassthrough
        if (state.isPassthrough) {
          setBgUrl('')
          renderer.setClearColor(0x000000, 0)
        } else {
          setBgUrl(SKY_URL)
          renderer.setClearColor(0x000000, 1)
        }
        // Keep the menu's passthrough toggle in sync (state lives outside React here)
        menuStateRef.current.passthrough = state.isPassthrough
        state.menu?.redraw()
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
        rendererConfig={{ alpha: true, antialias: true }}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        backgroundImageUrl={bgUrl}
        customLayerData={pointsData}
        customThreeObject={(d: object) => {
          const p = d as PointDatum
          const mesh = new THREE.Mesh(_satGeo, getMat(p.color))
          mesh.userData = p
          return mesh
        }}
        customThreeObjectUpdate={(obj, d: object) => {
          const p = d as PointDatum
          const coords = globeRef.current?.getCoords(p.lat, p.lng, altToVisual(p.alt))
          if (coords) obj.position.set(coords.x, coords.y, coords.z)
          obj.userData = p
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
