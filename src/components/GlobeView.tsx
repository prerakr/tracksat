import { useRef, useEffect, useMemo, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import Globe from 'react-globe.gl'
import type { GlobeMethods } from 'react-globe.gl'
import * as THREE from 'three'
import type { SatelliteRecord, SatPosition, ArcSegment } from '../types/satellite'
import type { SatCategory } from '../types/satellite'
import type { UserLocation } from '../hooks/useUserLocation'
import { useKeyboardInput } from '../hooks/useKeyboardInput'
import { useShuttleFlight } from '../hooks/useShuttleFlight'
import { tickShuttle, MAX_SPEED_FRAC } from '../lib/shuttlePhysics'
import { useGameObstacles, COLLISION_RADIUS } from '../hooks/useGameObstacles'
import { buildPacmanLevel, queryPelletsNear } from '../lib/pacmanLevel'
import type { Pellet } from '../lib/pacmanLevel'
import {
  tickPacmanPlayer, tickGhost, PELLET_EAT_RADIUS, GHOST_CATCH_RADIUS,
  POWER_DURATION_SEC, PLAYER_LIVES, GHOST_COLORS,
} from '../lib/pacmanPhysics'
import type { PacmanActor, GhostActor } from '../lib/pacmanPhysics'
import { PROGRESS_MESSAGES, POWER_MESSAGES, GHOST_MESSAGES, WIN_MESSAGES, PROGRESS_MILESTONES, pickMessage } from '../lib/pacmanMessages'
import type { ShuttleTelemetry, PacmanTelemetry, PacmanGameOverState, GameMode, PacmanScope } from '../types/game'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
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
  scaleMode: ScaleMode
  gameMode: GameMode
  pacmanScope: PacmanScope | null
  restartKey: number
  onSelectSat: (sat: SatelliteRecord & SatPosition) => void
  onCollision: (survivedSec: number) => void
  onTelemetry: (t: ShuttleTelemetry) => void
  onPacmanTelemetry: (t: PacmanTelemetry) => void
  onPacmanGameOver: (s: PacmanGameOverState) => void
  onPacmanPopup: (message: string) => void
  // XR menu wiring — the in-scene 3D menu fires these
  visibleCount: number
  totalCount: number
  onToggleCategory: (cat: SatCategory) => void
  onToggleZone: (name: string) => void
  onTogglePassthrough: () => void
  onLocateXR: () => void
  onExitXR: () => void
}

export type ScaleMode = 'compressed' | 'true'

const EARTH_RADIUS_KM = 6378.137

// Log scale: 0 = surface, ~0.05 = ISS, ~0.6 = GPS, ~0.8 = GEO — keeps LEO/MEO/GEO
// all visible in one frame instead of GEO satellites sitting ~5.6 globe-radii out.
function altToVisualCompressed(altKm: number): number {
  if (altKm <= 0) return 0
  const clamped = Math.min(altKm, 42_164)
  return Math.log(clamped / 150 + 1) / Math.log(42_164 / 150 + 1) * 0.8
}

// Physically accurate: altitude expressed in Earth radii above the surface.
function altToVisualTrueScale(altKm: number): number {
  return Math.max(altKm, 0) / EARTH_RADIUS_KM
}

// Inverse of altToVisualCompressed — lets the game HUD show an honest real-km
// altitude reading even though the shuttle flies in the log-compressed frame.
// The shuttle isn't orbit-constrained like the satellites, so a straight-line
// flight path can carry it well past the GEO-equivalent visual radius the
// forward mapping was designed for; clamp the input so the inverse doesn't
// extrapolate into physically meaningless (and numerically explosive) output.
function visualToAltKmCompressed(visualAlt: number): number {
  const clamped = Math.max(0, Math.min(visualAlt, 0.8))
  if (clamped <= 0) return 0
  const ratio = Math.exp((clamped / 0.8) * Math.log(42_164 / 150 + 1)) - 1
  return ratio * 150
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

// Shuttle mesh — apex points along local -Z to match the forward convention
// used by tickShuttle/the chase camera.
const _shuttleGeo = new THREE.ConeGeometry(1.5, 5, 8)
_shuttleGeo.rotateX(-Math.PI / 2)
const _shuttleMat = new THREE.MeshBasicMaterial({ color: '#f8fafc' })

// Pacman + ghost meshes — geometry shared/never disposed like the shuttle's;
// ghost materials are created per-session (need live frighten-tint updates)
// and disposed on session cleanup. Sized against the 0.5-radius satellite
// dots for legibility at the same full-globe zoom the game camera uses.
const _pacmanGeo = new THREE.SphereGeometry(1.4, 12, 8)
const _pacmanMat = new THREE.MeshBasicMaterial({ color: '#facc15' })
const _ghostGeo = new THREE.SphereGeometry(1.1, 10, 8)
const _frightenedColor = new THREE.Color('#1d4ed8')

const GAME_SPAWN_ALT_KM = 550 // Starlink shell
const GAME_CHASE_DISTANCE = 10
const GAME_CHASE_HEIGHT = 3
// Matches globe.gl's own default landing altitude (2.5 globe-radii above the
// surface) — the game camera never leaves this full-globe framing.
const PACMAN_CAM_ALTITUDE = 2.5

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
    satellites, positions, activeCategories, groundTrack, userLocation, visibleZones, scaleMode,
    gameMode, pacmanScope, restartKey, onSelectSat, onCollision, onTelemetry, onPacmanTelemetry,
    onPacmanGameOver, onPacmanPopup, visibleCount, totalCount, onToggleCategory, onToggleZone,
    onTogglePassthrough, onLocateXR, onExitXR,
  }, ref) {
    const globeRef = useRef<GlobeMethods | undefined>(undefined)
    const orbitLineRef = useRef<THREE.Line | null>(null)
    const zoneShellsRef = useRef<THREE.Group[]>([])
    const altToVisual = scaleMode === 'true' ? altToVisualTrueScale : altToVisualCompressed

    // Controls react-globe.gl's skysphere visibility. Empty string → skysphere hidden.
    // This is the only reliable way to hide the background in XR: the library owns
    // a BackSide sphere mesh that is not accessible via scene.background.
    const [bgUrl, setBgUrl] = useState(SKY_URL)

    const keysRef = useKeyboardInput(gameMode !== null)
    const { stateRef: shuttleStateRef, reset: resetShuttle } = useShuttleFlight()
    const [pacmanPellets, setPacmanPellets] = useState<Pellet[]>([])

    const getCoords = useCallback((lat: number, lng: number, altVisual: number) => {
      const globe = globeRef.current
      return globe ? globe.getCoords(lat, lng, altVisual) : { x: 0, y: 0, z: 0 }
    }, [])
    const { getNearestObstacle, reset: resetObstacles } = useGameObstacles(
      satellites, positions, getCoords, altToVisual, gameMode === 'shuttle'
    )

    // Latest-callback refs so the game-loop effects don't need to re-run
    // (and re-spawn the shuttle/level) every time a parent re-render passes
    // new inline function props — same pattern as visibleZonesRef below.
    const onCollisionRef = useRef(onCollision)
    onCollisionRef.current = onCollision
    const onTelemetryRef = useRef(onTelemetry)
    onTelemetryRef.current = onTelemetry
    const onPacmanTelemetryRef = useRef(onPacmanTelemetry)
    onPacmanTelemetryRef.current = onPacmanTelemetry
    const onPacmanGameOverRef = useRef(onPacmanGameOver)
    onPacmanGameOverRef.current = onPacmanGameOver
    const onPacmanPopupRef = useRef(onPacmanPopup)
    onPacmanPopupRef.current = onPacmanPopup

    const onSelectSatRef = useRef(onSelectSat)
    useEffect(() => { onSelectSatRef.current = onSelectSat }, [onSelectSat])

    // Read via ref inside buildZones so toggling zone visibility doesn't force
    // a full geometry rebuild — only a scale-mode change (altToVisual) should.
    const visibleZonesRef = useRef(visibleZones)
    visibleZonesRef.current = visibleZones

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

    // Zone boundary shells — explicit lat/lng rings so the grid is evenly distributed,
    // not concentrated at the poles the way EdgesGeometry is.
    const buildZones = useCallback(() => {
      const globe = globeRef.current
      if (!globe) return
      const scene = globe.scene()

      // Tear down any shells built under the previous scale mode first.
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

      for (const z of ORBITAL_ZONES) {
        const visualAlt = altToVisual(z.altKm)
        const mat = new THREE.LineBasicMaterial({ color: z.color, transparent: true, opacity: 0.45 })
        const group = new THREE.Group()
        group.visible = visibleZonesRef.current.has(z.name)

        // 5 latitude parallels
        for (const lat of [-60, -30, 0, 30, 60]) {
          const pts: THREE.Vector3[] = []
          for (let i = 0; i <= 128; i++) {
            const lng = (i / 128) * 360 - 180
            const c = globe.getCoords(lat, lng, visualAlt)
            pts.push(new THREE.Vector3(c.x, c.y, c.z))
          }
          group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat))
        }

        // 8 meridians every 45°
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
    }, [altToVisual])

    // Rebuilds the zone shells whenever the altitude scale mode toggles
    // (also fires harmlessly pre-mount, before the globe is ready).
    useEffect(() => {
      buildZones()
    }, [buildZones])

    useEffect(() => {
      zoneShellsRef.current.forEach((group, i) => {
        group.visible = visibleZones.has(ORBITAL_ZONES[i].name)
      })
    }, [visibleZones])

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

    // Game mode: take over the camera from OrbitControls for the duration of
    // the session (entry → exit), independent of any in-session restarts.
    // OrbitControls.update() unconditionally recomputes the camera transform
    // from its own spherical/target state on every call, and three-globe's
    // internal render loop calls it every frame regardless of `enabled` — so
    // `enabled = false` alone isn't enough, update() itself has to be
    // neutralized or it will stomp the game-driven camera each frame.
    useEffect(() => {
      const globe = globeRef.current
      if (!globe || gameMode === null) return

      const controls = globe.controls() as OrbitControls
      const priorPov = globe.pointOfView()
      const priorEnabled = controls.enabled
      const priorAutoRotate = controls.autoRotate
      const originalUpdate = controls.update.bind(controls)
      controls.enabled = false
      controls.update = () => false

      return () => {
        controls.update = originalUpdate
        controls.enabled = priorEnabled
        controls.autoRotate = priorAutoRotate
        globe.pointOfView(priorPov, 800)
      }
    }, [gameMode])

    // Shuttle spawn + flight loop. Re-runs on every restart (restartKey bump)
    // as well as on initial entry, without touching the controls takeover above.
    useEffect(() => {
      const globe = globeRef.current
      if (!globe || gameMode !== 'shuttle') return

      const camera = globe.camera()
      const scene = globe.scene()
      const worldRadius = globe.getGlobeRadius()

      resetObstacles()

      const shellRadius = worldRadius * (1 + altToVisual(GAME_SPAWN_ALT_KM))
      const spawnCoords = globe.getCoords(0, 0, altToVisual(GAME_SPAWN_ALT_KM))
      const spawnPosition = new THREE.Vector3(spawnCoords.x, spawnCoords.y, spawnCoords.z)
      const radial = spawnPosition.clone().normalize()
      const east = new THREE.Vector3(0, 1, 0).cross(radial).normalize()
      // A plain Object3D's lookAt() points its +Z (not -Z) at the target, so a
      // THREE.Camera is used here to get the -Z-is-forward convention tickShuttle
      // assumes (Object3D.lookAt swaps eye/target internally for non-camera objects).
      const spawnFacing = new THREE.Camera()
      spawnFacing.position.copy(spawnPosition)
      spawnFacing.up.copy(radial)
      spawnFacing.lookAt(spawnPosition.clone().add(east))
      resetShuttle(spawnPosition, spawnFacing.quaternion)

      const shuttle = new THREE.Mesh(_shuttleGeo, _shuttleMat)
      shuttle.position.copy(spawnPosition)
      shuttle.quaternion.copy(spawnFacing.quaternion)
      scene.add(shuttle)

      let rafId = 0
      let lastFrame = performance.now()
      const startTime = lastFrame
      let ended = false
      const forward = new THREE.Vector3()
      const up = new THREE.Vector3()

      const loop = (now: number) => {
        const dt = Math.min((now - lastFrame) / 1000, 0.1)
        lastFrame = now

        const state = shuttleStateRef.current
        tickShuttle(state, keysRef.current, dt, worldRadius, shellRadius)

        shuttle.position.copy(state.position)
        shuttle.quaternion.copy(state.quaternion)

        // Rigid third-person chase camera: fixed offset behind/above the shuttle.
        forward.set(0, 0, -1).applyQuaternion(state.quaternion)
        up.set(0, 1, 0).applyQuaternion(state.quaternion)
        camera.position.copy(state.position)
          .addScaledVector(forward, -GAME_CHASE_DISTANCE)
          .addScaledVector(up, GAME_CHASE_HEIGHT)
        camera.quaternion.copy(state.quaternion)

        const nearest = getNearestObstacle(state.position, now)
        const elapsedSec = (now - startTime) / 1000
        onTelemetryRef.current({
          speedPct: (state.speed / (worldRadius * MAX_SPEED_FRAC)) * 100,
          altitudeKm: visualToAltKmCompressed(state.position.length() / worldRadius - 1),
          proximity: nearest ? nearest.distance : null,
          elapsedSec,
        })

        if (nearest && nearest.distance <= COLLISION_RADIUS && !ended) {
          ended = true
          onCollisionRef.current(elapsedSec)
          return // hard game-over: freeze in place, no further frames scheduled
        }

        rafId = requestAnimationFrame(loop)
      }
      rafId = requestAnimationFrame(loop)

      return () => {
        cancelAnimationFrame(rafId)
        scene.remove(shuttle)
      }
    }, [gameMode, restartKey, altToVisual, resetShuttle, resetObstacles, getNearestObstacle, keysRef, shuttleStateRef])

    // Pacman spawn + game loop. `satellites`/`positions` are deliberately
    // omitted from the deps array: the level is a one-time snapshot taken
    // when the session starts (entry or restartKey bump), not a live feed —
    // including them would silently regenerate the whole board every time
    // the propagator ticks.
    useEffect(() => {
      const globe = globeRef.current
      if (!globe || gameMode !== 'pacman' || pacmanScope === null) return

      const camera = globe.camera()
      const scene = globe.scene()
      const worldRadius = globe.getGlobeRadius()

      const level = buildPacmanLevel(satellites, positions, getCoords, altToVisual, pacmanScope)
      if (!level) return // not enough Starlink data loaded yet

      const player: PacmanActor = {
        position: level.playerSpawn.clone(),
        // Cloned, not aliased — level.frame stays fixed at the level center
        // for ghost waypoint sampling, while the player's own frame is
        // carried forward (parallel-transported) as they move.
        frame: { north: level.frame.north.clone(), east: level.frame.east.clone() },
      }
      const ghosts: GhostActor[] = level.ghostSpawns.map(spawn => ({
        position: spawn.clone(),
        waypoint: spawn.clone(),
        mode: 'wander',
      }))

      const eaten = new Set<string>()
      let score = 0
      let lives = PLAYER_LIVES
      let poweredUntil = 0
      let invulnUntil = performance.now() + 2500
      let ended = false

      // Sarcastic popup state: track which progress-milestone fraction we've
      // already fired (milestones are ascending, so a single cursor suffices)
      // and the last message shown per pool so back-to-back popups don't repeat.
      let nextMilestoneIdx = 0
      let lastProgressMsg: string | undefined
      let lastPowerMsg: string | undefined
      let lastGhostMsg: string | undefined

      setPacmanPellets(Array.from(level.pellets.values()))

      const playerMesh = new THREE.Mesh(_pacmanGeo, _pacmanMat)
      playerMesh.position.copy(player.position)
      scene.add(playerMesh)

      const ghostMats = ghosts.map((_, i) => new THREE.MeshBasicMaterial({ color: GHOST_COLORS[i % GHOST_COLORS.length] }))
      const ghostMeshes = ghosts.map((g, i) => {
        const mesh = new THREE.Mesh(_ghostGeo, ghostMats[i])
        mesh.position.copy(g.position)
        scene.add(mesh)
        return mesh
      })

      let rafId = 0
      let lastFrame = performance.now()
      const camDist = worldRadius * (1 + PACMAN_CAM_ALTITUDE)

      const loop = (now: number) => {
        const dt = Math.min((now - lastFrame) / 1000, 0.1)
        lastFrame = now

        tickPacmanPlayer(player, keysRef.current, dt, worldRadius, level.shellRadius)
        playerMesh.position.copy(player.position)

        const frightened = now < poweredUntil
        for (let i = 0; i < ghosts.length; i++) {
          tickGhost(ghosts[i], player.position, level.center, level.frame, level.extentRadius, frightened, dt, worldRadius, level.shellRadius)
          ghostMeshes[i].position.copy(ghosts[i].position)
          ghostMats[i].color.set(frightened ? _frightenedColor : GHOST_COLORS[i % GHOST_COLORS.length])
        }

        let ateSomething = false
        for (const pellet of queryPelletsNear(level, player.position, PELLET_EAT_RADIUS)) {
          if (eaten.has(pellet.id)) continue
          eaten.add(pellet.id)
          ateSomething = true
          if (pellet.power) {
            poweredUntil = now + POWER_DURATION_SEC * 1000
            score += 50
            lastPowerMsg = pickMessage(POWER_MESSAGES, lastPowerMsg)
            onPacmanPopupRef.current(lastPowerMsg)
          } else {
            score += 10
          }
        }
        if (ateSomething) {
          setPacmanPellets(prev => prev.filter(p => !eaten.has(p.id)))

          const eatenFrac = eaten.size / level.pellets.size
          let crossedMilestone = false
          while (nextMilestoneIdx < PROGRESS_MILESTONES.length && eatenFrac >= PROGRESS_MILESTONES[nextMilestoneIdx]) {
            nextMilestoneIdx++
            crossedMilestone = true
          }
          if (crossedMilestone) {
            lastProgressMsg = pickMessage(PROGRESS_MESSAGES, lastProgressMsg)
            onPacmanPopupRef.current(lastProgressMsg)
          }
        }

        if (!ended && now > invulnUntil) {
          for (let i = 0; i < ghosts.length; i++) {
            if (ghosts[i].position.distanceTo(player.position) > GHOST_CATCH_RADIUS) continue
            if (now < poweredUntil) {
              score += 200
              ghosts[i].position.copy(level.ghostSpawns[i])
              ghosts[i].waypoint.copy(level.ghostSpawns[i])
              ghosts[i].mode = 'wander'
            } else {
              lives -= 1
              invulnUntil = now + 2000
              player.position.copy(level.playerSpawn)
              // Send the catching ghost home too — otherwise it sits right on
              // the player's respawn point and the next life is lost for free.
              ghosts[i].position.copy(level.ghostSpawns[i])
              ghosts[i].waypoint.copy(level.ghostSpawns[i])
              ghosts[i].mode = 'wander'
              lastGhostMsg = pickMessage(GHOST_MESSAGES, lastGhostMsg)
              if (lives <= 0) {
                ended = true
                onPacmanGameOverRef.current({ won: false, score, message: lastGhostMsg })
              } else {
                onPacmanPopupRef.current(lastGhostMsg)
              }
            }
            break
          }
        }

        const pelletsRemaining = level.pellets.size - eaten.size
        onPacmanTelemetryRef.current({
          score,
          pelletsRemaining,
          pelletsTotal: level.pellets.size,
          lives,
          powered: now < poweredUntil,
          powerRemainingSec: Math.max(0, (poweredUntil - now) / 1000),
        })

        if (!ended && pelletsRemaining === 0) {
          ended = true
          onPacmanGameOverRef.current({ won: true, score, message: pickMessage(WIN_MESSAGES) })
        }

        // Full-globe camera, matching the app's default landing view: always
        // positioned along the ray from globe-center through the player and
        // looking at globe-center. The player's own direction from center
        // *is* the camera direction, so it always projects to screen center
        // and moving it reads as the globe rotating underneath a fixed
        // camera — no per-keypress reorientation like a chase cam would have.
        camera.position.copy(player.position).normalize().multiplyScalar(camDist)
        camera.up.set(0, 1, 0)
        camera.lookAt(0, 0, 0)

        if (!ended) rafId = requestAnimationFrame(loop)
      }
      rafId = requestAnimationFrame(loop)

      return () => {
        cancelAnimationFrame(rafId)
        scene.remove(playerMesh)
        for (let i = 0; i < ghostMeshes.length; i++) {
          scene.remove(ghostMeshes[i])
          ghostMats[i].dispose()
        }
        setPacmanPellets([])
      }
    }, [gameMode, pacmanScope, restartKey, altToVisual, getCoords, keysRef])

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
        if (orbitLineRef.current === line) orbitLineRef.current = null
      }
    }, [groundTrack, altToVisual])

    const satById = useMemo(() => new Map(satellites.map(s => [s.id, s])), [satellites])

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

    // Pacman renders frozen pellet snapshots (not live `positions`) through the
    // same instanced dot layer — power pellets get a distinct color.
    const pacmanPointsData = useMemo<PointDatum[]>(() => {
      const result: PointDatum[] = []
      for (const pellet of pacmanPellets) {
        const sat = satById.get(pellet.id)
        if (!sat) continue
        result.push({
          ...sat,
          lat: pellet.lat, lng: pellet.lng, alt: pellet.alt, velocity: 0,
          color: pellet.power ? '#fde047' : sat.color,
        })
      }
      return result
    }, [pacmanPellets, satById])

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
        rendererConfig={{ alpha: true, antialias: true }}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        backgroundImageUrl={bgUrl}
        customLayerData={gameMode === 'pacman' ? pacmanPointsData : pointsData}
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
        onGlobeReady={buildZones}
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
