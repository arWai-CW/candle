import type { Vec3 } from './gravity'

export interface Drip {
  theta: number
  y: number
  mass: number
  temp: number
  color: number
  travelled: number
  trailTheta: number
  trailY: number
}

export interface WaxBead {
  theta: number
  y: number
  size: number
  color: number
  fromTheta: number
  fromY: number
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
    const y = top - 0.003
    this.drips.push({ theta, y, mass, temp: 1, color, travelled: 0, trailTheta: theta, trailY: y })
    this.dirty = true
  }

  size(mass: number) {
    return Math.min(0.035, this.radius * 0.28) * (0.38 + Math.sqrt(mass))
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
        this.deposit(i)
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
      const speed = 0.92 * d.temp * Math.sqrt(d.mass)
      const oldY = d.y
      const oldTheta = d.theta
      const dy = Math.min(top - 0.003 - oldY, g.y * speed * dt)
      const dTheta = (gt * speed * dt) / r
      d.y += dy
      d.theta += dTheta
      const length = Math.hypot(dy, dTheta * r)
      d.travelled += length
      d.temp -= dt * 0.23 / Math.sqrt(Math.max(0.15, d.mass))

      const size = this.size(d.mass)
      const spacing = Math.min(0.032, size * 0.9)
      while (length > 0 && d.travelled >= spacing && d.mass > 0.08) {
        d.travelled -= spacing
        const t = Math.max(0, 1 - d.travelled / length)
        this.leaveTrail(d, oldTheta + dTheta * t, oldY + dy * t, size * (0.52 + d.temp * 0.20))
        d.mass -= spacing * 0.53
      }
      const landed = d.y <= this.floorY + size * 0.2
      if (d.mass <= 0.08 || d.temp <= 0.03 || landed) {
        if (landed) {
          this.release(d, g)
          this.deposit(this.drops.length - 1)
        } else this.leaveTrail(d, d.theta, d.y, size * 0.92)
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

  private leaveTrail(d: Drip, theta: number, y: number, size: number) {
    const centreY = (y + d.trailY) * 0.5
    const centreTheta = (theta + d.trailTheta) * 0.5
    let existing: WaxBead | undefined
    for (let i = this.beads.length - 1; i >= 0; i--) {
      const b = this.beads[i]
      if (Math.abs((b.y + b.fromY) * 0.5 - centreY) > size * 0.48) continue
      const angle = (b.theta + b.fromTheta) * 0.5 - centreTheta
      if (Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) * this.radius >= size * 0.69) continue
      existing = b
      break
    }
    if (existing) existing.size = Math.max(size, existing.size)
    else {
      if (this.beads.length >= this.maxBeads) this.beads.shift()
      this.beads.push({ theta, y, size, color: d.color, fromTheta: d.trailTheta, fromY: d.trailY })
    }
    d.trailTheta = theta
    d.trailY = y
    this.dirty = true
  }

  private deposit(i: number) {
    const d = this.drops[i]
    const near = this.drops.find((p) => p.landed && p.color === d.color && Math.hypot(p.x - d.x, p.z - d.z) < p.size * 2.8)
    if (near) {
      near.size = Math.min(this.radius * 0.95, Math.hypot(near.size, d.size * 0.67))
      this.drops.splice(i, 1)
    } else {
      d.y = this.floorY + d.size * 0.12
      d.landed = true
    }
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
