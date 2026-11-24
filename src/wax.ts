import type { Vec3 } from './gravity'

export interface Drip {
  theta: number
  y: number
  mass: number
  temp: number
  color: number
  travelled: number
}

export interface WaxBead {
  theta: number
  y: number
  size: number
  color: number
}

const SPACING = 0.018

/**
 * Molten wax running down the side of a cylindrical candle in its local frame (axis = +y).
 * Drips follow the component of gravity along the surface, cool, and leave solid beads behind.
 */
export class DripSim {
  drips: Drip[] = []
  beads: WaxBead[] = []
  dirty = false

  constructor(
    public radius: number,
    public floorY = 0,
    public maxBeads = 1800,
  ) {}

  spawn(theta: number, top: number, mass: number, color = 0) {
    this.drips.push({ theta, y: top - 0.01, mass, temp: 1, color, travelled: 0 })
  }

  /** Returns how many drips fell off the candle this step. */
  step(dt: number, g: Vec3, top: number): number {
    let fell = 0
    const r = this.radius
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i]
      const c = Math.cos(d.theta)
      const s = Math.sin(d.theta)
      const gn = g.x * c + g.z * s
      const gt = -g.x * s + g.z * c
      if (gn > 0.65 && d.temp > 0.4) {
        this.drips.splice(i, 1)
        fell++
        continue
      }
      const speed = 0.55 * d.temp * Math.sqrt(d.mass)
      const dy = g.y * speed * dt
      const dTheta = (gt * speed * dt) / r
      d.y = Math.min(top - 0.005, d.y + dy)
      d.theta += dTheta
      d.travelled += Math.hypot(dy, dTheta * r)
      d.temp -= dt * 0.4

      const size = 0.012 + 0.03 * d.mass * Math.min(1, r / 0.2 + 0.4)
      while (d.travelled >= SPACING) {
        d.travelled -= SPACING
        this.addBead({ theta: d.theta, y: d.y, size, color: d.color })
        d.mass -= 0.035
      }
      const landed = d.y <= this.floorY + size * 0.5
      if (landed) d.y = this.floorY + size * 0.4
      if (d.mass <= 0.08 || d.temp <= 0.03 || landed) {
        this.addBead({ theta: d.theta, y: d.y, size: size * (landed ? 1.8 : 1.3), color: d.color })
        this.drips.splice(i, 1)
      }
    }
    return fell
  }

  /** Drops beads the flame has melted away as the candle burns down. */
  meltAbove(top: number) {
    const before = this.beads.length
    this.beads = this.beads.filter((b) => b.y < top - b.size * 0.3)
    if (this.beads.length !== before) this.dirty = true
    this.drips = this.drips.filter((d) => d.y < top)
  }

  clear() {
    this.drips = []
    this.beads = []
    this.dirty = true
  }

  private addBead(b: WaxBead) {
    if (this.beads.length >= this.maxBeads) this.beads.shift()
    this.beads.push(b)
    this.dirty = true
  }
}
