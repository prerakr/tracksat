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
import { buildPacmanLevel, queryPelletsNear, REGION_RADIUS } from '../lib/pacmanLevel'
import type { Pellet } from '../lib/pacmanLevel'
import {
  tickPacmanPlayer, tickGhost, PELLET_EAT_RADIUS, GHOST_CATCH_RADIUS,
  POWER_DURATION_SEC, PLAYER_LIVES, GHOST_COLORS,
} from '../lib/pacmanPhysics'
import type { PacmanActor, GhostActor } from '../lib/pacmanPhysics'
import type { ShuttleTelemetry, PacmanTelemetry, PacmanGameOverState, GameMode } from '../types/game'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

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
  visibleZones: Set<string>
  scaleMode: ScaleMode
  gameMode: GameMode
  restartKey: number
  onSelectSat: (sat: SatelliteRecord & SatPosition) => void
  onCollision: (survivedSec: number) => void
  onTelemetry: (t: ShuttleTelemetry) => void
  onPacmanTelemetry: (t: PacmanTelemetry) => void
  onPacmanGameOver: (s: PacmanGameOverState) => void
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

export const ORBITAL_ZONES = [
  { name: 'LEO', altKm: 2_000,  color: '#60a5fa', label: '160 – 2,000 km' },
  { name: 'MEO', altKm: 20_200, color: '#a78bfa', label: '2,000 – 35,786 km (GPS ≈ 20,200 km)' },
  { name: 'GEO', altKm: 35_786, color: '#f97316', label: '≈ 35,786 km' },
] as const

export const GlobeView = forwardRef<GlobeViewHandle, Props>(
  function GlobeView({ satellites, positions, activeCategories, groundTrack, userLocation, visibleZones, scaleMode, gameMode, restartKey, onSelectSat, onCollision, onTelemetry, onPacmanTelemetry, onPacmanGameOver }, ref) {
    const globeRef = useRef<GlobeMethods | undefined>(undefined)
    const orbitLineRef = useRef<THREE.Line | null>(null)
    const zoneShellsRef = useRef<THREE.Group[]>([])
    const altToVisual = scaleMode === 'true' ? altToVisualTrueScale : altToVisualCompressed

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

    // Read via ref inside buildZones so toggling zone visibility doesn't force
    // a full geometry rebuild — only a scale-mode change (altToVisual) should.
    const visibleZonesRef = useRef(visibleZones)
    visibleZonesRef.current = visibleZones

    useImperativeHandle(ref, () => ({
      flyTo: (lat, lng, altitude = 1.5) => {
        globeRef.current?.pointOfView({ lat, lng, altitude }, 1200)
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
      if (!globe || gameMode !== 'pacman') return

      const camera = globe.camera()
      const scene = globe.scene()
      const worldRadius = globe.getGlobeRadius()

      const level = buildPacmanLevel(satellites, positions, getCoords, altToVisual)
      if (!level) return // not enough Starlink data loaded yet

      const player: PacmanActor = { position: level.playerSpawn.clone() }
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

        tickPacmanPlayer(player, keysRef.current, dt, worldRadius, level.shellRadius, level.frame)
        playerMesh.position.copy(player.position)

        const frightened = now < poweredUntil
        for (let i = 0; i < ghosts.length; i++) {
          tickGhost(ghosts[i], player.position, level.center, level.frame, REGION_RADIUS, frightened, dt, worldRadius, level.shellRadius)
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
          } else {
            score += 10
          }
        }
        if (ateSomething) {
          setPacmanPellets(prev => prev.filter(p => !eaten.has(p.id)))
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
              if (lives <= 0) {
                ended = true
                onPacmanGameOverRef.current({ won: false, score })
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
          onPacmanGameOverRef.current({ won: true, score })
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
    }, [gameMode, restartKey, altToVisual, getCoords, keysRef])

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
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
        customLayerData={gameMode === 'pacman' ? pacmanPointsData : pointsData}
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
