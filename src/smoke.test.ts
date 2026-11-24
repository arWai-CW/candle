import { Vector3 } from 'three'
import { expect, it } from 'vitest'
import { Smoke } from './smoke'

it('reprojects already emitted smoke around the source when world up turns', () => {
  const smoke = new Smoke(1)
  const source = new Vector3(2, 3, 4)
  const upright = new Vector3(0, 1, 0)
  smoke.emit(source, upright, { speed: 1, size: 1, life: 4, alpha: 1 })
  smoke.update(0.1, source, upright, upright, 0, 0.1)
  const positions = smoke.points.geometry.getAttribute('position')
  const height = positions.getY(0) - source.y
  expect(height).toBeGreaterThan(0.05)

  const turned = new Vector3(1, 0, 0)
  smoke.update(0, source, turned, turned, 0, 0.1)
  expect(positions.getX(0) - source.x).toBeCloseTo(height, 5)
  expect(positions.getY(0)).toBeCloseTo(source.y, 2)
})
