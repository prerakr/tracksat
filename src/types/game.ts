export type GameMode = 'shuttle' | 'pacman' | null

export interface ShuttleTelemetry {
  speedPct: number
  altitudeKm: number
  proximity: number | null // world units to the nearest in-play obstacle
  elapsedSec: number
}

export interface GameOverState {
  survivedSec: number
}

export interface PacmanTelemetry {
  score: number
  pelletsRemaining: number
  pelletsTotal: number
  lives: number
  powered: boolean
  powerRemainingSec: number
}

export interface PacmanGameOverState {
  won: boolean
  score: number
}
