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

export interface WaxDrop extends Vec3 {
  vx: number
  vy: number
  vz: number
  size: number
  color: number
  age: number
  landed: boolean
}

/**
 * Molten wax running down the side of a cylindrical candle in its local frame (axis = +y).
 * Drips follow the component of gravity along the surface, cool, and leave solid beads behind.
 */
export class DripSim {
  drips: Drip[] = []
  beads: WaxBead[] = []
  drops: WaxDrop[] = []
  dirty = false

  constructor(
    public radius: number,
    public floorY = 0,
    public maxBeads = 1800,
    private readonly catchRadius = radius * 2,
  ) {}

  spawn(theta: number, top: number, mass: number, color = 0) {
    this.drips.push({ theta, y: top - 0.003, mass, temp: 1, color, travelled: 0 })
  }

  size(mass: number) {
    return Math.min(0.021, this.radius * 0.18) * (0.38 + Math.sqrt(mass))
  }

  /** Returns how many drips fell off the candle this step. */
  step(dt: number, g: Vec3, top: number): number {
    let fell = 0
    const r = this.radius
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]
      if (d.landed) continue
      d.age += dt
      d.vx += g.x * 5 * dt
      d.vy += g.y * 5 * dt
      d.vz += g.z * 5 * dt
      d.x += d.vx * dt
      d.y += d.vy * dt
      d.z += d.vz * dt
      if (d.y <= this.floorY && d.vy < 0 && Math.hypot(d.x, d.z) <= this.catchRadius) {
        d.y = this.floorY + d.size * 0.12
        d.landed = true
      } else if (d.age > 2) this.drops.splice(i, 1)
      this.dirty = true
    }
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i]
      const c = Math.cos(d.theta)
      const s = Math.sin(d.theta)
      const gn = g.x * c + g.z * s
      const gt = -g.x * s + g.z * c
      if (gn > 0.65 && d.temp > 0.4) {
        this.release(d, g)
        this.drips.splice(i, 1)
        fell++
        continue
      }
      const speed = 0.55 * d.temp * Math.sqrt(d.mass)
      const oldY = d.y
      const oldTheta = d.theta
      const dy = Math.min(top - 0.003 - oldY, g.y * speed * dt)
      const dTheta = (gt * speed * dt) / r
      d.y += dy
      d.theta += dTheta
      const length = Math.hypot(dy, dTheta * r)
      d.travelled += length
      d.temp -= dt * 0.39

      const size = this.size(d.mass)
      const spacing = Math.min(0.016, size * 0.9)
      while (length > 0 && d.travelled >= spacing && d.mass > 0.08) {
        d.travelled -= spacing
        const t = Math.max(0, 1 - d.travelled / length)
        this.addBead({ theta: oldTheta + dTheta * t, y: oldY + dy * t, size: size * 0.66, color: d.color })
        d.mass -= spacing * 1.6
      }
      const landed = d.y <= this.floorY + size * 0.2
      if (d.mass <= 0.08 || d.temp <= 0.03 || landed) {
        if (landed) {
          this.release(d, g)
          const drop = this.drops[this.drops.length - 1]
          drop.y = this.floorY + drop.size * 0.12
          drop.landed = true
        } else this.addBead({ theta: d.theta, y: d.y, size, color: d.color })
        this.drips.splice(i, 1)
      }
    }
    return fell
  }

  /** Drops beads the flame has melted away as the candle burns down. */
  meltAbove(top: number) {
    let kept = 0
    for (const bead of this.beads) {
      if (bead.y < top - bead.size * 0.3) this.beads[kept++] = bead
    }
    if (kept !== this.beads.length) this.dirty = true
    this.beads.length = kept
    kept = 0
    for (const drip of this.drips) {
      if (drip.y < top) this.drips[kept++] = drip
    }
    if (kept !== this.drips.length) this.dirty = true
    this.drips.length = kept
  }

  clear() {
    this.drips = []
    this.beads = []
    this.drops = []
    this.dirty = true
  }

  private addBead(b: WaxBead) {
    if (this.beads.length >= this.maxBeads) this.beads.shift()
    this.beads.push(b)
    this.dirty = true
  }

  private release(d: Drip, g: Vec3) {
    const size = this.size(d.mass)
    const r = this.radius + size
    if (this.drops.length >= 32) this.drops.shift()
    this.drops.push({
      x: r * Math.cos(d.theta), y: d.y, z: r * Math.sin(d.theta),
      vx: g.x * 0.2, vy: g.y * 0.2, vz: g.z * 0.2, size, color: d.color, age: 0, landed: false,
    })
    this.dirty = true
  }
}
