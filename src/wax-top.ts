import * as THREE from 'three'
import { MeltPool, RIM_ANGLES, RIM_STEPS } from './melt'

const RINGS = 5
const X = RIM_ANGLES.map(Math.cos)
const Z = RIM_ANGLES.map(Math.sin)

export class WaxTop extends THREE.Group {
  readonly melt: MeltPool
  private readonly wax = new THREE.BufferGeometry()
  private readonly liquid = new THREE.BufferGeometry()
  private readonly pool: THREE.Mesh
  private readonly vertices = new Float32Array((1 + RIM_STEPS * RINGS) * 3)
  private readonly indices: number[] = []
  private readonly basin: number[] = []
  private readonly surface = new Float32Array(this.vertices.length / 3)
  private readonly water: Float32Array
  private readonly normals: Float32Array
  private profile = -1

  constructor(radius: number, maxWidth: number, solid: THREE.Material, wet: THREE.Material) {
    super()
    this.melt = new MeltPool(radius, maxWidth)
    for (let i = 0; i < RIM_STEPS; i++) {
      const next = (i + 1) % RIM_STEPS
      this.indices.push(0, next + 1, i + 1)
      this.basin.push(0, next + 1, i + 1)
      for (let band = 0; band < RINGS - 1; band++) {
        const inner = 1 + band * RIM_STEPS
        const outer = inner + RIM_STEPS
        this.indices.push(inner + i, outer + next, outer + i, inner + i, inner + next, outer + next)
        if (band < 2) this.basin.push(inner + i, outer + next, outer + i, inner + i, inner + next, outer + next)
      }
    }
    this.wax.setIndex(this.indices)
    this.wax.setAttribute('position', new THREE.BufferAttribute(this.vertices, 3).setUsage(THREE.DynamicDrawUsage))
    const shell = new THREE.Mesh(this.wax, solid)
    shell.frustumCulled = false
    this.add(shell)

    this.water = new Float32Array(this.basin.length * 6)
    this.normals = new Float32Array(this.water.length)
    this.liquid.setAttribute('position', new THREE.BufferAttribute(this.water, 3).setUsage(THREE.DynamicDrawUsage))
    this.liquid.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3).setUsage(THREE.DynamicDrawUsage))
    this.pool = new THREE.Mesh(this.liquid, wet)
    this.pool.frustumCulled = false
    this.add(this.pool)
  }

  update(dt: number, burning: boolean, g: THREE.Vector3) {
    const melt = this.melt
    melt.step(dt, burning, g)
    if (Math.abs(this.profile - melt.carve) > 0.0005) {
      this.profile = melt.carve
      const r = melt.radius
      const w = melt.width
      const d = melt.depth
      this.vertices[1] = -d
      for (let i = 0; i < RIM_STEPS; i++) {
        const rim = melt.rim(RIM_ANGLES[i])
        const shoulder = melt.shoulder
        const vertex = (ring: number, rad: number, y: number) => {
          const at = (1 + ring * RIM_STEPS + i) * 3
          this.vertices[at] = rad * X[i]
          this.vertices[at + 1] = y
          this.vertices[at + 2] = rad * Z[i]
        }
        vertex(0, w * 0.5, -d * 0.78)
        vertex(1, w, -d * 0.26)
        vertex(2, shoulder, rim)
        vertex(3, (shoulder + r) / 2, rim * 0.8)
        vertex(4, r, 0)
      }
      this.wax.attributes.position.needsUpdate = true
      this.wax.computeVertexNormals()
    }

    this.pool.visible = melt.heat > 0.04 && g.y < -0.08
    if (!this.pool.visible) return
    for (let i = 0; i < this.surface.length; i++) this.surface[i] = melt.surfaceY(this.vertices[i * 3], this.vertices[i * 3 + 2])
    const inv = 1 / Math.hypot(melt.slopeX, 1, melt.slopeZ)
    let written = 0
    const point = (x: number, y: number, z: number) => {
      this.water[written] = x
      this.normals[written++] = -melt.slopeX * inv
      this.water[written] = y + melt.radius * 0.0005
      this.normals[written++] = inv
      this.water[written] = z
      this.normals[written++] = -melt.slopeZ * inv
    }
    for (let i = 0; i < this.basin.length; i += 3) {
      const start = written
      let a = this.basin[i + 2]
      for (let edge = 0; edge < 3; edge++) {
        const b = this.basin[i + edge]
        const hA = this.surface[a]
        const hB = this.surface[b]
        const aAt = a * 3
        const bAt = b * 3
        const da = hA - this.vertices[aAt + 1]
        const db = hB - this.vertices[bAt + 1]
        if ((da > 0) !== (db > 0)) {
          const t = da / (da - db)
          const x = this.vertices[aAt] + t * (this.vertices[bAt] - this.vertices[aAt])
          const z = this.vertices[aAt + 2] + t * (this.vertices[bAt + 2] - this.vertices[aAt + 2])
          point(x, hA + t * (hB - hA), z)
        }
        if (db > 0) point(this.vertices[bAt], hB, this.vertices[bAt + 2])
        a = b
      }
      if (written - start === 12) {
        const last = start + 9
        const x = this.water[last], y = this.water[last + 1] - melt.radius * 0.0005, z = this.water[last + 2]
        written = last
        point(this.water[start], this.water[start + 1] - melt.radius * 0.0005, this.water[start + 2])
        point(this.water[start + 6], this.water[start + 7] - melt.radius * 0.0005, this.water[start + 8])
        point(x, y, z)
      }
    }
    this.liquid.setDrawRange(0, written / 3)
    this.liquid.attributes.position.needsUpdate = true
    this.liquid.attributes.normal.needsUpdate = true
  }
}
