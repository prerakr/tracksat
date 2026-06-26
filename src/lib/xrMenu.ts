import * as THREE from 'three'
import type { SatCategory } from '../types/satellite'

// A self-contained 3D menu rendered as a single textured plane in world space.
// Quest's WebXR browser does not reliably composite a `dom-overlay`, so any HTML
// UI is invisible in-headset. This menu instead lives in the XR framebuffer (the
// same path the globe renders through, which works), and is operated with the
// controller ray or a hand pinch-poke.

export interface XRMenuState {
  visibleCount: number
  totalCount: number
  passthrough: boolean
  hasLocation: boolean
  categories: { id: SatCategory; label: string; color: string; active: boolean }[]
  zones: { id: string; label: string; color: string; active: boolean }[]
}

export interface XRMenuCallbacks {
  onToggleCategory: (id: SatCategory) => void
  onToggleZone: (id: string) => void
  onTogglePassthrough: () => void
  onLocate: () => void
  onExit: () => void
}

type HitAction =
  | { kind: 'passthrough' }
  | { kind: 'locate' }
  | { kind: 'exit' }
  | { kind: 'category'; id: SatCategory }
  | { kind: 'zone'; id: string }

interface Row {
  y0: number
  y1: number
  action: HitAction | null  // null = non-interactive (title / section label)
}

const CANVAS_W = 512
const CANVAS_H = 940

const TITLE_H  = 70
const LABEL_H  = 38
const BTN_H    = 56
const PAD_X    = 18
const GAP      = 6

// Real-world size of the panel (metres). Aspect must match the canvas.
const PLANE_W = 0.42
const PLANE_H = PLANE_W * (CANVAS_H / CANVAS_W)

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export class XRMenu {
  readonly mesh: THREE.Mesh
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private texture: THREE.CanvasTexture
  private rows: Row[] = []
  private getState: () => XRMenuState
  private cb: XRMenuCallbacks

  constructor(getState: () => XRMenuState, cb: XRMenuCallbacks) {
    this.getState = getState
    this.cb = cb

    this.canvas = document.createElement('canvas')
    this.canvas.width = CANVAS_W
    this.canvas.height = CANVAS_H
    this.ctx = this.canvas.getContext('2d')!

    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 4

    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,   // always drawn on top within its own render pass
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_W, PLANE_H), mat)
    this.mesh.renderOrder = 999

    // Body-locked-ish: fixed to the left of the globe, angled toward the user
    // who starts near the origin looking down -Z. The caller adds `mesh` to the
    // (unscaled) XR rig scene.
    this.mesh.position.set(-0.62, 1.15, -0.55)
    this.mesh.rotation.y = 0.6

    this.redraw()
  }

  /** Re-render the canvas texture from the current state. */
  redraw() {
    const s = this.getState()
    const ctx = this.ctx
    this.rows = []

    // Panel background
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.fillStyle = 'rgba(7, 13, 26, 0.96)'
    roundRect(ctx, 0, 0, CANVAS_W, CANVAS_H, 28)
    ctx.fill()
    ctx.strokeStyle = 'rgba(100,116,139,0.5)'
    ctx.lineWidth = 2
    roundRect(ctx, 1, 1, CANVAS_W - 2, CANVAS_H - 2, 28)
    ctx.stroke()

    let y = 18

    // Title
    ctx.fillStyle = '#e2e8f0'
    ctx.font = 'bold 30px monospace'
    ctx.textBaseline = 'middle'
    ctx.fillText('TrackSat XR', PAD_X, y + TITLE_H / 2 - 8)
    ctx.fillStyle = '#64748b'
    ctx.font = '18px monospace'
    ctx.fillText(`${s.visibleCount.toLocaleString()} / ${s.totalCount.toLocaleString()} visible`, PAD_X, y + TITLE_H / 2 + 18)
    this.rows.push({ y0: y, y1: y + TITLE_H, action: null })
    y += TITLE_H + GAP

    // Action buttons
    y = this.drawButton(y, 'Passthrough', s.passthrough ? '#38bdf8' : '#475569', s.passthrough, { kind: 'passthrough' }, s.passthrough ? 'ON' : 'OFF')
    if (s.hasLocation) {
      y = this.drawButton(y, 'Locate Me', '#60a5fa', false, { kind: 'locate' })
    }
    y = this.drawButton(y, 'Exit AR', '#f87171', false, { kind: 'exit' }, undefined, true)

    y += GAP
    y = this.drawLabel(y, 'SATELLITES')
    for (const c of s.categories) {
      y = this.drawButton(y, c.label, c.color, c.active, { kind: 'category', id: c.id })
    }

    y += GAP
    y = this.drawLabel(y, 'ORBITAL ZONES')
    for (const z of s.zones) {
      y = this.drawButton(y, z.label, z.color, z.active, { kind: 'zone', id: z.id })
    }

    this.texture.needsUpdate = true
  }

  private drawLabel(y: number, text: string): number {
    const ctx = this.ctx
    ctx.fillStyle = '#475569'
    ctx.font = 'bold 16px monospace'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, PAD_X, y + LABEL_H / 2)
    this.rows.push({ y0: y, y1: y + LABEL_H, action: null })
    return y + LABEL_H
  }

  private drawButton(
    y: number, label: string, color: string, active: boolean,
    action: HitAction, suffix?: string, danger?: boolean,
  ): number {
    const ctx = this.ctx
    const x = PAD_X
    const w = CANVAS_W - PAD_X * 2
    const h = BTN_H - 4

    // Pill background
    ctx.fillStyle = active ? hexA(color, 0.22) : 'rgba(30,41,59,0.55)'
    roundRect(ctx, x, y, w, h, 14)
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = active ? hexA(color, 0.85) : (danger ? hexA(color, 0.5) : 'rgba(71,85,105,0.5)')
    roundRect(ctx, x, y, w, h, 14)
    ctx.stroke()

    // Status dot
    ctx.beginPath()
    ctx.arc(x + 24, y + h / 2, 9, 0, Math.PI * 2)
    ctx.fillStyle = active ? color : '#334155'
    ctx.fill()

    // Label
    ctx.fillStyle = active ? color : (danger ? color : '#94a3b8')
    ctx.font = 'bold 24px monospace'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + 46, y + h / 2 + 1)

    if (suffix) {
      ctx.fillStyle = active ? color : '#475569'
      ctx.font = 'bold 22px monospace'
      ctx.textAlign = 'right'
      ctx.fillText(suffix, x + w - 18, y + h / 2 + 1)
      ctx.textAlign = 'left'
    }

    this.rows.push({ y0: y, y1: y + h, action })
    return y + BTN_H
  }

  /** Map a UV hit (u,v in [0,1], origin bottom-left) to an action and fire it. */
  private fireAtUV(u: number, v: number): boolean {
    const canvasY = (1 - v) * CANVAS_H
    for (const row of this.rows) {
      if (canvasY >= row.y0 && canvasY <= row.y1 && row.action) {
        this.fire(row.action)
        return true
      }
    }
    // Hit the panel background but no button — still consume the input.
    return u >= 0 && u <= 1 && v >= 0 && v <= 1
  }

  private fire(a: HitAction) {
    switch (a.kind) {
      case 'passthrough': this.cb.onTogglePassthrough(); break
      case 'locate':      this.cb.onLocate(); break
      case 'exit':        this.cb.onExit(); break
      case 'category':    this.cb.onToggleCategory(a.id); break
      case 'zone':        this.cb.onToggleZone(a.id); break
    }
  }

  /** Controller ray interaction. Returns true if the ray hit the panel. */
  hitFromRay(raycaster: THREE.Raycaster): boolean {
    const hits = raycaster.intersectObject(this.mesh, false)
    if (hits.length === 0 || !hits[0].uv) return false
    return this.fireAtUV(hits[0].uv.x, hits[0].uv.y)
  }

  /** Hand pinch-poke interaction: is the world point on/near the panel surface? */
  private _local = new THREE.Vector3()
  hitFromPoint(worldPoint: THREE.Vector3): boolean {
    this.mesh.updateMatrixWorld()
    this._local.copy(worldPoint)
    this.mesh.worldToLocal(this._local)
    const hw = PLANE_W / 2, hh = PLANE_H / 2
    if (Math.abs(this._local.z) > 0.06) return false
    if (this._local.x < -hw || this._local.x > hw) return false
    if (this._local.y < -hh || this._local.y > hh) return false
    const u = (this._local.x + hw) / PLANE_W
    const v = (this._local.y + hh) / PLANE_H
    return this.fireAtUV(u, v)
  }

  dispose() {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.texture.dispose()
  }
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}
