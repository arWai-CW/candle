import { Quaternion, Vector3 } from 'three'
import { gravityFromOrientation, type Vec3 } from './gravity'

const DEG = Math.PI / 180
const G = 9.81
const SAMPLE_LIFETIME = 100
const Z = new Vector3(0, 0, 1)

type Sensor = { requestPermission?: () => Promise<string> }

export async function requestSensorAccess(orientation?: Sensor, motion?: Sensor): Promise<boolean> {
  // WebKit shares one grant across the two event types.
  const sensor = motion?.requestPermission ? motion : orientation
  try {
    return sensor?.requestPermission ? await sensor.requestPermission() === 'granted' : !!(orientation || motion)
  } catch {
    return false
  }
}

function finite(v: { x: number | null; y: number | null; z: number | null } | null): v is Vec3 {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
}

const decay = (dt: number, seconds: number) => 1 - Math.exp(-dt / seconds)

export class MotionResponse {
  readonly gravity = new Vector3(0, -1, 0)
  readonly sceneGravity = new Vector3(0, -1, 0)
  readonly acceleration = new Vector3()
  shake = 0
  hasOrientation = false
  private readonly targetGravity = new Vector3(0, -1, 0)
  private readonly deviceGravity = new Vector3(0, -1, 0)
  private readonly targetAcceleration = new Vector3()
  private readonly deviceAcceleration = new Vector3()
  private readonly measured = new Vector3()
  private readonly identity = new Quaternion()
  private readonly turn = new Quaternion()
  private accelerationAt = -Infinity
  private signVotes = 0

  orient(beta: number | null, gamma: number | null) {
    if (beta == null || gamma == null || !Number.isFinite(beta) || !Number.isFinite(gamma)) return
    this.targetGravity.copy(gravityFromOrientation(beta, gamma))
    if (!this.hasOrientation) this.deviceGravity.copy(this.targetGravity)
    this.hasOrientation = true
  }

  accelerate(a: DeviceMotionEventAcceleration | null, ag: DeviceMotionEventAcceleration | null, now: number) {
    const withGravity = this.hasOrientation && finite(ag)
    if (withGravity) {
      this.measured.copy(ag)
      const length = this.measured.length()
      const alignment = -this.measured.dot(this.targetGravity)
      if (length > 8 && length < 12 && Math.abs(alignment) > 0.97 * length) {
        this.signVotes = Math.max(-10, Math.min(10, this.signVotes + Math.sign(alignment)))
      }
    }
    const sign = this.signVotes < 0 ? -1 : 1
    if (finite(a)) this.targetAcceleration.copy(a).multiplyScalar(sign)
    else if (withGravity && this.signVotes !== 0) this.targetAcceleration.copy(ag).multiplyScalar(sign).addScaledVector(this.targetGravity, G)
    else return
    if (this.targetAcceleration.lengthSq() > 144) this.targetAcceleration.setLength(12)
    this.accelerationAt = now
  }

  update(dt: number, now: number, screenAngle: number, cameraRotation: Quaternion, pitch: number, roll: number) {
    if (!this.hasOrientation) {
      const p = pitch * DEG
      const r = roll * DEG
      this.targetGravity.set(-Math.sin(r) * Math.cos(p), -Math.cos(r) * Math.cos(p), -Math.sin(p))
    }
    this.turn.setFromUnitVectors(this.deviceGravity, this.targetGravity)
    this.turn.slerp(this.identity, Math.exp(-dt / 0.07))
    this.deviceGravity.applyQuaternion(this.turn)
    this.gravity.copy(this.deviceGravity)
    if (this.hasOrientation) this.gravity.applyAxisAngle(Z, screenAngle * DEG)
    this.sceneGravity.copy(this.gravity)
    if (this.hasOrientation) this.sceneGravity.applyQuaternion(cameraRotation)

    if (now - this.accelerationAt > SAMPLE_LIFETIME) this.targetAcceleration.set(0, 0, 0)
    this.deviceAcceleration.lerp(this.targetAcceleration, decay(dt, 0.065))
    this.acceleration.copy(this.deviceAcceleration).applyAxisAngle(Z, screenAngle * DEG).applyQuaternion(cameraRotation)
    if (this.acceleration.lengthSq() > 36) this.acceleration.setLength(6)
    const force = this.targetAcceleration.length()
    this.shake += (force - this.shake) * decay(dt, force > this.shake ? 0.045 : 0.15)
  }
}
