import { describe, expect, it } from 'vitest'
import { IncenseBurn } from './incense-burn'

const upright = { x: 0, y: -1, z: 0 }

describe('IncenseBurn', () => {
  it('turns the shortening coating into ash and stops consuming it once extinguished', () => {
    const burn = new IncenseBurn(2.75, 0.52)
    burn.step(20, true, 0, upright, 0)
    expect(burn.top).toBeCloseTo(2.62)
    expect(burn.ash).toBeCloseTo(0.13 * 0.86)
    burn.step(10, false, 0, upright, 0)
    expect(burn.top).toBeCloseTo(2.62)
    expect(burn.ash).toBeCloseTo(0.13 * 0.86)
  })

  it('bends and sheds the same ash sooner when the phone is tilted', () => {
    const burn = new IncenseBurn(2.75, 0.52)
    expect(burn.step(20, true, 0, upright, 0)).toBe(0)
    const ash = burn.ash
    expect(burn.step(0, false, 0, { x: 0.6, y: -0.8, z: 0 }, 0)).toBe(ash)
    expect(burn.bend).toBeGreaterThan(0)
    expect(burn.ash).toBe(0)
  })

  it('holds a visible bend at gentle tilt before breaking at a steeper angle', () => {
    const burn = new IncenseBurn(2.75, 0.52)
    burn.step(33, true, 0, upright, 0)
    const ash = burn.ash
    expect(burn.step(0, true, 0, { x: 0.14, y: -0.99, z: 0 }, 0)).toBe(0)
    expect(burn.bend).toBeGreaterThan(0.25)
    expect(burn.ash).toBe(ash)
    expect(burn.step(0, true, 0, { x: 0.24, y: -0.97, z: 0 }, 0)).toBe(ash)
  })

  it('stops at the uncoated stub', () => {
    const burn = new IncenseBurn(0.55, 0.52)
    expect(burn.step(10, true, 0, upright, 0)).toBeGreaterThan(0)
    expect(burn.finished).toBe(true)
    expect(burn.top).toBe(0.52)
    expect(burn.step(10, true, 0, upright, 0)).toBe(0)
  })
})
