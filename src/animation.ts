export function createAnimationLoop(draw: (delta: number, elapsed: number) => void) {
  let pending: number | null = null
  let previous: number | null = null
  let elapsed = 0
  let active = false

  function tick(now: number) {
    pending = null
    const delta = active && previous !== null ? (now - previous) / 1000 : 0
    previous = active ? now : null
    elapsed += delta
    draw(Math.min(0.05, delta), elapsed)
    if (active) drawOnce()
  }

  function drawOnce() {
    pending ??= requestAnimationFrame(tick)
  }

  return {
    drawOnce,
    start() {
      active = true
      drawOnce()
    },
    stop() {
      active = false
      previous = null
      if (pending !== null) cancelAnimationFrame(pending)
      pending = null
    },
  }
}
