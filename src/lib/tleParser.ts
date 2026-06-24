import type { SatelliteRecord } from '../types/satellite'
import { classifySatellite, CATEGORY_COLORS } from './categories'

const RE = 6378.137    // Earth equatorial radius km
const MU = 398600.4418 // Earth gravitational parameter km³/s²

// Parse orbital parameters directly from TLE lines — no external deps needed
function parseTLEParams(tle2: string) {
  const inclination = parseFloat(tle2.substring(8, 16))
  const eccentricity = parseFloat('0.' + tle2.substring(26, 33).trim())
  const meanMotionRevDay = parseFloat(tle2.substring(52, 63))

  const period = meanMotionRevDay > 0 ? 1440 / meanMotionRevDay : 90
  const n = (meanMotionRevDay * 2 * Math.PI) / 86400  // rad/s
  const a = Math.pow(MU / (n * n), 1 / 3)             // semi-major axis km
  const apogee = a * (1 + eccentricity) - RE
  const perigee = a * (1 - eccentricity) - RE

  return { inclination, period, apogee, perigee }
}

export interface TLEItem {
  satelliteId: number
  name: string
  line1: string
  line2: string
}

export function parseTLEItems(items: TLEItem[]): SatelliteRecord[] {
  return items
    .filter(item => item.line1 && item.line2)
    .map(item => {
      const name = item.name.trim()
      const category = classifySatellite(name)
      const { inclination, period, apogee, perigee } = parseTLEParams(item.line2)
      return {
        id: String(item.satelliteId),
        name,
        tle1: item.line1,
        tle2: item.line2,
        category,
        color: CATEGORY_COLORS[category],
        period,
        inclination,
        apogee,
        perigee,
      } satisfies SatelliteRecord
    })
}
