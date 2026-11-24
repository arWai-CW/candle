import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlowDetector, MicInput, type BlowFrame } from './blow'

function run(d: BlowDetector, frame: Omit<BlowFrame, 'flatness'> & { flatness?: number }, seconds: number) {
  let blown = false
  for (let t = 0; t < seconds; t += 1 / 60) blown = d.update({ flatness: 0.45, ...frame }, 1 / 60).blown || blown
  return blown
}

const room = { level: -56, lowRatio: 0.5 }
const gust = { level: -24, lowRatio: 0.6 }
type TestFrame = Parameters<typeof run>[1]

function pulse(d: BlowDetector, frame: TestFrame, seconds: number, ambient = room) {
  const during = run(d, frame, seconds)
  const after = run(d, ambient, 0.25)
  return during || after
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
    expect(pulse(d, { level: -12, lowRatio: 0.8 }, 0.4)).toBe(true)
  })

  it('ignores a short tap', () => {
    const d = new BlowDetector()
    run(d, { level: -55, lowRatio: 0.5 }, 3)
    expect(pulse(d, { level: -12, lowRatio: 0.8 }, 0.08)).toBe(false)
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

  it('catches a softer blow when sensitivity is raised', () => {
    const soft = { level: -38, lowRatio: 0.6 }
    const normal = new BlowDetector(1)
    run(normal, { level: -58, lowRatio: 0.5 }, 3)
    expect(pulse(normal, soft, 0.6)).toBe(false)
    const keen = new BlowDetector(2)
    run(keen, { level: -58, lowRatio: 0.5 }, 3)
    expect(pulse(keen, soft, 0.6)).toBe(true)
  })

  it('needs a harder blow when sensitivity is lowered', () => {
    const d = new BlowDetector(0.5)
    run(d, { level: -55, lowRatio: 0.5 }, 3)
    expect(pulse(d, { level: -30, lowRatio: 0.7 }, 0.6)).toBe(false)
  })

  it('extinguishes with a soft gust clearly above the room noise', () => {
    const d = new BlowDetector(1.6)
    run(d, room, 0.5)
    expect(pulse(d, { ...gust, level: -39 }, 0.35)).toBe(true)
  })

  it('ignores sustained voiced or tonal sounds', () => {
    const d = new BlowDetector()
    run(d, room, 0.5)
    expect(run(d, { level: -22, lowRatio: 0.85, flatness: 0.07 }, 2)).toBe(false)
  })

  it('learns existing broadband noise before arming', () => {
    const d = new BlowDetector(1.6)
    expect(run(d, { ...gust, level: -32 }, 3)).toBe(false)
    expect(pulse(d, { ...gust, level: -20 }, 0.35, { ...gust, level: -32 })).toBe(true)
  })

  it('waits to learn room noise if the mic initially reports digital silence', () => {
    const d = new BlowDetector(1.6)
    expect(run(d, { level: -120, lowRatio: 0, flatness: 0 }, 2.1)).toBe(false)
    expect(d.ready).toBe(false)
    expect(run(d, { ...gust, level: -29 }, 2)).toBe(false)
    expect(d.ready).toBe(true)
  })

  it('arms eventually even with a completely quiet mic', () => {
    const d = new BlowDetector(1.6)
    run(d, { level: -120, lowRatio: 0, flatness: 0 }, 3.1)
    expect(d.ready).toBe(true)
    expect(pulse(d, { ...gust, level: -39 }, 0.35)).toBe(true)
  })

  it('does not extinguish again until the current gust ends', () => {
    const d = new BlowDetector()
    run(d, room, 0.5)
    expect(run(d, { ...gust, level: -15 }, 0.35)).toBe(false)
    expect(run(d, gust, 0.25)).toBe(true)
    expect(run(d, gust, 1.5)).toBe(false)
    expect(run(d, room, 0.35)).toBe(false)
    expect(pulse(d, gust, 0.35)).toBe(true)
  })

  it('learns a stationary broadband sound that starts after calibration without blowing out', () => {
    const d = new BlowDetector(1.6)
    run(d, room, 0.5)
    expect(run(d, { ...gust, level: -30 }, 4)).toBe(false)
    expect(d.floor).toBeGreaterThan(-35)
    expect(run(d, room, 0.5)).toBe(false)
  })

  it('still detects a soft blow after a strong blow and its lingering tail', () => {
    const d = new BlowDetector(1.6)
    const quiet = { ...room, level: -52 }
    run(d, quiet, 0.5)
    const strong = run(d, { ...gust, level: -12 }, 0.35)
    const tail = run(d, { ...gust, level: -24 }, 2.8)
    expect(strong || tail).toBe(true)
    run(d, quiet, 0.2)
    const soft = run(d, { ...gust, level: -42 }, 0.35)
    const release = run(d, quiet, 0.35)
    expect(soft || release).toBe(true)
  })
})

describe('MicInput', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('starts audio and capture synchronously and closes audio if permission is denied', async () => {
    const resume = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    const error = new DOMException('', 'NotAllowedError')
    const getUserMedia = vi.fn().mockRejectedValue(error)
    vi.stubGlobal('window', { AudioContext: class { resume = resume; close = close } })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })

    const starting = MicInput.start()
    expect(resume).toHaveBeenCalledOnce()
    expect(getUserMedia).toHaveBeenCalledOnce()
    await expect(starting).rejects.toBe(error)
    expect(close).toHaveBeenCalledOnce()
  })
})
