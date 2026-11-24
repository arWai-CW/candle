import * as THREE from 'three'

const vertex = /* glsl */ `
uniform float uTime;
uniform float uFlicker;
uniform float uHeight;
uniform float uSeed;
varying float vT;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  vec3 p = position;
  float t = clamp(p.y / uHeight, 0.0, 1.0);
  vT = t;
  float tt = uTime + uSeed;
  float sx = sin(tt * 7.1 + p.y * 9.0) * 0.5 + sin(tt * 13.3 + 1.3) * 0.3 + sin(tt * 23.7 + p.y * 17.0) * 0.2;
  float sz = sin(tt * 8.3 + 2.0 + p.y * 7.0) * 0.5 + sin(tt * 17.9) * 0.3 + sin(tt * 29.1 + p.y * 13.0) * 0.2;
  float amp = uFlicker * t * t * uHeight * 0.14;
  p.x += sx * amp;
  p.x += sin(tt * 2.3 + t * 5.0) * t * t * uHeight * 0.055;
  p.z += sz * amp;
  p.y *= 1.0 + uFlicker * 0.07 * sin(tt * 11.0) * sin(tt * 3.7);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`

const fragment = /* glsl */ `
uniform float uIntensity;
uniform float uEdgePower;
uniform vec3 uBase;
uniform vec3 uMid;
uniform vec3 uTip;
varying float vT;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  float facing = abs(dot(normalize(vNormalV), normalize(vViewDir)));
  float edge = pow(facing, uEdgePower);
  vec3 col = mix(uBase, uMid, smoothstep(0.02, 0.28, vT));
  col = mix(col, uTip, smoothstep(0.45, 1.0, vT));
  float alpha = edge * (1.0 - smoothstep(0.88, 1.0, vT)) * (0.22 + 0.78 * smoothstep(0.0, 0.16, vT));
  gl_FragColor = vec4(col, alpha * uIntensity);
}
`

function teardrop(height: number, width: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = []
  const n = 28
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const r = (width * Math.pow(t, 0.5) * Math.pow(1 - t, 1.25)) / 0.357
    pts.push(new THREE.Vector2(Math.max(r, 0.0001), t * height))
  }
  return new THREE.LatheGeometry(pts, 24)
}

let glowTexture: THREE.Texture | null = null
export function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  grad.addColorStop(0.6, 'rgba(255,255,255,0.08)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  glowTexture = new THREE.CanvasTexture(canvas)
  return glowTexture
}

export interface FlameInput {
  /** Desired flame axis in the candle's frame (buoyancy direction), not necessarily unit. */
  up: THREE.Vector3
  /** Wind strength 0..1 blowing away from the viewer. */
  wind: number
  /** Smoothed acceleration magnitude in m/s². */
  shake: number
  time: number
}

/** A flickering 3D candle flame that keeps pointing along buoyancy. */
export class Flame {
  readonly group = new THREE.Group()
  readonly light: THREE.PointLight
  /** 0 = out, 1 = fully burning. */
  level = 0
  target = 0
  readonly dir = new THREE.Vector3(0, 1, 0)
  private readonly pivot = new THREE.Group()
  private readonly outer: THREE.ShaderMaterial
  private readonly inner: THREE.ShaderMaterial
  private readonly glow: THREE.Sprite
  private readonly halo: THREE.Sprite
  private readonly tmp = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()
  private readonly yAxis = new THREE.Vector3(0, 1, 0)

  constructor(
    readonly height: number,
    readonly width: number,
    readonly lightIntensity = 3,
  ) {
    const common = {
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      toneMapped: false,
    }
    const seed = Math.random() * 100
    this.outer = new THREE.ShaderMaterial({
      ...common,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uTime: { value: 0 },
        uFlicker: { value: 1 },
        uHeight: { value: height },
        uSeed: { value: seed },
        uIntensity: { value: 0.9 },
        uEdgePower: { value: 0.85 },
        uBase: { value: new THREE.Color(0.12, 0.17, 0.62) },
        uMid: { value: new THREE.Color(1.0, 0.48, 0.055) },
        uTip: { value: new THREE.Color(1.0, 0.24, 0.025) },
      },
    })
    this.inner = new THREE.ShaderMaterial({
      ...common,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uTime: { value: 0 },
        uFlicker: { value: 1 },
        uHeight: { value: height * 0.7 },
        uSeed: { value: seed },
        uIntensity: { value: 0.9 },
        uEdgePower: { value: 0.7 },
        uBase: { value: new THREE.Color(0.3, 0.42, 1.0) },
        uMid: { value: new THREE.Color(1.0, 0.84, 0.48) },
        uTip: { value: new THREE.Color(1.0, 0.66, 0.17) },
      },
    })
    const outerMesh = new THREE.Mesh(teardrop(height, width), this.outer)
    const innerMesh = new THREE.Mesh(teardrop(height * 0.7, width * 0.48), this.inner)
    innerMesh.position.y = height * 0.04
    outerMesh.renderOrder = 2
    innerMesh.renderOrder = 3
    this.pivot.add(outerMesh, innerMesh)
    this.pivot.position.y = -height * 0.08

    const glowMat = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: new THREE.Color(1.0, 0.62, 0.25),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    this.glow = new THREE.Sprite(glowMat)
    this.glow.renderOrder = 1
    this.halo = new THREE.Sprite(glowMat.clone())
    this.halo.material.color = new THREE.Color(1.0, 0.45, 0.15)
    this.halo.renderOrder = 1

    this.light = new THREE.PointLight(0xff9a3c, lightIntensity, 0, 2)
    this.group.add(this.pivot, this.glow, this.halo, this.light)
  }

  update(dt: number, input: FlameInput) {
    const rate = this.target > this.level ? 2.2 : 9
    this.level += Math.sign(this.target - this.level) * Math.min(Math.abs(this.target - this.level), rate * dt)

    const wind = input.wind
    this.dir.copy(input.up).normalize()
    this.dir.z -= wind * 1.6
    this.dir.y += wind * 0.3
    this.dir.normalize()
    this.q.setFromUnitVectors(this.yAxis, this.dir)
    this.pivot.quaternion.copy(this.q)

    const t = input.time
    const flicker = 0.5 + wind * 2.5 + Math.min(1, input.shake / 10) * 1.4
    const lvl = this.level
    const stretch = 1 + wind * 0.5
    const squeeze = 1 / Math.sqrt(stretch)
    const breathe = 1 + 0.04 * Math.sin(t * 5.3) + 0.03 * Math.sin(t * 12.7)
    this.pivot.scale.set(lvl * squeeze, lvl * stretch * breathe, lvl * squeeze)
    this.pivot.visible = lvl > 0.01
    for (const m of [this.outer, this.inner]) {
      m.uniforms.uTime.value = t
      m.uniforms.uFlicker.value = flicker
    }

    const flick = 0.85 + 0.1 * Math.sin(t * 17.3) + 0.06 * Math.sin(t * 31.1) - wind * 0.3
    const centre = this.tmp.copy(this.dir).multiplyScalar(this.height * 0.35 * lvl)
    this.glow.position.copy(centre)
    this.halo.position.copy(centre)
    const gs = this.height * 2.2 * lvl * flick
    this.glow.scale.set(gs, gs, 1)
    this.glow.material.opacity = 0.28 * lvl
    const hs = this.height * 7 * lvl * (0.95 + 0.05 * flick)
    this.halo.scale.set(hs, hs, 1)
    this.halo.material.opacity = 0.07 * lvl
    this.light.position.copy(centre)
    this.light.intensity = this.lightIntensity * lvl * flick
  }

  /** World position of the flame's tip, for smoke. */
  tip(out: THREE.Vector3): THREE.Vector3 {
    return this.group.localToWorld(out.copy(this.dir).multiplyScalar(this.height * 0.8))
  }
}
