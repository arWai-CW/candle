import * as THREE from 'three'
import './style.css'
import { createAnimationLoop } from './animation'
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
const mobile = window.matchMedia('(pointer: coarse)')
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
let motion = new MotionResponse()
let dragTilt = { pitch: 0, roll: 0 }

function screenAngle(): number {
  const a = screen.orientation?.angle
  if (typeof a === 'number') return a
  const legacy = (window as unknown as { orientation?: number }).orientation
  return typeof legacy === 'number' ? (legacy + 360) % 360 : 0
}

window.addEventListener('deviceorientation', (e) => {
  if (isForeground()) motion.orient(e.beta, e.gamma)
})

window.addEventListener('devicemotion', (e) => {
  if (isForeground()) motion.accelerate(e.acceleration, e.accelerationIncludingGravity, performance.now())
})

// Drag to tilt when there is no motion sensor (desktop), hold to blow when there is no mic.
let pointerDown: { x: number; y: number; moved: boolean; pitch: number; roll: number; wasLit: boolean } | null = null
let manualBlow = false
canvas.addEventListener('contextmenu', (e) => e.preventDefault())
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
const holdHint = '㩒住螢幕吹熄'
const SENS_KEY = 'candle.sensitivity'
const detector = new BlowDetector(Number(localStorage.getItem(SENS_KEY)) || 1.6)
sensInput.value = String(detector.sensitivity)
sensInput.addEventListener('input', () => {
  detector.sensitivity = Number(sensInput.value)
  localStorage.setItem(SENS_KEY, sensInput.value)
})

async function startMic() {
  showHint('請允許使用咪高峰', 0)
  try {
    mic = await MicInput.start()
    mic.setActive(isForeground())
    showHint('咪高峰準備中', 3500)
  } catch (error) {
    const denied = error instanceof DOMException && error.name === 'NotAllowedError'
    const message = denied
      ? `咪高峰未獲准；${holdHint}\n喺瀏覽器設定開咪後重新載入`
      : `未能使用咪高峰；${holdHint}`
    showHint(message, 6500)
    return message
  }
}

// --- UI ------------------------------------------------------------------
let hintTimer = 0
function showHint(text: string, ms = 2500) {
  hint.textContent = text
  hint.classList.add('show')
  window.clearTimeout(hintTimer)
  if (ms > 0) hintTimer = window.setTimeout(() => hint.classList.remove('show'), ms)
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
  showHint(mic ? (candle.kind === 'incense' ? '吹熄支香' : '吹熄佢') : holdHint, 1800)
}

let started = false
let pageHidden = false
let contextLost = false
let wakeLock: WakeLockSentinel | null = null
let wakeLockPending = false

function isForeground() {
  return !pageHidden && document.visibilityState === 'visible'
}

async function requestWakeLock() {
  if (!started || !isForeground() || !navigator.wakeLock || wakeLockPending || (wakeLock && !wakeLock.released)) return
  wakeLockPending = true
  try {
    const lock = await navigator.wakeLock.request('screen')
    if (isForeground()) wakeLock = lock
    else await lock.release()
  } catch {
    // Wake lock is optional and can be denied by the browser.
  } finally {
    wakeLockPending = false
  }
}

intro.addEventListener('click', async () => {
  if (started) return
  intro.classList.add('hidden')
  hud.classList.remove('hidden')
  started = true
  candle.light()
  syncAnimation()
  // Start both permission requests directly from the tap.
  const micReady = startMic()
  type PermissionSource = { requestPermission?: () => Promise<string> }
  const motionReady = requestSensorAccess(
    window.DeviceOrientationEvent as (typeof DeviceOrientationEvent & PermissionSource) | undefined,
    window.DeviceMotionEvent as (typeof DeviceMotionEvent & PermissionSource) | undefined,
  )
  void requestWakeLock()
  const [motionAllowed, micFailure] = await Promise.all([motionReady, micReady])
  if (!motionAllowed) showHint(micFailure ? `拖動畫面可以打側蠟燭\n${micFailure}` : '拖動畫面可以打側蠟燭', micFailure ? 6500 : 4000)
})

function syncPageActivity() {
  const visible = isForeground()
  mic?.setActive(visible)
  if (visible) {
    void requestWakeLock()
  } else {
    pointerDown = null
    manualBlow = false
    manualHeld = 0
    motion = new MotionResponse()
    void wakeLock?.release().catch(() => {})
    wakeLock = null
  }
  syncAnimation()
}

document.addEventListener('visibilitychange', syncPageActivity)
window.addEventListener('pagehide', () => {
  pageHidden = true
  syncPageActivity()
})
window.addEventListener('pageshow', () => {
  pageHidden = false
  syncPageActivity()
})
window.addEventListener('click', () => {
  // Safari can require a fresh user gesture after an audio interruption.
  if (isForeground() && mic && !mic.available) mic.setActive(true)
})

// --- layout --------------------------------------------------------------
function resize() {
  const w = Math.max(1, window.innerWidth)
  const h = Math.max(1, window.innerHeight)
  const pixelRatio = Math.min(window.devicePixelRatio, mobile.matches ? 1.5 : 2)
  if (pixelRatio !== renderer.getPixelRatio()) renderer.setPixelRatio(pixelRatio)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  const f = candle.focus
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const dist = Math.max(f.halfHeight / tanHalf, f.halfWidth / (tanHalf * camera.aspect)) * 1.08
  camera.position.set(f.centre.x, f.centre.y + dist * 0.22, f.centre.z + dist)
  camera.lookAt(f.centre)
  camera.updateProjectionMatrix()
  table.position.y = candle.kind === 'incense' ? -0.55 : -0.06
  candle.setViewportHeight(h * renderer.getPixelRatio())
  syncAnimation()
}

// --- loop ----------------------------------------------------------------
const up = new THREE.Vector3()
const airUp = new THREE.Vector3()
let wind = 0
let lastLit = false
let lastMeter = '0.000'

function frame(dt: number, time: number) {
  motion.update(dt, performance.now(), screenAngle(), camera.quaternion, dragTilt.pitch, dragTilt.roll)
  airUp.copy(motion.sceneGravity).negate()
  up.copy(airUp).multiplyScalar(9.81).add(motion.acceleration)

  let blowStrength = 0
  const activeMic = mic?.available ? mic : null
  if (activeMic) {
    const wasReady = detector.ready
    const state = detector.update(activeMic.read(), dt)
    if (!wasReady && detector.ready) showHint('對住咪吹一啖氣', 3000)
    blowStrength = state.strength
    if (state.blown && candle.lit) blowOut()
  }
  const holdBlow = manualBlow || (!!pointerDown && !pointerDown.moved && (!activeMic || !motion.hasOrientation))
  const manualTarget = holdBlow ? 1 : 0
  wind += (Math.max(blowStrength, manualTarget * 0.9) - wind) * Math.min(1, dt / (holdBlow ? 0.25 : 0.2))
  if (holdBlow) manualHeld += dt
  else manualHeld = 0
  if (manualHeld > 0.35 && candle.lit) blowOut()

  candle.update(dt, { gravity: motion.gravity, up, airUp, wind, shake: motion.shake, time })
  const meterValue = Math.min(1, wind).toFixed(3)
  if (meterValue !== lastMeter) {
    meter.style.transform = `scaleX(${meterValue})`
    lastMeter = meterValue
  }

  if (candle.lit !== lastLit) {
    lastLit = candle.lit
    if (!candle.lit) showHint(candle.burnedOut ? (candle.kind === 'incense' ? '燒完喇' : '燒到盡喇') : '點擊畫面點火', 2500)
  }

  renderer.render(scene, camera)
}
let manualHeld = 0

function blowOut() {
  candle.extinguish()
  manualHeld = 0
}

const animation = createAnimationLoop(frame)
function syncAnimation() {
  if (!isForeground() || contextLost) animation.stop()
  else if (started) animation.start()
  else animation.drawOnce()
}
canvas.addEventListener('webglcontextlost', () => {
  contextLost = true
  syncAnimation()
})
canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false
  resize()
})
window.addEventListener('resize', resize)
mobile.addEventListener('change', resize)
resize()
