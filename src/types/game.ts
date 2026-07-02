export interface ShuttleTelemetry {
  speedPct: number
  altitudeKm: number
  proximity: number | null // world units to the nearest in-play obstacle
  elapsedSec: number
}

export interface GameOverState {
  survivedSec: number
}
