import type { Vec3 } from './gravity'

export const RIM_STEPS = 40
export const RIM_ANGLES = Array.from({ length: RIM_STEPS }, (_, i) => i * 2 * Math.PI / RIM_STEPS)
const RIM_POINTS = RIM_ANGLES.map((angle) => ({ angle, x: Math.cos(angle), z: Math.sin(angle) }))

export class MeltPool {
  heat = 0
  carve = 0
  depth = 0
  width = 0
  slopeX = 0
  slopeZ = 0
  level = 0
  outlet = 0
  overflow = 0

  constructor(readonly radius: number, private readonly maxWidth: number) {}

  reset() {
    this.heat = 0
    this.carve = 0
  }

  get shoulder() {
    return Math.min(this.radius * 0.985, this.width + this.radius * 0.07)
  }

  step(dt: number, burning: boolean, g: Vec3) {
    const warm = burning ? 1 : 0
    this.heat += (warm - this.heat) * (1 - Math.exp(-dt / (burning ? 3 : 7)))
    this.carve = Math.max(this.carve, this.heat)
    this.depth = this.radius * 0.24 * this.carve
    this.width = this.radius * (0.27 + (this.maxWidth - 0.27) * this.carve)

    const down = Math.max(0.22, -g.y)
    this.slopeX = g.x / down
    this.slopeZ = g.z / down
    const drain = Math.hypot(g.x, g.z)
    let limit = Infinity
    for (const p of RIM_POINTS) {
      const at = this.rim(p.angle) - this.shoulder * (p.x * this.slopeX + p.z * this.slopeZ)
      if (at < limit) {
        this.outlet = p.angle
        limit = at
      }
    }
    const fill = -this.depth * (0.88 - 0.76 * this.heat)
    this.level = Math.min(fill, limit - this.radius * 0.004)
    const reachesLip = (fill - limit + this.radius * 0.055) / (this.radius * 0.65)
    this.overflow = this.heat * (g.y > 0 ? 1 : Math.max(0, Math.min(drain, reachesLip)))
    if (g.y > 0 && drain < 0.05) this.outlet = Math.PI / 2
  }

  rim(angle: number) {
    return this.radius * this.carve * (0.028 + 0.017 * Math.sin(angle * 3 + 0.7) + 0.011 * Math.cos(angle * 5 - 0.4))
  }

  surfaceY(x: number, z: number) {
    return this.level + this.slopeX * x + this.slopeZ * z
  }
}
