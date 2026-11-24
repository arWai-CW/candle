import * as THREE from 'three'
import './style.css'
import { BlowDetector, MicInput } from './blow'
import { createCandle, type Candle, type CandleKind } from './candles'
import { deviceToScreen, gravityFromOrientation, normalize, type Vec3 } from './gravity'

type CandleWithView = Candle & { setViewportHeight(px: number): void }

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!
const startBtn = document.querySelector<HTMLButtonElement>('#start')!
const intro = document.querySelector<HTMLElement>('#intro')!
const hud = document.querySelector<HTMLElement>('#hud')!
const relightBtn = document.querySelector<HTMLButtonElement>('#relight')!
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
scene.add(new THREE.HemisphereLight(0x6a5a4a, 0x0a0806, 0.35))

const table = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2a1d15', roughness: 0.7 }))
scene.add(table)

let candle: CandleWithView = createCandle('birthday')
scene.add(candle.group)

// --- sensors -------------------------------------------------------------
const gravity = new THREE.Vector3(0, -1, 0)
const accel = new THREE.Vector3()
let orientation: { beta: number; gamma: number } | null = null
let accelSign = 1
let accelSignVotes = 0
let dragTilt = { beta: 90, gamma: 0 }

function screenAngle(): number {
  const a = screen.orientation?.angle
  if (typeof a === 'number') return a
  const legacy = (window as unknown as { orientation?: number }).orientation
  return typeof legacy === 'number' ? (legacy + 360) % 360 : 0
}

window.addEventListener('deviceorientation', (e) => {
  if (e.beta == null || e.gamma == null) return
  orientation = { beta: e.beta, gamma: e.gamma }
})

window.addEventListener('devicemotion', (e) => {
  const a = e.acceleration
  const ag = e.accelerationIncludingGravity
  const angle = screenAngle()
  if (a && a.x != null && a.y != null && a.z != null) {
    const v = deviceToScreen({ x: a.x, y: a.y, z: a.z }, angle)
    accel.set(v.x, v.y, v.z)
  }
  // Some iOS versions report motion with inverted signs; vote against the orientation-derived gravity.
  if (orientation && ag && ag.x != null && ag.y != null && ag.z != null) {
    const v = deviceToScreen({ x: ag.x, y: ag.y, z: ag.z }, angle)
    const d = -(v.x * gravity.x + v.y * gravity.y + v.z * gravity.z)
    if (Math.abs(d) > 5) {
      accelSignVotes = Math.max(-30, Math.min(30, accelSignVotes + Math.sign(d)))
      accelSign = accelSignVotes >= 0 ? 1 : -1
    }
  }
})

async function requestMotion(): Promise<void> {
  const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
  if (typeof DOE?.requestPermission === 'function') {
    try {
      await DOE.requestPermission()
    } catch {
      /* denied: falls back to drag-to-tilt */
    }
  }
}

// Drag to tilt when there is no motion sensor (desktop), hold to blow when there is no mic.
let pointerDown: { x: number; y: number; moved: boolean; beta: number; gamma: number } | null = null
let manualBlow = false
canvas.addEventListener('pointerdown', (e) => {
  pointerDown = { x: e.clientX, y: e.clientY, moved: false, beta: dragTilt.beta, gamma: dragTilt.gamma }
  canvas.setPointerCapture(e.pointerId)
})
canvas.addEventListener('pointermove', (e) => {
  if (!pointerDown) return
  const dx = e.clientX - pointerDown.x
  const dy = e.clientY - pointerDown.y
  if (Math.hypot(dx, dy) > 10) pointerDown.moved = true
  if (pointerDown.moved && !orientation) {
    dragTilt = {
      beta: Math.max(-10, Math.min(190, pointerDown.beta - dy * 0.4)),
      gamma: Math.max(-89, Math.min(89, pointerDown.gamma + dx * 0.4)),
    }
  }
})
const endPointer = () => {
  pointerDown = null
}
canvas.addEventListener('pointerup', endPointer)
canvas.addEventListener('pointercancel', endPointer)
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') manualBlow = true
})
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') manualBlow = false
})

// --- mic -----------------------------------------------------------------
let mic: MicInput | null = null
const detector = new BlowDetector()

async function startMic(ctx: AudioContext) {
  try {
    mic = await MicInput.start(ctx)
  } catch {
    mic = null
    showHint('冇咪用，㩒住畫面吹', 4000)
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

relightBtn.addEventListener('click', () => {
  if (candle.burnedOut) candle.reset()
  candle.light()
  showHint(candle.kind === 'incense' ? '吹熄支香' : '吹熄佢', 1800)
})

let started = false
let wakeLock: { release(): Promise<void> } | null = null
startBtn.addEventListener('click', async () => {
  // iOS needs both permission prompts and the AudioContext created inside the tap.
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AC()
  const motion = requestMotion()
  const micReady = startMic(ctx)
  void ctx.resume()
  intro.classList.add('hidden')
  hud.classList.remove('hidden')
  started = true
  candle.light()
  await Promise.all([motion, micReady])
  try {
    const nav = navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null
  } catch {
    wakeLock = null
  }
  if (mic) showHint('對住咪吹一啖氣', 3000)
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
  table.position.y = candle.kind === 'birthday' ? -0.95 : candle.kind === 'incense' ? -0.55 : -0.06
  candle.setViewportHeight(h * renderer.getPixelRatio())
}
window.addEventListener('resize', resize)
resize()

// --- loop ----------------------------------------------------------------
const clock = new THREE.Clock()
const up = new THREE.Vector3()
let wind = 0
let lastLit = false

function frame() {
  const dt = Math.min(0.05, clock.getDelta())
  const time = clock.elapsedTime

  const tilt = orientation ?? dragTilt
  const g: Vec3 = normalize(gravityFromOrientation(tilt.beta, tilt.gamma, orientation ? screenAngle() : 0))
  gravity.lerp(new THREE.Vector3(g.x, g.y, g.z), Math.min(1, dt * 20)).normalize()

  // Buoyancy: flames lean toward the direction the phone accelerates.
  const a = accel.clone().multiplyScalar(accelSign)
  if (a.length() > 6) a.setLength(6)
  up.copy(gravity).multiplyScalar(-9.81).add(a)

  let blowStrength = 0
  if (mic) {
    const state = detector.update(mic.read(), dt)
    blowStrength = state.strength
    if (state.blown && candle.lit) blowOut()
  }
  const holdBlow = manualBlow || (!!pointerDown && !pointerDown.moved && (!mic || !orientation))
  const manualTarget = holdBlow ? 1 : 0
  wind += (Math.max(blowStrength, manualTarget * 0.9) - wind) * Math.min(1, dt / (holdBlow ? 0.25 : 0.2))
  if (holdBlow) manualHeld += dt
  else manualHeld = 0
  if (manualHeld > 0.35 && candle.lit) blowOut()

  candle.update(dt, { gravity, up, wind, shake: accel.length(), time })
  meter.style.transform = `scaleX(${Math.min(1, wind).toFixed(3)})`

  if (candle.lit !== lastLit) {
    lastLit = candle.lit
    relightBtn.classList.toggle('hidden', candle.lit)
    if (!candle.lit && candle.burnedOut) showHint(candle.kind === 'incense' ? '燒完喇' : '燒到盡喇', 2500)
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
