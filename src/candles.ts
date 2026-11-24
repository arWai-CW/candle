import * as THREE from 'three'
import { DripSim } from './wax'
import { Flame, getGlowTexture } from './flame'
import { Smoke } from './smoke'
import { WaxTop } from './wax-top'
import { IncenseBurn } from './incense-burn'

const Y_AXIS = new THREE.Vector3(0, 1, 0)

export type CandleKind = 'birthday' | 'white' | 'incense'

export interface Env {
  /** Unit gravity in the candle's frame (screen frame). */
  gravity: THREE.Vector3
  /** Buoyancy direction: opposite of gravity plus device acceleration, m/s^2. */
  up: THREE.Vector3
  /** Unit world-up direction in the candle's scene, without shake. */
  airUp: THREE.Vector3
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
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvec4 waxPosition = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwaxPosition = instanceMatrix * waxPosition;\n#endif\nvWorldY = (modelMatrix * waxPosition).y;',
      )
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
  tiltDripRate: number
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
    burnRate: 1.25 / 125,
    dripRate: 0.9,
    tiltDripRate: 2.2,
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
    burnRate: 1.8 / 330,
    dripRate: 0.18,
    tiltDripRate: 1.8,
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
  private readonly top: WaxTop
  private readonly poolMat: THREE.MeshStandardMaterial
  private readonly wick: THREE.Mesh
  private readonly ember: THREE.Mesh
  private readonly emberMat: THREE.MeshBasicMaterial
  private readonly sim: DripSim
  private readonly beads: THREE.InstancedMesh
  private readonly smoke = new Smoke(300)
  private readonly glowUniforms = { uTop: { value: 0 }, uGlow: { value: 0 } }
  private readonly stripes?: THREE.CanvasTexture
  private readonly dripColors: THREE.Color[]
  private emberHeat = 0
  private wispTimer = 0
  private spawnAcc = 0
  private uprightOutlet = 0
  private readonly tmpV = new THREE.Vector3()
  private readonly tmpM = new THREE.Matrix4()
  private readonly tmpQ = new THREE.Quaternion()
  private readonly tmpS = new THREE.Vector3()

  constructor(kind: 'birthday' | 'white') {
    this.kind = kind
    const spec = (this.spec = SPECS[kind])
    this.height = spec.height

    if (kind === 'birthday') this.stripes = stripeTexture('#ffffff', '#ff7aa8')
    const plateRadius = kind === 'birthday' ? 0.32 : spec.radius * 2.1
    this.group.add(plate(plateRadius))

    this.dripColors = spec.dripColors.map((color) => new THREE.Color(color))
    const bodyGeo = new THREE.CylinderGeometry(spec.radius, spec.radius, 1, 40, 1, true)
    bodyGeo.translate(0, 0.5, 0)
    this.body = new THREE.Mesh(bodyGeo, waxMaterial(spec.waxColor, this.glowUniforms, this.stripes))
    this.group.add(this.body)

    this.poolMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.waxColor).multiplyScalar(0.42),
      roughness: 0.21,
      metalness: 0,
      emissive: new THREE.Color(1, 0.55, 0.2),
      emissiveIntensity: 0,
    })
    this.top = new WaxTop(spec.radius, kind === 'birthday' ? 0.91 : 0.84, waxMaterial(spec.waxColor, this.glowUniforms), this.poolMat)
    this.group.add(this.top)

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

    this.sim = new DripSim(spec.radius, 0, 1800, plateRadius * 0.92)
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
    this.top.update(0, false, new THREE.Vector3(0, -1, 0))
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
    this.top.melt.reset()
    this.top.update(0, false, new THREE.Vector3(0, -1, 0))
    this.spawnAcc = 0
    this.uprightOutlet = 0
    this.sim.clear()
    this.smoke.clear()
    this.flame.target = 0
    this.flame.level = 0
    this.layout()
  }

  private layout() {
    this.body.scale.y = this.height
    this.top.position.y = this.height
    const recess = this.top.melt.depth * 0.78
    this.wick.position.y = this.height - 0.02 - recess
    this.wick.scale.y = 1 + recess * 0.75 / this.spec.wickLength
    this.flame.group.position.set(Math.sin(-this.wick.rotation.z) * this.spec.wickLength * 0.7, this.height + this.spec.wickLength * 0.75 - recess * 0.25, 0)
    if (this.stripes) this.stripes.repeat.set(1, this.height / 0.32)
  }

  update(dt: number, env: Env) {
    const spec = this.spec
    const g = env.gravity
    this.flame.update(dt, env)

    const burning = this.lit && this.flame.level > 0.5
    if (burning) {
      this.height -= spec.burnRate * dt
      if (this.height <= spec.minHeight) {
        this.height = spec.minHeight
        this.burnedOut = true
        this.extinguish()
      }
    }
    this.top.update(dt, burning && !this.burnedOut, g)
    const melt = this.top.melt
    if (!this.burnedOut && melt.heat > 0.2) {
      const rate = spec.dripRate * (burning ? melt.heat ** 3 * 0.7 : 0) + melt.overflow * spec.tiltDripRate
      this.spawnAcc += rate * dt
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1
        if (!this.uprightOutlet || Math.random() < 0.19) this.uprightOutlet = Math.random() * Math.PI * 2
        const outlet = melt.overflow > 0.05 ? melt.outlet : this.uprightOutlet
        const theta = outlet + (Math.random() - 0.5) * 0.18
        const stripe = (Math.PI / 2 - theta) / (2 * Math.PI) - this.height / 0.32
        const color = this.stripes && stripe - Math.floor(stripe) >= 26 / 64 ? 1 : 0
        this.sim.spawn(theta, this.height, 0.45 + Math.random() * 0.45, color)
      }
    }
    this.sim.step(dt, g, this.height)
    this.sim.meltAbove(this.height)
    this.layout()

    this.poolMat.emissiveIntensity = 0.02 * this.flame.level
    this.poolMat.roughness = 0.2 + 0.36 * (1 - melt.heat)

    this.glowUniforms.uTop.value = this.height + 0.05
    this.glowUniforms.uGlow.value = this.flame.level * (this.kind === 'white' ? 1 : 0.6)

    // Wick ember and the smoke wisp after it goes out.
    this.emberHeat = Math.max(0, this.emberHeat - dt * 0.5)
    this.emberMat.opacity = Math.max(this.emberHeat, this.flame.level * 0.6)
    const at = this.tmpV.set(this.flame.group.position.x, this.height + spec.wickLength * 0.9, 0)
    const up = this.tmpS.copy(env.up).normalize()
    this.smoke.update(dt, at, up, env.airUp, env.wind, env.time)
    if (this.wispTimer > 0) {
      this.wispTimer -= dt
      const n = Math.random() < this.wispTimer ? 2 : 1
      for (let i = 0; i < n; i++) this.smoke.emit(at, up, { speed: 0.35, size: spec.radius * 0.6 + 0.05, life: 2.6, alpha: 0.32 * Math.min(1, this.wispTimer) })
    }

    this.renderBeads()
  }

  setViewportHeight(px: number) {
    this.smoke.setViewportHeight(px)
  }

  private renderBeads() {
    if (!this.sim.dirty && this.sim.drips.length === 0) return
    const r = this.spec.radius
    let i = 0
    const place = (color: number) => {
      if (i >= this.sim.maxBeads) return
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS)
      this.beads.setMatrixAt(i, this.tmpM)
      this.beads.setColorAt(i, this.dripColors[color])
      i++
    }
    const onSide = (theta: number, y: number, size: number, color: number, moving: boolean) => {
      const out = r - size * 0.12
      this.tmpV.set(Math.cos(theta) * out, y, Math.sin(theta) * out)
      this.tmpQ.setFromAxisAngle(Y_AXIS, -theta)
      this.tmpS.set(size * (moving ? 0.68 : 0.45), size * (moving ? 1.65 : 1.3), size)
      place(color)
    }
    for (const d of this.sim.drops) {
      this.tmpV.set(d.x, d.y, d.z)
      this.tmpQ.identity()
      this.tmpS.set(d.size * (d.landed ? 1.8 : 1), d.size * (d.landed ? 0.26 : 1.3), d.size * (d.landed ? 1.6 : 1))
      place(d.color)
    }
    for (const d of this.sim.drips) onSide(d.theta, d.y, this.sim.size(d.mass), d.color, true)
    for (const b of this.sim.beads) onSide(b.theta, b.y, b.size, b.color, false)
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
const INCENSE_BASE = -0.25

function ashGeometry() {
  const geometry = new THREE.CylinderGeometry(0.021, 0.027, 1, 9, 8)
  const p = geometry.attributes.position
  const colors = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const rough = Math.sin(Math.atan2(z, x) * 5 + y * 21) * Math.cos(y * 37)
    p.setXYZ(i, x * (1 + 0.19 * rough), y + 0.021 * rough, z * (1 + 0.19 * rough))
    const tone = 0.58 + 0.35 * rough + 0.14 * Math.cos(y * 53)
    colors.fill(tone, i * 3, (i + 1) * 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

class Incense implements Candle {
  readonly kind = 'incense' as const
  readonly group = new THREE.Group()
  readonly focus = { centre: new THREE.Vector3(0, 1.3, 0), halfWidth: 1.0, halfHeight: 1.9 }
  burnedOut = false
  private readonly burn = new IncenseBurn(STICK_LEN + INCENSE_BASE, INCENSE_BASE + BARE + 0.02)
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
  private readonly ashGeo = ashGeometry()
  private readonly ashMat = new THREE.MeshStandardMaterial({ color: '#b8b4ad', roughness: 1, vertexColors: true })
  private emitAcc = 0
  private readonly tmp = new THREE.Vector3()
  private readonly smokeSource = new THREE.Vector3()
  private readonly ashAxis = new THREE.Vector3(0, 1, 0)

  constructor() {
    this.group.add(burner())
    const stickGeo = new THREE.CylinderGeometry(0.011, 0.011, 1, 6)
    stickGeo.translate(0, 0.5, 0)
    const stick = new THREE.Mesh(stickGeo, new THREE.MeshStandardMaterial({ color: '#c9a36b', roughness: 0.8 }))
    stick.position.y = INCENSE_BASE
    stick.scale.y = BARE + 0.1
    this.group.add(stick)

    const coatGeo = new THREE.CylinderGeometry(0.026, 0.026, 1, 10)
    coatGeo.translate(0, 0.5, 0)
    this.coat = new THREE.Mesh(coatGeo, new THREE.MeshStandardMaterial({ color: '#7a2f22', roughness: 0.9 }))
    this.coat.position.y = INCENSE_BASE + BARE
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
    this.burn.reset()
    this.ashAxis.copy(Y_AXIS)
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
    const { top, ash } = this.burn
    const coatLen = Math.max(0.001, top - INCENSE_BASE - BARE)
    this.coat.scale.y = coatLen
    this.ember.position.y = top
    this.ashMesh.visible = ash > 0.005
    this.ashMesh.scale.y = Math.max(0.001, ash)
    this.ashMesh.position.set(0, top, 0).addScaledVector(this.ashAxis, ash / 2)
    this.ashMesh.quaternion.setFromUnitVectors(Y_AXIS, this.ashAxis)
    this.glow.position.y = top
    this.emberLight.position.y = top + 0.05
  }

  update(dt: number, env: Env) {
    const up = this.tmp.copy(env.up).normalize()
    // Blowing feeds the ember before it is strong enough to put it out.
    const want = this.target * (1 + env.wind * 0.8)
    this.heat += (want - this.heat) * Math.min(1, dt / (want > this.heat ? 0.6 : 1.6))
    const burning = this.heat > 0.3 && this.target > 0
    const released = this.burn.step(dt, burning, env.wind, env.gravity, env.shake)
    const lateral = Math.hypot(env.gravity.x, env.gravity.z)
    const lean = lateral > 0.001 ? Math.sin(this.burn.bend) / lateral : 0
    this.ashAxis.set(env.gravity.x * lean, Math.cos(this.burn.bend), env.gravity.z * lean)
    if (released > 0) this.dropAsh(released, env)
    if (this.burn.finished) {
      this.burnedOut = true
      this.target = 0
    }

    const flick = 0.9 + 0.1 * Math.sin(env.time * 9.1) * Math.sin(env.time * 3.3)
    this.emberMat.opacity = Math.min(1, this.heat) * flick
    this.emberMat.color.setRGB(1, 0.25 + 0.3 * Math.max(0, this.heat - 1), 0.05)
    const gs = 0.22 * this.heat * flick
    this.glow.scale.set(gs, gs, 1)
    this.glow.material.opacity = Math.min(1, this.heat)
    this.emberLight.intensity = 2.5 * this.heat * flick

    const at = this.smokeSource.set(0, this.burn.top + 0.01, 0)
    this.smoke.update(dt, at, up, env.airUp, env.wind, env.time)
    if (this.heat > 0.15) {
      this.emitAcc += dt * 45 * Math.min(1, this.heat)
      while (this.emitAcc >= 1) {
        this.emitAcc -= 1
        this.smoke.emit(at, up, { speed: 0.5, size: 0.035, life: 4.5, alpha: 0.22 * Math.min(1, this.heat) })
      }
    }
    this.updateAsh(dt, env)
    this.layout()
  }

  private dropAsh(len: number, env: Env) {
    const pieces = len > 0.12 ? [len * 0.64, len * 0.36] : [len]
    let offset = 0
    for (const size of pieces) {
      const mesh = new THREE.Mesh(this.ashGeo, this.ashMat)
      mesh.scale.y = size
      mesh.position.set(0, this.burn.top, 0).addScaledVector(this.ashAxis, offset + size / 2)
      mesh.quaternion.setFromUnitVectors(Y_AXIS, this.ashAxis)
      offset += size
      this.group.add(mesh)
      const v = env.gravity.clone().multiplyScalar(0.22)
      v.x += (Math.random() - 0.5) * 0.3
      v.z += (Math.random() - 0.5) * 0.3
      this.ashBits.push({ mesh, vel: v, spin: new THREE.Vector3(Math.random() * 7 - 3.5, 0, Math.random() * 7 - 3.5), resting: false, age: 0 })
      if (this.ashBits.length > 24) this.group.remove(this.ashBits.shift()!.mesh)
    }
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
      if (p.y <= SAND_Y + 0.03 && b.vel.y < 0 && Math.hypot(p.x, p.z) < BOWL_R) {
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
