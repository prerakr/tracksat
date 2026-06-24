import { useState, useEffect } from 'react'
import type { SatelliteRecord } from '../types/satellite'
import { parseTLEItems, type TLEItem } from '../lib/tleParser'

const CACHE_KEY = 'tracksat_tle_data'
const CACHE_TS_KEY = 'tracksat_tle_ts'
const CACHE_TTL = 6 * 60 * 60 * 1000

const API_BASE = 'https://tle.ivanstanojevic.me/api/tle'
const PAGE_SIZE = 100
const MAX_PAGES = 50

async function fetchPage(page: number): Promise<TLEItem[]> {
  try {
    const res = await fetch(`${API_BASE}/?page-size=${PAGE_SIZE}&page=${page}`)
    if (!res.ok) return []
    const data = await res.json() as { member?: TLEItem[] }
    return data.member ?? []
  } catch {
    return []
  }
}

export function useSatellites() {
  const [satellites, setSatellites] = useState<SatelliteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  useEffect(() => {
    async function load() {
      const cachedTs = localStorage.getItem(CACHE_TS_KEY)
      const now = Date.now()

      if (cachedTs && now - Number(cachedTs) < CACHE_TTL) {
        const raw = localStorage.getItem(CACHE_KEY)
        if (raw) {
          try {
            setSatellites(parseTLEItems(JSON.parse(raw) as TLEItem[]))
            setLastFetch(new Date(Number(cachedTs)))
            setLoading(false)
            return
          } catch {
            // cache corrupt — fall through
          }
        }
      }

      try {
        // Page 1: get total count AND show first 100 satellites immediately
        const firstRes = await fetch(`${API_BASE}/?page-size=${PAGE_SIZE}&page=1`)
        if (!firstRes.ok) throw new Error(`TLE API error: HTTP ${firstRes.status}`)
        const firstData = await firstRes.json() as { totalItems?: number; member?: TLEItem[] }

        const seen = new Map<number, TLEItem>()
        for (const item of firstData.member ?? []) seen.set(item.satelliteId, item)

        // Show first batch right away — globe populates immediately
        setSatellites(parseTLEItems(Array.from(seen.values())))
        setLoading(false)

        const totalItems = firstData.totalItems ?? 0
        const totalPages = Math.min(MAX_PAGES, Math.ceil(totalItems / PAGE_SIZE))
        const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)

        // Fetch remaining pages in batches of 10, update globe after each batch
        for (let i = 0; i < remaining.length; i += 10) {
          const batch = remaining.slice(i, i + 10)
          const results = await Promise.all(batch.map(fetchPage))
          for (const items of results) {
            for (const item of items) seen.set(item.satelliteId, item)
          }
          setSatellites(parseTLEItems(Array.from(seen.values())))
        }

        // Cache the complete dataset
        const allItems = Array.from(seen.values())
        if (allItems.length === 0) throw new Error('No satellite data received')
        localStorage.setItem(CACHE_KEY, JSON.stringify(allItems))
        localStorage.setItem(CACHE_TS_KEY, String(now))
        setLastFetch(new Date(now))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    }

    load()
  }, [])

  return { satellites, loading, error, lastFetch }
}
