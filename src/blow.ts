export interface BlowFrame {
  /** RMS level in dBFS. */
  level: number
  /** Share of spectral power below ~600 Hz, 0..1. */
  lowRatio: number
}

export interface BlowState {
  /** Smoothed wind strength, 0..1. */
  strength: number
  /** True on the frame a sustained blow is detected. */
  blown: boolean
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Turns microphone frames into a wind strength and a "blown out" trigger.
 * Blowing into a phone mic is loud, low-frequency noise well above the room's noise floor.
 */
export class BlowDetector {
  floor = -60
  strength = 0
  private sustained = 0
  private cooldown = 0

  constructor(
    public sensitivity = 1,
    private readonly holdSeconds = 0.18,
  ) {}

  update(frame: BlowFrame, dt: number): BlowState {
    const s = Math.max(0.25, this.sensitivity)
    const excess = frame.level - this.floor
    const minLevel = -34 - 12 * (s - 1)
    const minRatio = Math.max(0.15, 0.3 - 0.05 * (s - 1))
    const blowLike = frame.lowRatio > minRatio && frame.level > minLevel && excess > 14 / s
    const raw = blowLike ? clamp01(((excess - 10 / s) / 22) * s) : 0

    const tau = raw > this.strength ? 0.04 : 0.25
    this.strength += (clamp01(raw) - this.strength) * Math.min(1, dt / tau)

    if (!blowLike && frame.level < this.floor + 10) {
      this.floor += (frame.level - this.floor) * Math.min(1, dt / 1.5)
    } else if (!blowLike) {
      this.floor += (frame.level - this.floor) * Math.min(1, dt / 6)
    }
    this.floor = Math.min(-38, Math.max(-90, this.floor))

    if (raw > 0.45) this.sustained += dt
    else this.sustained = Math.max(0, this.sustained - dt * 2)

    this.cooldown = Math.max(0, this.cooldown - dt)
    let blown = false
    if (this.sustained >= this.holdSeconds && this.cooldown === 0) {
      blown = true
      this.sustained = 0
      this.cooldown = 0.6
    }
    return { strength: this.strength, blown }
  }
}

/** Microphone capture feeding BlowFrames. Create inside a user gesture on iOS. */
export class MicInput {
  private readonly time: Float32Array<ArrayBuffer>
  private readonly freq: Float32Array<ArrayBuffer>

  private constructor(
    private readonly ctx: AudioContext,
    private readonly analyser: AnalyserNode,
  ) {
    this.time = new Float32Array(analyser.fftSize)
    this.freq = new Float32Array(analyser.frequencyBinCount)
  }

  static async start(ctx: AudioContext): Promise<MicInput> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    if (ctx.state !== 'running') await ctx.resume()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.2
    source.connect(analyser)
    return new MicInput(ctx, analyser)
  }

  read(): BlowFrame {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    this.analyser.getFloatTimeDomainData(this.time)
    let sum = 0
    for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i]
    const level = 10 * Math.log10(sum / this.time.length + 1e-12)

    this.analyser.getFloatFrequencyData(this.freq)
    const binHz = this.ctx.sampleRate / this.analyser.fftSize
    let low = 0
    let total = 0
    for (let i = 1; i < this.freq.length && i * binHz < 8000; i++) {
      const p = Math.pow(10, this.freq[i] / 10)
      total += p
      if (i * binHz < 600) low += p
    }
    return { level, lowRatio: total > 0 ? low / total : 0 }
  }
}
