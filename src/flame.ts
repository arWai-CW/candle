import * as THREE from 'three'

const vertex = /* glsl */ `
varying vec3 vPosition;
void main() {
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Integrate luminous gas through a small volume, rather than stacking opaque teardrops.
// The narrow dark fuel cone, blue reaction zone and warm core remain visible from any angle.
const fragment = /* glsl */ `
uniform vec3 uCamera;
uniform float uTime;
uniform float uFlicker;
uniform float uSeed;
varying vec3 vPosition;
void main() {
  vec3 ray = normalize(vPosition - uCamera);
  vec3 inv = 1.0 / (ray + vec3(0.000001));
  vec3 a = (vec3(-1.3, -0.035, -1.3) - uCamera) * inv;
  vec3 b = (vec3(1.3, 1.085, 1.3) - uCamera) * inv;
  vec3 nearV = min(a, b);
  vec3 farV = max(a, b);
  float start = max(0.0, max(nearV.x, max(nearV.y, nearV.z)));
  float end = min(farV.x, min(farV.y, farV.z));
  if (end <= start) discard;
  float stepSize = (end - start) / 32.0;
  vec3 energy = vec3(0.0);
  float opacity = 0.0;
  float time = uTime + uSeed;
  for (int i = 0; i < 32; i++) {
    vec3 p = uCamera + ray * (start + (float(i) + 0.5) * stepSize);
    float y = clamp(p.y, 0.001, 0.999);
    float sway = pow(y, 1.8);
    p.x -= sway * (sin(time * 3.7 - y * 6.0) * 0.13 + sin(time * 8.1 - y * 12.0) * 0.05) * uFlicker;
    p.z -= sway * sin(time * 4.3 - y * 8.0) * 0.1 * uFlicker;
    float profile = 2.65 * pow(y, 0.43) * pow(1.0 - y, 1.05);
    profile *= 1.0 + 0.035 * sin(y * 25.0 - time * 9.0) * uFlicker;
    float r = length(p.xz) / max(0.001, profile);
    float density = exp(-r * r) * (1.0 - smoothstep(0.86, 1.0, r));
    density *= smoothstep(0.0, 0.04, p.y) * (1.0 - smoothstep(0.94, 1.0, p.y));
    float fuelCone = (1.0 - smoothstep(0.08, 0.33, y)) * (1.0 - smoothstep(0.12, 0.55, r));
    density *= 1.0 - fuelCone * 0.97;
    float hot = exp(-r * r * 7.0) * smoothstep(0.1, 0.35, y);
    vec3 warm = mix(vec3(3.2, 0.35, 0.008), vec3(12.0, 5.5, 1.7), hot);
    vec3 emission = mix(vec3(0.015, 0.065, 0.28), warm, smoothstep(0.1, 0.17, y));
    float alpha = 1.0 - exp(-density * stepSize * 2.8);
    energy += (1.0 - opacity) * alpha * emission;
    opacity += (1.0 - opacity) * alpha;
  }
  if (opacity < 0.003) discard;
  gl_FragColor = vec4(energy / max(opacity, 0.001), opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

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
  private readonly volume: THREE.ShaderMaterial
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
    this.volume = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uCamera: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uFlicker: { value: 1 },
        uSeed: { value: Math.random() * 100 },
      },
    })
    const gas = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.12, 2.6).translate(0, 0.525, 0), this.volume)
    gas.scale.set(width, height, width)
    gas.renderOrder = 2
    gas.onBeforeRender = (_renderer, _scene, camera) => {
      gas.worldToLocal(this.volume.uniforms.uCamera.value.setFromMatrixPosition(camera.matrixWorld))
    }
    this.pivot.add(gas)
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
    this.volume.uniforms.uTime.value = t
    this.volume.uniforms.uFlicker.value = flicker

    const flick = 0.85 + 0.1 * Math.sin(t * 17.3) + 0.06 * Math.sin(t * 31.1) - wind * 0.3
    const centre = this.tmp.copy(this.dir).multiplyScalar(this.height * 0.35 * lvl)
    this.glow.position.copy(centre)
    this.halo.position.copy(centre)
    const gs = this.height * 2.2 * lvl * flick
    this.glow.scale.set(gs, gs, 1)
    this.glow.material.opacity = 0.16 * lvl
    const hs = this.height * 7 * lvl * (0.95 + 0.05 * flick)
    this.halo.scale.set(hs, hs, 1)
    this.halo.material.opacity = 0.035 * lvl
    this.light.position.copy(centre)
    this.light.intensity = this.lightIntensity * lvl * flick
  }

  /** World position of the flame's tip, for smoke. */
  tip(out: THREE.Vector3): THREE.Vector3 {
    return this.group.localToWorld(out.copy(this.dir).multiplyScalar(this.height * 0.8))
  }
}
