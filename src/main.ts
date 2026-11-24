import * as THREE from 'three'
import './style.css'
import { BlowDetector, MicInput } from './blow'
import { createCandle, type Candle, type CandleKind } from './candles'
import { MotionResponse, requestSensorAccess } from './motion'

type CandleWithView = Candle & { setViewportHeight(px: number): void }

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!
const intro = document.querySelector<HTMLElement>('#intro')!
const hud = document.querySelector<HTMLElement>('#hud')!
const sensInput = document.querySelector<HTMLInputElement>('#sens')!
const hint = document.querySelector<HTMLElement>('#hint')!
const meter = document.querySelector<HTMLElement>('#meter > div')!
const kindButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-kind]')]

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
renderer.setClearColor(0x080605)

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(0x080605, 9, 22)
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 60)
// Low-key warm fill and a restrained cool rim leave the flame as the key light.
scene.add(new THREE.HemisphereLight(0xa5b6c8, 0x201713, 0.3))
const key = new THREE.DirectionalLight(0xffd1a4, 0.55)
key.position.set(-3, 4, 3)
scene.add(key)
const rim = new THREE.DirectionalLight(0x8296b9, 0.4)
rim.position.set(3, 3, -2)
scene.add(rim)

const table = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#15110e', roughness: 0.7 }))
scene.add(table)

// Soft contact shading grounds the objects without six shadow-map renders per flame.
const contactCanvas = document.createElement('canvas')
contactCanvas.width = contactCanvas.height = 128
const contactCtx = contactCanvas.getContext('2d')!
const contactGradient = contactCtx.createRadialGradient(64, 64, 8, 64, 64, 64)
contactGradient.addColorStop(0, 'rgba(0,0,0,0.65)')
contactGradient.addColorStop(0.55, 'rgba(0,0,0,0.4)')
contactGradient.addColorStop(1, 'rgba(0,0,0,0)')
contactCtx.fillStyle = contactGradient
contactCtx.fillRect(0, 0, 128, 128)
const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(contactCanvas), transparent: true, depthWrite: false }))
scene.add(contact)

let candle: CandleWithView = createCandle('birthday')
scene.add(candle.group)

// --- sensors -------------------------------------------------------------
const motion = new MotionResponse()
let dragTilt = { pitch: 0, roll: 0 }

function screenAngle(): number {
  const a = screen.orientation?.angle
  if (typeof a === 'number') return a
  const legacy = (window as unknown as { orientation?: number }).orientation
  return typeof legacy === 'number' ? (legacy + 360) % 360 : 0
}

window.addEventListener('deviceorientation', (e) => {
  motion.orient(e.beta, e.gamma)
})

window.addEventListener('devicemotion', (e) => {
  motion.accelerate(e.acceleration, e.accelerationIncludingGravity, performance.now())
})

// Drag to tilt when there is no motion sensor (desktop), hold to blow when there is no mic.
let pointerDown: { x: number; y: number; moved: boolean; pitch: number; roll: number; wasLit: boolean } | null = null
let manualBlow = false
canvas.addEventListener('pointerdown', (e) => {
  pointerDown = { x: e.clientX, y: e.clientY, moved: false, ...dragTilt, wasLit: candle.lit }
  canvas.setPointerCapture(e.pointerId)
})
canvas.addEventListener('pointermove', (e) => {
  if (!pointerDown) return
  const dx = e.clientX - pointerDown.x
  const dy = e.clientY - pointerDown.y
  if (Math.hypot(dx, dy) > 10) pointerDown.moved = true
  if (pointerDown.moved && !motion.hasOrientation) {
    dragTilt = {
      pitch: Math.max(-85, Math.min(85, pointerDown.pitch + dy * 0.4)),
      roll: Math.max(-89, Math.min(89, pointerDown.roll + dx * 0.4)),
    }
  }
})
const endPointer = () => {
  pointerDown = null
}
canvas.addEventListener('pointerup', () => {
  if (started && pointerDown && !pointerDown.moved && !pointerDown.wasLit && !candle.lit) relight()
  endPointer()
})
canvas.addEventListener('pointercancel', endPointer)
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') manualBlow = true
})
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') manualBlow = false
})

// --- mic -----------------------------------------------------------------
let mic: MicInput | null = null
const SENS_KEY = 'candle.sensitivity'
const detector = new BlowDetector(Number(localStorage.getItem(SENS_KEY)) || 1.6)
sensInput.value = String(detector.sensitivity)
sensInput.addEventListener('input', () => {
  detector.sensitivity = Number(sensInput.value)
  localStorage.setItem(SENS_KEY, sensInput.value)
})

async function startMic(ctx: AudioContext) {
  try {
    mic = await MicInput.start(ctx)
  } catch {
    mic = null
  }
}

// --- UI ------------------------------------------------------------------
let hintTimer = 0
function showHint(text: string, ms = 2500) {
  hint.textContent = text
  hint.classList.add('show')
  window.clearTimeout(hintTimer)
  hintTimer = window.setTimeout(() => hint.classList.remove('show'), ms)
}

function setKind(kind: CandleKind) {
  if (candle.kind === kind) return
  const wasLit = candle.lit
  scene.remove(candle.group)
  candle.dispose()
  candle = createCandle(kind)
  scene.add(candle.group)
  resize()
  if (wasLit || started) candle.light()
  for (const b of kindButtons) b.classList.toggle('active', b.dataset.kind === kind)
}

for (const b of kindButtons) b.addEventListener('click', () => setKind(b.dataset.kind as CandleKind))

function relight() {
  if (candle.burnedOut) candle.reset()
  candle.light()
}

let started = false
let wakeLock: { release(): Promise<void> } | null = null
intro.addEventListener('click', async () => {
  if (started) return
  type PermissionSource = { requestPermission?: () => Promise<string> }
  const motionReady = requestSensorAccess(
    window.DeviceOrientationEvent as (typeof DeviceOrientationEvent & PermissionSource) | undefined,
    window.DeviceMotionEvent as (typeof DeviceMotionEvent & PermissionSource) | undefined,
  )
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = AC ? new AC() : null
  const micReady = ctx ? startMic(ctx) : Promise.resolve()
  if (ctx) void ctx.resume()
  intro.classList.add('hidden')
  hud.classList.remove('hidden')
  started = true
  candle.light()
  const [motionAllowed] = await Promise.all([motionReady, micReady])
  if (!motionAllowed) showHint(mic ? '拖動畫面可以打側蠟燭' : '拖動畫面可以打側蠟燭 · 冇咪用，㩒住畫面吹', 4000)
  else if (!mic) showHint('冇咪用，㩒住畫面吹', 4000)
  try {
    const nav = navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null
  } catch {
    wakeLock = null
  }
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && started && wakeLock) {
    const nav = navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }
    nav.wakeLock?.request('screen').then((l) => (wakeLock = l)).catch(() => {})
  }
})

// --- layout --------------------------------------------------------------
function resize() {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  const f = candle.focus
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const dist = Math.max(f.halfHeight / tanHalf, f.halfWidth / (tanHalf * camera.aspect)) * 1.08
  camera.position.set(f.centre.x, f.centre.y + dist * 0.22, f.centre.z + dist)
  camera.lookAt(f.centre)
  camera.updateProjectionMatrix()
  table.position.y = candle.kind === 'incense' ? -0.55 : -0.06
  contact.position.y = table.position.y + 0.003
  contact.scale.setScalar(candle.kind === 'birthday' ? 1.1 : 2.7)
  candle.setViewportHeight(h * renderer.getPixelRatio())
}
window.addEventListener('resize', resize)
resize()

// --- loop ----------------------------------------------------------------
const clock = new THREE.Clock()
const up = new THREE.Vector3()
const airUp = new THREE.Vector3()
let wind = 0
let lastLit = false

function frame() {
  const dt = Math.min(0.05, clock.getDelta())
  const time = clock.elapsedTime

  motion.update(dt, performance.now(), screenAngle(), camera.quaternion, dragTilt.pitch, dragTilt.roll)
  airUp.copy(motion.sceneGravity).negate()
  up.copy(airUp).multiplyScalar(9.81).add(motion.acceleration)

  let blowStrength = 0
  if (mic) {
    const state = detector.update(mic.read(), dt)
    blowStrength = state.strength
    if (state.blown && candle.lit) blowOut()
  }
  const holdBlow = manualBlow || (!!pointerDown && !pointerDown.moved && (!mic || !motion.hasOrientation))
  const manualTarget = holdBlow ? 1 : 0
  wind += (Math.max(blowStrength, manualTarget * 0.9) - wind) * Math.min(1, dt / (holdBlow ? 0.25 : 0.2))
  if (holdBlow) manualHeld += dt
  else manualHeld = 0
  if (manualHeld > 0.35 && candle.lit) blowOut()

  candle.update(dt, { gravity: motion.gravity, up, airUp, wind, shake: motion.shake, time })
  meter.style.transform = `scaleX(${Math.min(1, wind).toFixed(3)})`

  if (candle.lit !== lastLit) {
    lastLit = candle.lit
    if (!candle.lit) showHint(candle.burnedOut ? (candle.kind === 'incense' ? '燒完喇' : '燒到盡喇') : '點擊畫面點火', 2500)
  }

  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
let manualHeld = 0

function blowOut() {
  candle.extinguish()
  manualHeld = 0
}

requestAnimationFrame(frame)
