import { describe, expect, it } from 'vitest'
import { gravityFromOrientation } from './gravity'
import { DripSim } from './wax'

const step = (sim: DripSim, g: { x: number; y: number; z: number }, top: number, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) sim.step(1 / 60, g, top)
}

describe('DripSim', () => {
  it('runs drips down an upright candle and leaves beads', () => {
    const sim = new DripSim(0.5)
    sim.spawn(0, 2, 1)
    step(sim, { x: 0, y: -1, z: 0 }, 2, 4)
    expect(sim.drips).toHaveLength(0)
    expect(sim.beads.length).toBeGreaterThan(3)
    expect(Math.min(...sim.beads.map((b) => b.y))).toBeLessThan(1.8)
  })

  it('sends drips around the candle toward the low side when tilted', () => {
    const sim = new DripSim(0.5)
    sim.spawn(Math.PI / 2, 2, 1)
    step(sim, { x: 0.7, y: -0.7, z: 0 }, 2, 1)
    const last = sim.beads[sim.beads.length - 1]
    expect(last.theta).toBeLessThan(Math.PI / 2)
  })

  it('drops drips that hang under a horizontal candle', () => {
    const sim = new DripSim(0.5)
    sim.spawn(0, 2, 1)
    let fell = 0
    for (let i = 0; i < 10; i++) fell += sim.step(1 / 60, { x: 1, y: 0, z: 0 }, 2)
    expect(fell).toBe(1)
  })

  it('releases fresh overflow at the rim of a nearly inverted candle', () => {
    const sim = new DripSim(0.5)
    const g = gravityFromOrientation(-80, 0)
    sim.spawn(Math.PI / 2, 2, 1)

    expect(sim.step(1 / 60, g, 2)).toBe(1)
    expect(sim.drips).toHaveLength(0)
    expect(sim.beads).toHaveLength(0)
    expect(sim.drops).toHaveLength(1)
    const drop = sim.drops[0]
    step(sim, g, 2, 0.2)
    expect(drop.y).toBeGreaterThan(2)
    expect(drop.landed).toBe(false)
  })

  it('lets wax already on the side reach the rim before releasing it', () => {
    const sim = new DripSim(0.5)
    sim.spawn(0, 2, 1)
    sim.step(1 / 60, { x: 0, y: -1, z: 0 }, 2)
    const g = { x: 0, y: 1, z: 0 }

    expect(sim.step(1 / 60, g, 2)).toBe(0)
    expect(sim.drips).toHaveLength(1)
    expect(sim.step(1 / 60, g, 2)).toBe(1)
    expect(sim.drips).toHaveLength(0)
    expect(sim.drops).toHaveLength(1)
  })

  it('continues released wax along gravity and keeps a puddle when it lands on the holder', () => {
    const sim = new DripSim(0.5, 0, 1800, 1.5)
    sim.spawn(0, 0.4, 0.8)
    sim.step(1 / 60, { x: 1, y: 0, z: 0 }, 0.4)
    const drop = sim.drops[0]
    const startX = drop.x
    step(sim, { x: 0, y: -1, z: 0 }, 0.4, 0.6)
    expect(drop.x).toBeGreaterThan(startX)
    expect(drop.y).toBeLessThan(0.01)
    expect(drop.landed).toBe(true)
    step(sim, { x: 1, y: 0, z: 0 }, 0.4, 3)
    expect(sim.drops).toEqual([drop])
  })

  it('leaves connected, tapering wax and joins nearby deposits on the holder', () => {
    const sim = new DripSim(0.5)
    const g = { x: 0, y: -1, z: 0 }
    sim.spawn(0, 0.55, 1)
    step(sim, g, 0.55, 2)
    expect(sim.beads.length).toBeGreaterThan(4)
    const first = sim.beads[0]
    const last = sim.beads[sim.beads.length - 1]
    expect(last.size).toBeLessThan(first.size)
    expect(sim.beads[1].fromY).toBe(first.y)
    expect(sim.drops).toHaveLength(1)
    const firstSize = sim.drops[0].size
    const firstTrailLength = sim.beads.length
    sim.spawn(0, 0.55, 1)
    step(sim, g, 0.55, 2)
    expect(sim.drops).toHaveLength(1)
    expect(sim.drops[0].size).toBeGreaterThan(firstSize)
    expect(sim.beads).toHaveLength(firstTrailLength)
  })

  it('melts beads above the burning top', () => {
    const sim = new DripSim(0.5)
    sim.spawn(0, 2, 1)
    step(sim, { x: 0, y: -1, z: 0 }, 2, 4)
    sim.meltAbove(1.5)
    expect(sim.beads.every((b) => b.y < 1.5)).toBe(true)
  })
})
