import { describe, expect, it } from 'vitest'
import { gravityFromOrientation } from './gravity'

const close = (v: { x: number; y: number; z: number }, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 5)
  expect(v.y).toBeCloseTo(y, 5)
  expect(v.z).toBeCloseTo(z, 5)
}

describe('gravityFromOrientation', () => {
  it('points into the screen when the phone lies flat', () => close(gravityFromOrientation(0, 0), 0, 0, -1))
  it('points to the bottom of the screen when held upright', () => close(gravityFromOrientation(90, 0), 0, -1, 0))
  it('points to the right edge when tipped right', () => close(gravityFromOrientation(0, 90), 1, 0, 0))
  it('points to the top when held upside down', () => close(gravityFromOrientation(-90, 0), 0, 1, 0))
  it('follows the screen in landscape', () => close(gravityFromOrientation(0, -90, 90), 0, -1, 0))
})
