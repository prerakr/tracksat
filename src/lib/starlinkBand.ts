import type { SatelliteRecord } from '../types/satellite'

export const STARLINK_BAND_KM = 50

// Real satellites are sparse enough (tens of km apart even in "crowded" LEO)
// that true-to-life spacing rarely puts them near each other. Starlink is the
// one real cluster dense enough to build a game around, so callers scope play
// to a band around its modal altitude — positions stay real TLE-derived data,
// nothing is fabricated.
export function scopeStarlinkBand(satellites: SatelliteRecord[]): Set<string> {
  const starlink = satellites.filter(s => s.category === 'starlink')
  if (starlink.length === 0) return new Set()
  const midAltitudes = starlink.map(s => (s.apogee + s.perigee) / 2).sort((a, b) => a - b)
  const modal = midAltitudes[Math.floor(midAltitudes.length / 2)]
  const ids = new Set<string>()
  for (const s of starlink) {
    if (Math.abs((s.apogee + s.perigee) / 2 - modal) <= STARLINK_BAND_KM) ids.add(s.id)
  }
  return ids
}
