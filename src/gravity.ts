export interface Vec3 {
  x: number
  y: number
  z: number
}

const DEG = Math.PI / 180

/**
 * Unit gravity vector in screen coordinates (x right, y up, z out of the screen)
 * from DeviceOrientationEvent beta/gamma and the screen rotation angle.
 */
export function gravityFromOrientation(betaDeg: number, gammaDeg: number, screenAngleDeg = 0): Vec3 {
  const b = betaDeg * DEG
  const g = gammaDeg * DEG
  const device = {
    x: Math.cos(b) * Math.sin(g),
    y: -Math.sin(b),
    z: -Math.cos(b) * Math.cos(g),
  }
  return deviceToScreen(device, screenAngleDeg)
}

/** Rotates a device-frame vector into the frame of the screen as currently rotated. */
export function deviceToScreen(v: Vec3, screenAngleDeg: number): Vec3 {
  const a = screenAngleDeg * DEG
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z }
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z)
  return len > 1e-9 ? { x: v.x / len, y: v.y / len, z: v.z / len } : { x: 0, y: -1, z: 0 }
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}
