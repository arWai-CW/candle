import type { Vec3 } from './gravity'

export class IncenseBurn {
  top: number
  ash = 0
  bend = 0

  constructor(private readonly initialTop: number, private readonly end: number) {
    this.top = initialTop
  }

  get finished() {
    return this.top <= this.end
  }

  reset() {
    this.top = this.initialTop
    this.ash = 0
    this.bend = 0
  }

  step(dt: number, burning: boolean, wind: number, gravity: Vec3, shake: number) {
    if (burning) {
      const consumed = Math.min(this.top - this.end, 0.0065 * (1 + wind * 2) * dt)
      this.top = Math.max(this.end, this.top - consumed)
      this.ash += consumed * 0.86
    }
    const lateral = Math.hypot(gravity.x, gravity.z)
    const stress = lateral + Math.min(shake / 10, 2) + Math.max(0, gravity.y) * 0.8
    this.bend = Math.min(0.7, 1.1 * Math.sqrt(lateral) * (this.ash / 0.24) ** 1.2)
    const limit = Math.max(0.04, 0.29 / (1 + 3.5 * stress))
    if (this.ash < limit && !(this.finished && this.ash > 0.02)) return 0
    const released = this.ash
    this.ash = 0
    return released
  }
}
