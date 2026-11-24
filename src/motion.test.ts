import { Quaternion, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { MotionResponse, requestSensorAccess } from './motion'

const step = (motion: MotionResponse, now = 0, angle = 0, camera = new Quaternion()) => {
  motion.update(1 / 60, now, angle, camera, 0, 0)
}

describe('motion permission', () => {
  it('requests the shared WebKit grant immediately and only once', async () => {
    const orientation = { requestPermission: vi.fn(async () => 'granted') }
    const motion = { requestPermission: vi.fn(async () => 'granted') }
    const access = requestSensorAccess(orientation, motion)
    expect(motion.requestPermission).toHaveBeenCalledOnce()
    expect(orientation.requestPermission).not.toHaveBeenCalled()
    await expect(access).resolves.toBe(true)
  })

  it('falls back to orientation permission, or to drag when unavailable or refused', async () => {
    await expect(requestSensorAccess({ requestPermission: async () => 'granted' })).resolves.toBe(true)
    await expect(requestSensorAccess({})).resolves.toBe(true)
    await expect(requestSensorAccess()).resolves.toBe(false)
    await expect(requestSensorAccess({ requestPermission: async () => 'denied' })).resolves.toBe(false)
    await expect(requestSensorAccess(undefined, { requestPermission: async () => { throw Error() } })).resolves.toBe(false)
  })
})

describe('motion response', () => {
  it('keeps a unit direction and follows an exact half-turn instead of stalling', () => {
    const motion = new MotionResponse()
    motion.orient(90, 0)
    step(motion)
    motion.orient(-90, 0)
    step(motion)
    expect(motion.gravity.y).toBeGreaterThan(-0.9)
    for (let i = 0; i < 45; i++) step(motion)
    expect(motion.gravity.y).toBeCloseTo(1, 5)
    expect(motion.gravity.length()).toBeCloseTo(1, 10)
  })

  it('reframes both directions immediately for each landscape sign and compensates camera pitch', () => {
    const motion = new MotionResponse()
    const camera = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.2)
    motion.orient(0, -90)
    motion.accelerate({ x: 3, y: 0, z: 0 }, null, 0)
    step(motion, 0, 90, camera)
    expect(motion.gravity.y).toBeCloseTo(-1)
    expect(motion.sceneGravity.clone().applyQuaternion(camera.clone().invert()).y).toBeCloseTo(-1)
    expect(motion.acceleration.y).toBeGreaterThan(0)
    step(motion, 1, -90, camera)
    expect(motion.gravity.y).toBeCloseTo(1)
    expect(motion.acceleration.y).toBeLessThan(0)
  })

  it('filters near-vertical jitter and lets a horizontal drag tilt without a sensor', () => {
    const motion = new MotionResponse()
    motion.orient(null, 0)
    motion.update(0.1, 0, 0, new Quaternion(), 0, 45)
    expect(motion.hasOrientation).toBe(false)
    expect(motion.gravity.x).toBeLessThan(-0.5)

    motion.orient(90, 0)
    for (let i = 0; i < 30; i++) {
      motion.orient(i % 2 ? 87 : 93, 60)
      step(motion)
      expect(Math.abs(motion.gravity.x)).toBeLessThan(0.011)
    }
  })

  it('reacts to an acceleration burst and clears its lean and flicker when samples stop', () => {
    const motion = new MotionResponse()
    for (let i = 0; i <= 200; i += 16) {
      motion.accelerate({ x: 12, y: 0, z: 0 }, null, i)
      step(motion, i)
    }
    expect(motion.acceleration.x).toBeCloseTo(6)
    expect(motion.shake).toBeGreaterThan(10)
    for (let i = 200; i <= 1200; i += 16) step(motion, i)
    expect(motion.acceleration.length()).toBeLessThan(0.001)
    expect(motion.shake).toBeLessThan(0.05)
  })

  it('subtracts stationary gravity when the browser lacks linear acceleration', () => {
    const motion = new MotionResponse()
    motion.orient(90, 0)
    motion.accelerate(null, { x: 0, y: -9.81, z: 0 }, 0)
    step(motion)
    expect(motion.acceleration.length()).toBeCloseTo(0)
    motion.accelerate(null, { x: -5, y: -9.81, z: 0 }, 16)
    step(motion, 16)
    expect(motion.acceleration.x).toBeGreaterThan(0)
  })
})
