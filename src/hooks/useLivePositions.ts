import { useState, useEffect, useRef } from 'react'
import PropagatorWorker from '../workers/propagator.worker?worker'
import type { SatelliteRecord, SatPosition } from '../types/satellite'

export function useLivePositions(satellites: SatelliteRecord[]) {
  const [positions, setPositions] = useState<Map<string, SatPosition>>(new Map())
  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
    if (satellites.length === 0) return

    const worker = new PropagatorWorker()
    workerRef.current = worker

    worker.postMessage({
      type: 'INIT',
      sats: satellites.map(s => ({ id: s.id, tle1: s.tle1, tle2: s.tle2 })),
    })

    worker.onmessage = (e: MessageEvent<{ type: 'POSITIONS'; positions: SatPosition[] }>) => {
      if (e.data.type === 'POSITIONS') {
        const map = new Map<string, SatPosition>()
        for (const p of e.data.positions) map.set(p.id, p)
        setPositions(map)
      }
    }

    const tick = () => worker.postMessage({ type: 'TICK', timestamp: Date.now() })
    tick()
    const interval = setInterval(tick, 2000)

    return () => {
      clearInterval(interval)
      worker.terminate()
    }
  }, [satellites])

  return positions
}
