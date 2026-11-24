import * as THREE from 'three'
import type { WaxBead } from './wax'

const SIDES = 10

interface Joint {
  theta: number
  y: number
  size: number
  color: number
  degree: number
  incoming: number
  tangent: THREE.Vector3
}

/** A single smooth skin over linked runoff samples, not a chain of capped blobs. */
export class WaxTrailGeometry extends THREE.BufferGeometry {
  private readonly positions: THREE.BufferAttribute
  private readonly normals: THREE.BufferAttribute
  private readonly colors: THREE.BufferAttribute
  private readonly triangles: THREE.BufferAttribute

  constructor(private readonly capacity: number) {
    super()
    const vertices = capacity * 2 * (SIDES * 2 + 1)
    this.positions = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.normals = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.colors = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.triangles = new THREE.BufferAttribute(new Uint32Array(capacity * SIDES * 24), 1).setUsage(THREE.DynamicDrawUsage)
    this.setAttribute('position', this.positions)
    this.setAttribute('normal', this.normals)
    this.setAttribute('color', this.colors)
    this.setIndex(this.triangles)
    this.setDrawRange(0, 0)
  }

  update(beads: readonly WaxBead[], radius: number, palette: readonly THREE.Color[]) {
    const joints: Joint[] = []
    const lookup = new Map<string, number>()
    const links: [number, number][] = []
    const joint = (theta: number, y: number, size: number, color: number) => {
      const key = `${theta.toFixed(6)}:${y.toFixed(6)}:${color}`
      let index = lookup.get(key)
      if (index === undefined) {
        index = joints.length
        lookup.set(key, index)
        joints.push({ theta, y, size: 0, color, degree: 0, incoming: 0, tangent: new THREE.Vector3() })
      }
      const node = joints[index]
      node.size += size
      node.degree++
      return index
    }
    const tangent = new THREE.Vector3()
    for (const bead of beads.slice(-this.capacity)) {
      const dx = (bead.theta - bead.fromTheta) * radius
      const dy = bead.y - bead.fromY
      if (Math.hypot(dx, dy) < 0.000001) continue
      const a = joint(bead.fromTheta, bead.fromY, bead.size, bead.color)
      const b = joint(bead.theta, bead.y, bead.size, bead.color)
      const angle = (bead.theta + bead.fromTheta) * 0.5
      tangent.set(-Math.sin(angle) * dx, dy, Math.cos(angle) * dx).normalize()
      joints[a].tangent.add(tangent)
      joints[b].tangent.add(tangent)
      joints[b].incoming++
      links.push([a, b])
    }

    let vertex = 0
    let index = 0
    const radial = new THREE.Vector3()
    const across = new THREE.Vector3()
    const centre = new THREE.Vector3()
    const position = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const write = (p: THREE.Vector3, n: THREE.Vector3, color: THREE.Color) => {
      this.positions.setXYZ(vertex, p.x, p.y, p.z)
      this.normals.setXYZ(vertex, n.x, n.y, n.z)
      this.colors.setXYZ(vertex++, color.r, color.g, color.b)
    }
    const triangle = (a: number, b: number, c: number) => {
      this.triangles.setX(index++, a)
      this.triangles.setX(index++, b)
      this.triangles.setX(index++, c)
    }
    const bridge = (a: number, b: number, reverse = false) => {
      for (let i = 0; i < SIDES; i++) {
        const j = (i + 1) % SIDES
        if (reverse) {
          triangle(a + i, a + j, b + i)
          triangle(b + i, a + j, b + j)
        } else {
          triangle(a + i, b + i, a + j)
          triangle(b + i, b + j, a + j)
        }
      }
    }
    const frame = (node: Joint) => {
      radial.set(Math.cos(node.theta), 0, Math.sin(node.theta))
      across.crossVectors(radial, node.tangent).normalize()
      centre.copy(radial).multiplyScalar(radius + node.size * 0.05)
      centre.y = node.y
    }
    const ring = (node: Joint, scale = 1, offset = 0) => {
      const color = palette[node.color] ?? palette[0]
      for (let i = 0; i < SIDES; i++) {
        const angle = i / SIDES * Math.PI * 2
        const c = Math.cos(angle)
        const s = Math.sin(angle)
        position.copy(centre)
          .addScaledVector(radial, c * node.size * 0.64 * scale)
          .addScaledVector(across, s * node.size * 0.85 * scale)
          .addScaledVector(node.tangent, offset * node.size * 0.85)
        normal.copy(radial).multiplyScalar(c * scale / 0.64)
          .addScaledVector(across, s * scale / 0.85)
          .addScaledVector(node.tangent, offset / 0.85).normalize()
        write(position, normal, color)
      }
    }
    for (const node of joints) {
      node.size /= node.degree
      if (node.tangent.lengthSq() < 0.000001) node.tangent.set(0, -1, 0)
      node.tangent.normalize()
      frame(node)
      ring(node)
    }
    for (const [a, b] of links) bridge(a * SIDES, b * SIDES)
    for (let i = 0; i < joints.length; i++) {
      const node = joints[i]
      if (node.degree !== 1) continue
      frame(node)
      const sign = node.incoming ? 1 : -1
      const cap = vertex
      ring(node, Math.SQRT1_2, sign * Math.SQRT1_2)
      bridge(i * SIDES, cap, sign < 0)
      position.copy(centre).addScaledVector(node.tangent, sign * node.size * 0.85)
      normal.copy(node.tangent).multiplyScalar(sign)
      const tip = vertex
      write(position, normal, palette[node.color] ?? palette[0])
      for (let j = 0; j < SIDES; j++) {
        const next = cap + (j + 1) % SIDES
        if (sign > 0) triangle(cap + j, tip, next)
        else triangle(cap + j, next, tip)
      }
    }
    this.setDrawRange(0, index)
    for (const attribute of [this.positions, this.normals, this.colors]) {
      attribute.clearUpdateRanges()
      attribute.addUpdateRange(0, vertex * 3)
      attribute.needsUpdate = true
    }
    this.triangles.clearUpdateRanges()
    this.triangles.addUpdateRange(0, index)
    this.triangles.needsUpdate = true
  }
}
