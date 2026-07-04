import type * as THREE from 'three'

export interface GridEntry {
  id: string
  position: THREE.Vector3
}

function cellKey(x: number, y: number, z: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}:${Math.floor(z / cellSize)}`
}

// Uniform 3D grid over world-space positions — rebuilt once per obstacle tick
// (not per frame) since bucket membership barely changes within a 2s tick.
export function buildSpatialGrid(entries: GridEntry[], cellSize: number): Map<string, string[]> {
  const grid = new Map<string, string[]>()
  for (const { id, position } of entries) {
    const key = cellKey(position.x, position.y, position.z, cellSize)
    let bucket = grid.get(key)
    if (!bucket) { bucket = []; grid.set(key, bucket) }
    bucket.push(id)
  }
  return grid
}

const NEIGHBOR_OFFSETS: Array<[number, number, number]> = []
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) NEIGHBOR_OFFSETS.push([dx, dy, dz])
  }
}

// Only the querying point's cell + its 26 neighbors are checked, keeping
// narrow-phase cost independent of total obstacle count.
export function queryNearbyIds(grid: Map<string, string[]>, position: THREE.Vector3, cellSize: number): string[] {
  const cx = Math.floor(position.x / cellSize)
  const cy = Math.floor(position.y / cellSize)
  const cz = Math.floor(position.z / cellSize)
  const result: string[] = []
  for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
    const bucket = grid.get(`${cx + dx}:${cy + dy}:${cz + dz}`)
    if (bucket) result.push(...bucket)
  }
  return result
}
