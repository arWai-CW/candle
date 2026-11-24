import * as THREE from 'three'

const vertex = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`
const fragment = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  float a = exp(-d * 3.0) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`

interface Particle {
  pos: THREE.Vector3
  vel: THREE.Vector3
  age: number
  life: number
  size: number
  alpha: number
  seed: number
}

/** Rising smoke drawn as soft points; rises along `up` and drifts with the wind. */
export class Smoke {
  readonly points: THREE.Points
  private readonly particles: Particle[] = []
  private readonly positions: Float32Array
  private readonly sizes: Float32Array
  private readonly alphas: Float32Array
  private readonly geometry = new THREE.BufferGeometry()
  private readonly material: THREE.ShaderMaterial

  constructor(
    private readonly max = 400,
    color = new THREE.Color(0.72, 0.72, 0.72),
  ) {
    this.positions = new Float32Array(max * 3)
    this.sizes = new Float32Array(max)
    this.alphas = new Float32Array(max)
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1))
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1))
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 400 }, uColor: { value: color } },
    })
    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 4
  }

  setViewportHeight(px: number) {
    this.material.uniforms.uScale.value = px
  }

  emit(at: THREE.Vector3, up: THREE.Vector3, opts: { speed: number; size: number; life: number; alpha: number }) {
    if (this.particles.length >= this.max) this.particles.shift()
    this.particles.push({
      pos: at.clone(),
      vel: up.clone().multiplyScalar(opts.speed * (0.8 + Math.random() * 0.4)),
      age: 0,
      life: opts.life * (0.8 + Math.random() * 0.4),
      size: opts.size,
      alpha: opts.alpha,
      seed: Math.random() * 100,
    })
  }

  update(dt: number, up: THREE.Vector3, wind: number, time: number) {
    let n = 0
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.age += dt
      if (p.age >= p.life) {
        this.particles.splice(i, 1)
        continue
      }
      const f = p.age / p.life
      const swirl = 0.08 + f * 0.5
      p.vel.addScaledVector(up, dt * 0.25)
      p.vel.x += Math.sin(time * 1.7 + p.seed + p.pos.y * 3) * swirl * dt
      p.vel.z += Math.cos(time * 1.3 + p.seed * 1.3 + p.pos.y * 2.5) * swirl * dt - wind * dt * 2
      p.vel.multiplyScalar(1 - dt * 0.6)
      p.pos.addScaledVector(p.vel, dt)
    }
    for (const p of this.particles) {
      const f = p.age / p.life
      this.positions[n * 3] = p.pos.x
      this.positions[n * 3 + 1] = p.pos.y
      this.positions[n * 3 + 2] = p.pos.z
      this.sizes[n] = p.size * (1 + f * 5)
      this.alphas[n] = p.alpha * Math.min(1, f * 8) * (1 - f) * (1 - f)
      n++
    }
    this.geometry.setDrawRange(0, n)
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.aSize.needsUpdate = true
    this.geometry.attributes.aAlpha.needsUpdate = true
  }

  clear() {
    this.particles.length = 0
    this.geometry.setDrawRange(0, 0)
  }
}
