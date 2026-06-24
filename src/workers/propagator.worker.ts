import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js'
import type { SatRec } from 'satellite.js'
import type { SatPosition } from '../types/satellite'

interface InitMsg { type: 'INIT'; sats: Array<{ id: string; tle1: string; tle2: string }> }
interface TickMsg { type: 'TICK'; timestamp: number }
type InMsg = InitMsg | TickMsg

interface PositionsMsg { type: 'POSITIONS'; positions: SatPosition[] }

interface WorkerSat { id: string; satrec: SatRec }

let workerSats: WorkerSat[] = []

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data

  if (msg.type === 'INIT') {
    workerSats = []
    for (const s of msg.sats) {
      try {
        workerSats.push({ id: s.id, satrec: twoline2satrec(s.tle1, s.tle2) })
      } catch {
        // skip bad TLE records
      }
    }
    return
  }

  if (msg.type === 'TICK') {
    const date = new Date(msg.timestamp)
    const gmst = gstime(date)
    const positions: SatPosition[] = []

    for (const sat of workerSats) {
      const result = propagate(sat.satrec, date)
      if (!result) continue
      const gd = eciToGeodetic(result.position, gmst)
      const { x, y, z } = result.velocity
      positions.push({
        id: sat.id,
        lat: degreesLat(gd.latitude),
        lng: degreesLong(gd.longitude),
        alt: gd.height,
        velocity: Math.sqrt(x * x + y * y + z * z),
      })
    }

    const reply: PositionsMsg = { type: 'POSITIONS', positions }
    self.postMessage(reply)
  }
}
