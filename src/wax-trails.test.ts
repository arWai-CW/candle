import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { WaxTrailGeometry } from './wax-trails'
import type { WaxBead } from './wax'

const palette = [new Color('#ffffff'), new Color('#ff7aa8')]
const segment = (fromY: number, y: number, color = 0): WaxBead => ({ theta: 0, fromTheta: 0, fromY, y, size: 0.02, color })

/** Count connected skins and check that every edge belongs to exactly two faces. */
function topology(geometry: WaxTrailGeometry) {
  const indices = geometry.index!
  const neighbours = new Map<number, Set<number>>()
  const edges = new Map<string, number>()
  for (let i = 0; i < geometry.drawRange.count; i += 3) {
    const face = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)]
    for (let j = 0; j < 3; j++) {
      const a = face[j], b = face[(j + 1) % 3]
      expect(a).not.toBe(b)
      expect(a).toBeLessThan(geometry.attributes.position.count)
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
      if (!neighbours.has(a)) neighbours.set(a, new Set())
      if (!neighbours.has(b)) neighbours.set(b, new Set())
      neighbours.get(a)!.add(b)
      neighbours.get(b)!.add(a)
    }
  }
  for (const uses of edges.values()) expect(uses).toBe(2)
  const seen = new Set<number>()
  let components = 0
  for (const start of neighbours.keys()) {
    if (seen.has(start)) continue
    components++
    const queue = [start]
    while (queue.length) {
      const next = queue.pop()!
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(...neighbours.get(next)!)
    }
  }
  for (const vertex of seen) {
    for (const attribute of ['position', 'normal']) {
      const values = geometry.attributes[attribute]
      expect([values.getX(vertex), values.getY(vertex), values.getZ(vertex)].every(Number.isFinite)).toBe(true)
    }
  }
  return components
}

describe('continuous cooled wax skin', () => {
  it('welds successive samples into one closed surface without internal collars', () => {
    const geometry = new WaxTrailGeometry(3)
    geometry.update([segment(1, 0.9), segment(0.9, 0.8), segment(0.8, 0.7)], 0.075, palette)
    expect(topology(geometry)).toBe(1)
  })

  it('does not bridge separate runs or blend different wax colors', () => {
    const geometry = new WaxTrailGeometry(3)
    geometry.update([segment(1, 0.9), segment(0.9, 0.8, 1), segment(0.7, 0.6)], 0.075, palette)
    expect(topology(geometry)).toBe(3)
  })

  it('keeps disjoint capped runs in bounds at full capacity and clears old triangles', () => {
    const geometry = new WaxTrailGeometry(2)
    geometry.update([segment(1, 0.9), segment(0.7, 0.6)], 0.5, palette)
    expect(topology(geometry)).toBe(2)
    geometry.update([segment(0.5, 0.5)], 0.5, palette)
    expect(geometry.drawRange.count).toBe(0)
    expect(topology(geometry)).toBe(0)
  })
})
