import * as THREE from 'three'
import { DripSim } from './wax'
import { Flame, getGlowTexture } from './flame'
import { Smoke } from './smoke'

export type CandleKind = 'birthday' | 'white' | 'incense'

export interface Env {
  /** Unit gravity in the candle's frame (screen frame). */
  gravity: THREE.Vector3
  /** Buoyancy direction: opposite of gravity plus device acceleration, m/s^2. */
  up: THREE.Vector3
  /** Wind strength 0..1. */
  wind: number
  /** Device acceleration magnitude without gravity, m/s^2. */
  shake: number
  time: number
}

export interface Candle {
  readonly kind: CandleKind
  readonly group: THREE.Group
  readonly lit: boolean
  readonly burnedOut: boolean
  /** Half extents of the area the camera should frame, and its centre. */
  readonly focus: { centre: THREE.Vector3; halfWidth: number; halfHeight: number }
  update(dt: number, env: Env): void
  light(): void
  extinguish(): void
  reset(): void
  dispose(): void
}

/** Wax that glows warm near the flame, like light scattering through it. */
function waxMaterial(color: THREE.ColorRepresentation, uniforms: { uTop: { value: number }; uGlow: { value: number } }, map?: THREE.Texture) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, map: map ?? null })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTop = uniforms.uTop
    shader.uniforms.uGlow = uniforms.uGlow
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;\nuniform float uTop;\nuniform float uGlow;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\nfloat below = max(0.0, uTop - vWorldY);\ntotalEmissiveRadiance += vec3(1.0, 0.45, 0.15) * uGlow * exp(-below * 5.0) * 0.6;',
      )
  }
  return mat
}

function stripeTexture(base: string, stripe: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 64, 64)
  ctx.fillStyle = stripe
  for (let i = -2; i < 3; i++) {
    ctx.beginPath()
    ctx.moveTo(i * 64, 64)
    ctx.lineTo(i * 64 + 26, 64)
    ctx.lineTo(i * 64 + 26 + 64, 0)
    ctx.lineTo(i * 64 + 64, 0)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

interface WaxSpec {
  kind: 'birthday' | 'white'
  radius: number
  height: number
  minHeight: number
  burnRate: number
  dripRate: number
  waxColor: string
  dripColors: string[]
  flame: { height: number; width: number; light: number }
  wickLength: number
}

const SPECS: Record<'birthday' | 'white', WaxSpec> = {
  birthday: {
    kind: 'birthday',
    radius: 0.075,
    height: 1.25,
    minHeight: 0.12,
    burnRate: 1.25 / 150,
    dripRate: 0.9,
    waxColor: '#ffffff',
    dripColors: ['#ff8fb8', '#ffffff'],
    flame: { height: 0.36, width: 0.075, light: 1.6 },
    wickLength: 0.09,
  },
  white: {
    kind: 'white',
    radius: 0.5,
    height: 2.1,
    minHeight: 0.3,
    burnRate: 1.8 / 900,
    dripRate: 0.18,
    waxColor: '#f4eee2',
    dripColors: ['#f4eee2'],
    flame: { height: 0.62, width: 0.13, light: 4 },
    wickLength: 0.16,
  },
}

class WaxCandle implements Candle {
  readonly group = new THREE.Group()
  readonly kind: 'birthday' | 'white'
  readonly focus: Candle['focus']
  burnedOut = false
  private readonly spec: WaxSpec
  private height: number
  private readonly flame: Flame
  private readonly body: THREE.Mesh
  private readonly pool: THREE.Mesh
  private readonly poolMat: THREE.MeshStandardMaterial
  private readonly wick: THREE.Mesh
  private readonly ember: THREE.Mesh
  private readonly emberMat: THREE.MeshBasicMaterial
  private readonly sim: DripSim
  private readonly beads: THREE.InstancedMesh
  private readonly smoke = new Smoke(300)
  private readonly glowUniforms = { uTop: { value: 0 }, uGlow: { value: 0 } }
  private readonly stripes?: THREE.CanvasTexture
  private poolAmount = 0
  private emberHeat = 0
  private wispTimer = 0
  private spawnAcc = 0
  private readonly tmpV = new THREE.Vector3()
  private readonly tmpM = new THREE.Matrix4()
  private readonly tmpQ = new THREE.Quaternion()
  private readonly tmpS = new THREE.Vector3()

  constructor(kind: 'birthday' | 'white') {
    this.kind = kind
    const spec = (this.spec = SPECS[kind])
    this.height = spec.height

    if (kind === 'birthday') {
      this.stripes = stripeTexture('#ffffff', '#ff7aa8')
      this.group.add(plate(0.32))
    } else {
      this.group.add(plate(spec.radius * 2.1))
    }

    const bodyGeo = new THREE.CylinderGeometry(spec.radius, spec.radius, 1, 40, 1, false)
    bodyGeo.translate(0, 0.5, 0)
    this.body = new THREE.Mesh(bodyGeo, waxMaterial(spec.waxColor, this.glowUniforms, this.stripes))
    this.group.add(this.body)

    this.poolMat = new THREE.MeshStandardMaterial({
      color: spec.waxColor,
      roughness: 0.15,
      metalness: 0,
      emissive: new THREE.Color(1, 0.55, 0.2),
      emissiveIntensity: 0,
    })
    const top = new THREE.Mesh(new THREE.CircleGeometry(spec.radius, 40).rotateX(-Math.PI / 2), waxMaterial(spec.waxColor, this.glowUniforms))
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(spec.radius * 0.9, 40).rotateX(-Math.PI / 2), this.poolMat)
    this.pool.position.y = 0.002
    const topGroup = new THREE.Group()
    topGroup.name = 'top'
    topGroup.add(top, this.pool)
    this.group.add(topGroup)

    const wickR = kind === 'birthday' ? 0.008 : 0.014
    const wickGeo = new THREE.CylinderGeometry(wickR * 0.8, wickR, spec.wickLength, 8)
    wickGeo.translate(0, spec.wickLength / 2, 0)
    this.wick = new THREE.Mesh(wickGeo, new THREE.MeshStandardMaterial({ color: '#1a1410', roughness: 0.9 }))
    this.wick.rotation.z = 0.08
    this.group.add(this.wick)
    this.emberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.35, 0.05), transparent: true, opacity: 0, toneMapped: false })
    this.ember = new THREE.Mesh(new THREE.SphereGeometry(wickR * 1.3, 8, 6), this.emberMat)
    this.wick.add(this.ember)
    this.ember.position.y = spec.wickLength

    this.flame = new Flame(spec.flame.height, spec.flame.width, spec.flame.light)
    this.group.add(this.flame.group)

    this.sim = new DripSim(spec.radius, 0)
    const beadMat = waxMaterial('#ffffff', this.glowUniforms)
    this.beads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), beadMat, this.sim.maxBeads)
    this.beads.count = 0
    this.beads.frustumCulled = false
    this.group.add(this.beads)
    this.group.add(this.smoke.points)

    const h = spec.height + spec.flame.height + 0.4
    this.focus =
      kind === 'birthday'
        ? { centre: new THREE.Vector3(0, 0.78, 0), halfWidth: 0.6, halfHeight: 1.05 }
        : { centre: new THREE.Vector3(0, h * 0.5 - 0.1, 0), halfWidth: 1.25, halfHeight: h * 0.5 + 0.35 }
    this.layout()
  }

  get lit() {
    return this.flame.target > 0
  }

  light() {
    if (this.burnedOut) return
    this.flame.target = 1
  }

  extinguish() {
    if (!this.lit) return
    this.flame.target = 0
    this.emberHeat = 1
    this.wispTimer = 3
  }

  reset() {
    this.height = this.spec.height
    this.burnedOut = false
    this.poolAmount = 0
    this.sim.clear()
    this.smoke.clear()
    this.flame.target = 0
    this.flame.level = 0
    this.layout()
  }

  private layout() {
    this.body.scale.y = this.height
    const top = this.group.getObjectByName('top')!
    top.position.y = this.height
    this.wick.position.y = this.height - 0.02
    this.flame.group.position.set(Math.sin(-this.wick.rotation.z) * this.spec.wickLength * 0.7, this.height + this.spec.wickLength * 0.75, 0)
    if (this.stripes) this.stripes.repeat.set(1, this.height / 0.32)
  }

  update(dt: number, env: Env) {
    const spec = this.spec
    const g = env.gravity
    const tilt = Math.hypot(g.x, g.z)
    this.flame.update(dt, { up: env.up, wind: env.wind, time: env.time })

    const burning = this.flame.level > 0.5
    if (burning) {
      this.height -= spec.burnRate * dt * (1 + tilt * 2)
      if (this.height <= spec.minHeight) {
        this.height = spec.minHeight
        this.burnedOut = true
        this.extinguish()
      }
    }
    this.poolAmount += ((burning ? 1 : 0) - this.poolAmount) * Math.min(1, dt / (burning ? 6 : 12))

    if (burning) {
      const low = Math.atan2(g.z, g.x)
      const rate = spec.dripRate * this.poolAmount * (0.25 + tilt * 4 + Math.max(0, g.y) * 6)
      this.spawnAcc += rate * dt
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1
        const theta = tilt > 0.12 ? low + (Math.random() - 0.5) * 1.4 : Math.random() * Math.PI * 2
        const color = Math.floor(Math.random() * spec.dripColors.length)
        this.sim.spawn(theta, this.height, 0.55 + Math.random() * 0.6, color)
      }
    }
    this.sim.step(dt, g, this.height)
    this.sim.meltAbove(this.height)
    this.layout()

    // The molten pool tilts to stay level, within the rim.
    const poolTop = this.group.getObjectByName('top')!
    this.tmpV.set(-g.x, -g.y, -g.z)
    if (this.tmpV.y < 0.25) this.tmpV.y = 0.25
    this.tmpV.normalize()
    this.tmpQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.tmpV)
    this.pool.quaternion.slerpQuaternions(new THREE.Quaternion(), this.tmpQ, 0.3 * this.poolAmount)
    this.pool.scale.setScalar(0.4 + 0.6 * this.poolAmount)
    this.pool.visible = this.poolAmount > 0.05
    this.poolMat.emissiveIntensity = 0.25 * this.flame.level
    poolTop.updateMatrix()

    this.glowUniforms.uTop.value = this.height + 0.05
    this.glowUniforms.uGlow.value = this.flame.level * (this.kind === 'white' ? 1 : 0.6)

    // Wick ember and the smoke wisp after it goes out.
    this.emberHeat = Math.max(0, this.emberHeat - dt * 0.5)
    this.emberMat.opacity = Math.max(this.emberHeat, this.flame.level * 0.6)
    if (this.wispTimer > 0) {
      this.wispTimer -= dt
      const at = this.tmpV.set(this.flame.group.position.x, this.height + spec.wickLength * 0.9, 0)
      const up = this.tmpS.copy(env.up).normalize()
      const n = Math.random() < this.wispTimer ? 2 : 1
      for (let i = 0; i < n; i++) this.smoke.emit(at, up, { speed: 0.35, size: spec.radius * 0.6 + 0.05, life: 2.6, alpha: 0.32 * Math.min(1, this.wispTimer) })
    }
    this.smoke.update(dt, this.tmpS.copy(env.up).normalize(), env.wind, env.time)

    this.renderBeads()
  }

  setViewportHeight(px: number) {
    this.smoke.setViewportHeight(px)
  }

  private renderBeads() {
    if (!this.sim.dirty && this.sim.drips.length === 0) return
    const r = this.spec.radius
    const colors = this.spec.dripColors.map((c) => new THREE.Color(c))
    let i = 0
    const place = (theta: number, y: number, size: number, color: number) => {
      const out = r + size * 0.15
      this.tmpV.set(Math.cos(theta) * out, y, Math.sin(theta) * out)
      this.tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -theta)
      this.tmpS.set(size * 0.7, size * 1.5, size)
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS)
      this.beads.setMatrixAt(i, this.tmpM)
      this.beads.setColorAt(i, colors[color])
      i++
    }
    for (const b of this.sim.beads) place(b.theta, b.y, b.size, b.color)
    for (const d of this.sim.drips) if (i < this.sim.maxBeads) place(d.theta, d.y, 0.014 + 0.032 * d.mass, d.color)
    this.beads.count = i
    this.beads.instanceMatrix.needsUpdate = true
    if (this.beads.instanceColor) this.beads.instanceColor.needsUpdate = true
    this.sim.dirty = false
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose()
    })
  }
}

function plate(radius: number): THREE.Mesh {
  const pts = [new THREE.Vector2(0, -0.06), new THREE.Vector2(radius, -0.06), new THREE.Vector2(radius * 1.08, 0.04), new THREE.Vector2(radius * 1.05, 0.05), new THREE.Vector2(radius * 0.92, 0), new THREE.Vector2(0, 0)]
  return new THREE.Mesh(new THREE.LatheGeometry(pts, 64), new THREE.MeshStandardMaterial({ color: '#3b2d24', roughness: 0.35, metalness: 0.2 }))
}

interface AshBit {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  spin: THREE.Vector3
  resting: boolean
  age: number
}

const STICK_LEN = 3.0
const BARE = 0.75
const SAND_Y = 0
const BOWL_R = 0.8

class Incense implements Candle {
  readonly kind = 'incense' as const
  readonly group = new THREE.Group()
  readonly focus = { centre: new THREE.Vector3(0, 1.3, 0), halfWidth: 1.0, halfHeight: 1.9 }
  burnedOut = false
  private top = STICK_LEN - 0.25
  private ash = 0
  private heat = 0
  private target = 0
  private readonly coat: THREE.Mesh
  private readonly ashMesh: THREE.Mesh
  private readonly ember: THREE.Mesh
  private readonly emberMat: THREE.MeshBasicMaterial
  private readonly glow: THREE.Sprite
  private readonly emberLight: THREE.PointLight
  private readonly smoke = new Smoke(500, new THREE.Color(0.8, 0.8, 0.82))
  private readonly ashBits: AshBit[] = []
  private readonly ashGeo = new THREE.CylinderGeometry(0.024, 0.026, 1, 8)
  private readonly ashMat = new THREE.MeshStandardMaterial({ color: '#8d8a85', roughness: 1 })
  private emitAcc = 0
  private readonly base = -0.25
  private readonly tmp = new THREE.Vector3()

  constructor() {
    this.group.add(burner())
    const stickGeo = new THREE.CylinderGeometry(0.011, 0.011, 1, 6)
    stickGeo.translate(0, 0.5, 0)
    const stick = new THREE.Mesh(stickGeo, new THREE.MeshStandardMaterial({ color: '#c9a36b', roughness: 0.8 }))
    stick.position.y = this.base
    stick.scale.y = BARE + 0.1
    this.group.add(stick)

    const coatGeo = new THREE.CylinderGeometry(0.026, 0.026, 1, 10)
    coatGeo.translate(0, 0.5, 0)
    this.coat = new THREE.Mesh(coatGeo, new THREE.MeshStandardMaterial({ color: '#7a2f22', roughness: 0.9 }))
    this.coat.position.y = this.base + BARE
    this.group.add(this.coat)

    this.ashMesh = new THREE.Mesh(this.ashGeo, this.ashMat)
    this.group.add(this.ashMesh)

    this.emberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.3, 0.05), transparent: true, toneMapped: false })
    this.ember = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), this.emberMat)
    this.ember.scale.y = 0.6
    this.group.add(this.ember)
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: getGlowTexture(), color: new THREE.Color(1, 0.3, 0.06), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }),
    )
    this.group.add(this.glow)
    this.emberLight = new THREE.PointLight(0xff5a1e, 0, 0, 2)
    this.group.add(this.emberLight)
    const fill = new THREE.DirectionalLight(0xffc89a, 0.9)
    fill.position.set(1.2, 3, 2.5)
    this.group.add(fill, fill.target)
    this.group.add(this.smoke.points)
    this.layout()
  }

  get lit() {
    return this.target > 0
  }

  light() {
    if (this.burnedOut) return
    this.target = 1
  }

  extinguish() {
    this.target = 0
  }

  reset() {
    this.top = STICK_LEN - 0.25
    this.ash = 0
    this.heat = 0
    this.target = 0
    this.burnedOut = false
    this.smoke.clear()
    for (const b of this.ashBits) this.group.remove(b.mesh)
    this.ashBits.length = 0
    this.layout()
  }

  setViewportHeight(px: number) {
    this.smoke.setViewportHeight(px)
  }

  private layout() {
    const coatLen = Math.max(0.001, this.top - this.base - BARE)
    this.coat.scale.y = coatLen
    this.ember.position.y = this.top
    this.ashMesh.visible = this.ash > 0.005
    this.ashMesh.scale.y = Math.max(0.001, this.ash)
    this.ashMesh.position.y = this.top + this.ash / 2
    this.glow.position.y = this.top
    this.emberLight.position.y = this.top + 0.05
  }

  update(dt: number, env: Env) {
    const up = this.tmp.copy(env.up).normalize()
    // Blowing feeds the ember before it is strong enough to put it out.
    const want = this.target * (1 + env.wind * 0.8)
    this.heat += (want - this.heat) * Math.min(1, dt / (want > this.heat ? 0.6 : 1.6))
    const burning = this.heat > 0.3 && this.target > 0
    if (burning) {
      const rate = 0.0045 * (1 + env.wind * 2)
      this.top -= rate * dt
      this.ash += rate * dt * 0.85
      if (this.top <= this.base + BARE + 0.02) {
        this.burnedOut = true
        this.target = 0
      }
    }
    if (this.ash > 0.02 && (this.ash > 0.32 || env.shake > 5 || (Math.hypot(env.gravity.x, env.gravity.z) > 0.6 && this.ash > 0.12))) this.dropAsh(env)

    const flick = 0.9 + 0.1 * Math.sin(env.time * 9.1) * Math.sin(env.time * 3.3)
    this.emberMat.opacity = Math.min(1, this.heat) * flick
    this.emberMat.color.setRGB(1, 0.25 + 0.3 * Math.max(0, this.heat - 1), 0.05)
    const gs = 0.22 * this.heat * flick
    this.glow.scale.set(gs, gs, 1)
    this.glow.material.opacity = Math.min(1, this.heat)
    this.emberLight.intensity = 2.5 * this.heat * flick

    if (this.heat > 0.15) {
      this.emitAcc += dt * 45 * Math.min(1, this.heat)
      const at = new THREE.Vector3(0, this.top + this.ash + 0.01, 0)
      while (this.emitAcc >= 1) {
        this.emitAcc -= 1
        this.smoke.emit(at, up, { speed: 0.5, size: 0.035, life: 4.5, alpha: 0.22 * Math.min(1, this.heat) })
      }
    }
    this.smoke.update(dt, up, env.wind, env.time)
    this.updateAsh(dt, env)
    this.layout()
  }

  private dropAsh(env: Env) {
    const len = this.ash
    this.ash = 0
    const mesh = new THREE.Mesh(this.ashGeo, this.ashMat)
    mesh.scale.y = len
    mesh.position.set(0, this.top + len / 2, 0)
    this.group.add(mesh)
    const v = env.gravity.clone().multiplyScalar(0.3)
    this.ashBits.push({ mesh, vel: v, spin: new THREE.Vector3(Math.random() * 6 - 3, 0, Math.random() * 6 - 3), resting: false, age: 0 })
    if (this.ashBits.length > 24) this.group.remove(this.ashBits.shift()!.mesh)
  }

  private updateAsh(dt: number, env: Env) {
    for (let i = this.ashBits.length - 1; i >= 0; i--) {
      const b = this.ashBits[i]
      b.age += dt
      if (b.resting) continue
      b.vel.addScaledVector(env.gravity, 9.8 * dt * 0.5)
      b.mesh.position.addScaledVector(b.vel, dt)
      b.mesh.rotation.x += b.spin.x * dt
      b.mesh.rotation.z += b.spin.z * dt
      const p = b.mesh.position
      if (p.y <= SAND_Y + 0.03 && Math.hypot(p.x, p.z) < BOWL_R) {
        p.y = SAND_Y + 0.02
        b.mesh.rotation.set(Math.PI / 2, Math.random() * Math.PI, 0)
        b.resting = true
      } else if (b.age > 4) {
        this.group.remove(b.mesh)
        this.ashBits.splice(i, 1)
      }
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose()
    })
  }
}

function burner(): THREE.Group {
  const g = new THREE.Group()
  const pts = [
    new THREE.Vector2(0, -0.55),
    new THREE.Vector2(0.55, -0.55),
    new THREE.Vector2(0.62, -0.5),
    new THREE.Vector2(0.6, -0.45),
    new THREE.Vector2(0.85, -0.25),
    new THREE.Vector2(0.95, 0.05),
    new THREE.Vector2(0.92, 0.08),
    new THREE.Vector2(0.84, 0.0),
  ]
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), new THREE.MeshStandardMaterial({ color: '#8a6a2c', roughness: 0.35, metalness: 0.75 }))
  const sand = new THREE.Mesh(new THREE.CircleGeometry(0.86, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#9b9488', roughness: 1 }))
  sand.position.y = SAND_Y
  g.add(bowl, sand)
  return g
}

export function createCandle(kind: CandleKind): Candle & { setViewportHeight(px: number): void } {
  return kind === 'incense' ? new Incense() : new WaxCandle(kind)
}
