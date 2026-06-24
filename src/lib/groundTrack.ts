import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js'
import type { SatelliteRecord, ArcSegment } from '../types/satellite'

export function computeGroundTrack(sat: SatelliteRecord, now: Date): ArcSegment[] {
  const satrec = twoline2satrec(sat.tle1, sat.tle2)
  const periodMin = sat.period > 0 ? sat.period : 90
  const totalMin = periodMin * 1.5
  const steps = 360
  const stepMs = (totalMin / steps) * 60_000

  const points: Array<{ lat: number; lng: number; alt: number }> = []

  for (let i = 0; i <= steps; i++) {
    const t = new Date(now.getTime() + i * stepMs)
    const result = propagate(satrec, t)
    if (!result) continue
    const gmst = gstime(t)
    const gd = eciToGeodetic(result.position, gmst)
    points.push({ lat: degreesLat(gd.latitude), lng: degreesLong(gd.longitude), alt: gd.height })
  }

  const segments: ArcSegment[] = []
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    if (Math.abs(curr.lng - prev.lng) > 180) continue
    segments.push({ startLat: prev.lat, startLng: prev.lng, endLat: curr.lat, endLng: curr.lng, altKm: prev.alt })
  }
  return segments
}
