import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAnimationLoop } from './animation'

const callbacks = new Map<number, FrameRequestCallback>()
let nextId = 0

function tick(now: number) {
  const pending = [...callbacks.values()]
  callbacks.clear()
  for (const draw of pending) draw(now)
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (draw: FrameRequestCallback) => {
    callbacks.set(++nextId, draw)
    return nextId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
})

afterEach(() => {
  callbacks.clear()
  vi.unstubAllGlobals()
})

describe('animation loop', () => {
  it('coalesces static draws without continuously rendering the intro', () => {
    const draw = vi.fn()
    const loop = createAnimationLoop(draw)
    loop.drawOnce()
    loop.drawOnce()
    tick(100)
    tick(200)
    expect(draw.mock.calls).toEqual([[0, 0]])
    expect(callbacks.size).toBe(0)
  })

  it('cancels hidden frames and resumes without simulating hidden time', () => {
    const draw = vi.fn()
    const loop = createAnimationLoop(draw)
    loop.start()
    loop.start()
    tick(100)
    tick(125)
    loop.stop()
    tick(6000)
    expect(callbacks.size).toBe(0)
    loop.start()
    tick(7000)
    expect(draw.mock.calls).toEqual([[0, 0], [0.025, 0.025], [0, 0.025]])
  })
})
