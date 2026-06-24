import type { SatCategory } from '../types/satellite'

export const ALL_CATEGORIES: SatCategory[] = [
  'starlink', 'gps', 'iss', 'weather', 'scientific', 'comms', 'other',
]

export const CATEGORY_LABELS: Record<SatCategory, string> = {
  starlink:   'Starlink',
  gps:        'GPS/Nav',
  iss:        'Stations',
  weather:    'Weather',
  scientific: 'Science',
  comms:      'Comms',
  other:      'Other',
}

export const CATEGORY_COLORS: Record<SatCategory, string> = {
  starlink:   '#60a5fa',
  gps:        '#fbbf24',
  iss:        '#f97316',
  weather:    '#22c55e',
  scientific: '#a855f7',
  comms:      '#ef4444',
  other:      '#64748b',
}

export function classifySatellite(name: string): SatCategory {
  const n = name.toUpperCase()
  if (n.startsWith('STARLINK') || n.startsWith('ONEWEB')) return 'starlink'
  if (/^(ISS|CSS |TIANGONG|TIANHE|NAUKA|MIR )/.test(n)) return 'iss'
  if (/^(GPS|NAVSTAR|GLONASS|GALILEO|BEIDOU|IRNSS|QZSS|COMPASS)/.test(n)) return 'gps'
  if (/^(NOAA|GOES|METEOSAT|MSG-|METOP|HIMAWARI|FY-|FENGYUN|COMS|INSAT|ELEKTRO)/.test(n)) return 'weather'
  if (/^(HUBBLE|HST|TERRA|AQUA|AURA|CLOUDSAT|CALIPSO|GRACE|SMAP|SENTINEL|LANDSAT|SWOT|ICESAT)/.test(n)) return 'scientific'
  if (/^(IRIDIUM|INTELSAT|SES-|ASTRA |EUTELSAT|VIASAT|TELESAT|O3B|DIRECTV|ECHOSTAR|THURAYA|GLOBALSTAR)/.test(n)) return 'comms'
  return 'other'
}
