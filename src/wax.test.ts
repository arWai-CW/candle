import { describe, expect, it } from 'vitest'
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

  it('melts beads above the burning top', () => {
    const sim = new DripSim(0.5)
    sim.spawn(0, 2, 1)
    step(sim, { x: 0, y: -1, z: 0 }, 2, 4)
    sim.meltAbove(1.5)
    expect(sim.beads.every((b) => b.y < 1.5)).toBe(true)
  })
})
