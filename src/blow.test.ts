import { describe, expect, it } from 'vitest'
import { BlowDetector } from './blow'

function run(d: BlowDetector, frame: { level: number; lowRatio: number }, seconds: number) {
  let blown = false
  for (let t = 0; t < seconds; t += 1 / 60) blown = d.update(frame, 1 / 60).blown || blown
  return blown
}

describe('BlowDetector', () => {
  it('learns a quiet room and stays calm', () => {
    const d = new BlowDetector()
    expect(run(d, { level: -55, lowRatio: 0.5 }, 5)).toBe(false)
    expect(d.strength).toBeLessThan(0.05)
  })

  it('blows out on a sustained loud low-frequency gust', () => {
    const d = new BlowDetector()
    run(d, { level: -55, lowRatio: 0.5 }, 3)
    expect(run(d, { level: -12, lowRatio: 0.8 }, 0.4)).toBe(true)
  })

  it('ignores a short tap', () => {
    const d = new BlowDetector()
    run(d, { level: -55, lowRatio: 0.5 }, 3)
    expect(run(d, { level: -12, lowRatio: 0.8 }, 0.08)).toBe(false)
  })

  it('ignores loud high-pitched sound', () => {
    const d = new BlowDetector()
    run(d, { level: -55, lowRatio: 0.5 }, 3)
    expect(run(d, { level: -15, lowRatio: 0.1 }, 1)).toBe(false)
  })

  it('reports partial strength for a gentle breath', () => {
    const d = new BlowDetector()
    run(d, { level: -55, lowRatio: 0.5 }, 3)
    run(d, { level: -32, lowRatio: 0.7 }, 0.5)
    expect(d.strength).toBeGreaterThan(0.1)
    expect(d.strength).toBeLessThan(0.75)
  })
})
