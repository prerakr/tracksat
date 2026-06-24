export type SatCategory =
  | 'starlink'
  | 'gps'
  | 'iss'
  | 'weather'
  | 'scientific'
  | 'comms'
  | 'other'

export interface SatelliteRecord {
  id: string
  name: string
  tle1: string
  tle2: string
  category: SatCategory
  color: string
  period: number      // minutes
  inclination: number // degrees
  apogee: number      // km
  perigee: number     // km
}

export interface SatPosition {
  id: string
  lat: number
  lng: number
  alt: number      // km
  velocity: number // km/s
}

export interface ArcSegment {
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  altKm: number
}
