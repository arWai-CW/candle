import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { MeltPool, RIM_ANGLES } from './melt'
import { WaxTop } from './wax-top'

const upright = new THREE.Vector3(0, -1, 0)
const tilted = new THREE.Vector3(0.6, -0.8, 0)

describe('MeltPool', () => {
  it('opens a basin when lit and retains the depression after the wax hardens', () => {
    const pool = new MeltPool(0.5, 0.84)
    pool.step(12, true, upright)
    const { depth, width } = pool
    expect(depth).toBeGreaterThan(0.1)
    expect(pool.overflow).toBe(0)
    pool.step(30, false, upright)
    expect(pool.heat).toBeLessThan(0.03)
    expect(pool.width).toBe(width)
    expect(pool.depth).toBe(depth)
  })

  it('levels the liquid against gravity and spills from the low edge', () => {
    const pool = new MeltPool(0.5, 0.84)
    pool.step(20, true, tilted)
    expect(Math.cos(pool.outlet)).toBeGreaterThan(0.95)
    expect(pool.overflow).toBeGreaterThan(0.25)
    const across = { x: 0.2, y: pool.surfaceY(0.2, 0) - pool.surfaceY(0, 0), z: 0 }
    expect(tilted.dot(across)).toBeCloseTo(0)
    for (const angle of RIM_ANGLES) {
      const x = Math.cos(angle) * pool.shoulder
      const z = Math.sin(angle) * pool.shoulder
      expect(pool.surfaceY(x, z)).toBeLessThan(pool.rim(angle))
    }
  })

  it('draws only the in-basin liquid and hides it when the candle is sideways', () => {
    const mat = new THREE.MeshBasicMaterial()
    const top = new WaxTop(0.5, 0.84, mat, mat)
    const liquid = top.children[1] as THREE.Mesh
    top.update(18, true, upright)
    const full = liquid.geometry.drawRange.count
    expect(full).toBeGreaterThan(0)
    top.update(0, true, tilted)
    const tiltedCount = liquid.geometry.drawRange.count
    expect(tiltedCount).toBeGreaterThan(0)
    expect(tiltedCount).toBeLessThan(full)
    const positions = liquid.geometry.getAttribute('position')
    for (let i = 0; i < tiltedCount; i++) {
      const { melt } = top
      expect(positions.getY(i)).toBeCloseTo(melt.surfaceY(positions.getX(i), positions.getZ(i)), 3)
    }
    top.update(0, true, new THREE.Vector3(1, 0, 0))
    expect(liquid.visible).toBe(false)
  })
})
