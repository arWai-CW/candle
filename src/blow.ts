export interface BlowFrame {
  /** RMS level in dBFS. */
  level: number
  /** Share of spectral power below ~600 Hz, 0..1. */
  lowRatio: number
  /** Spectral flatness from 140 to 1600 Hz, 0..1. */
  flatness: number
  /** Share of spectral power from 40 to 375 Hz, 0..1. */
  rumbleRatio: number
  /** The lower of the rumble and higher-frequency tail flatness scores, 0..1. */
  rumbleFlatness: number
  /** Power from 375 to 1600 Hz relative to the rumble power. */
  rumbleTailRatio: number
}

export interface BlowState {
  /** Smoothed wind strength, 0..1. */
  strength: number
  /** True on the frame a sustained blow is detected. */
  blown: boolean
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const spectralFlatness = (power: number, logPower: number, bins: number) =>
  power > 1e-16 * bins ? Math.pow(10, logPower / (10 * bins)) / (power / bins) : 0

export const DEFAULT_BLOW_SENSITIVITY = 1.6
export const MAX_BLOW_SENSITIVITY = 3

/**
 * Turns microphone frames into a wind strength and a "blown out" trigger.
 * Blowing into a phone mic is loud, low-frequency noise well above the room's noise floor.
 */
export class BlowDetector {
  floor = -60
  strength = 0
  private calibration = 0.3
  private calibrationTimeout = 3
  private envelope = -60
  private peak = -Infinity
  private candidateAge = 0
  private qualificationLevel?: number
  private sustained = 0
  private released = 0
  private armed = true

  constructor(public sensitivity = 1) {}

  get ready() {
    return this.calibration <= 0 || this.calibrationTimeout <= 0
  }

  update(frame: BlowFrame, dt: number): BlowState {
    this.envelope += (frame.level - this.envelope) * (1 - Math.exp(-dt / 0.045))
    if (!this.ready) {
      this.calibrationTimeout -= dt
      if (frame.level > -110) {
        this.calibration -= dt
        this.learnFloor(frame.level, dt, 0.07)
      }
      return { strength: 0, blown: false }
    }

    const s = Math.max(0.25, this.sensitivity)
    const boost = clamp01((s - DEFAULT_BLOW_SENSITIVITY) / (MAX_BLOW_SENSITIVITY - DEFAULT_BLOW_SENSITIVITY))
    const holdSeconds = 0.22
    const softLevel = -40
    const excess = frame.level - this.floor
    const minLevel = Math.max(-58 - 4 * boost, -34 - (s < 1 ? 12 : 18) * (s - 1))
    const minRatio = Math.max(0.15, 0.28 - 0.05 * (s - 1))
    const minExcess = 14 / s - 1.3 * boost
    const overGate = frame.level > minLevel && excess > minExcess
    const broadband = frame.lowRatio > minRatio && frame.flatness > 0.19
    const turbulent = boost > 0 && frame.rumbleRatio > 0.8 - 0.22 * boost &&
      frame.rumbleFlatness > 0.30 - 0.16 * boost && frame.rumbleTailRatio > 0.06
    const blowLike = overGate && (broadband || turbulent)
    const holdRate = frame.level <= softLevel || turbulent ? holdSeconds / (holdSeconds - 0.10 * boost) : 1
    const raw = blowLike && this.armed ? clamp01(((excess - 10 / s) / 30) * s) : 0

    const tau = raw > this.strength ? 0.04 : 0.25
    this.strength += (clamp01(raw) - this.strength) * Math.min(1, dt / tau)

    if (!this.armed) {
      if (excess <= 6) this.learnFloor(frame.level, dt, excess < 0 ? 6 : 0.25)
      this.released = frame.level < Math.max(this.floor + Math.min(6, minExcess), minLevel) ? this.released + dt : 0
      if (this.released >= 0.15) this.armed = true
    } else if (!blowLike && this.candidateAge === 0) {
      this.learnFloor(frame.level, dt, excess < 0 ? 6 : 2.5)
    }

    let blown = false
    if (this.armed && (blowLike || this.candidateAge > 0)) {
      this.candidateAge += dt
      this.peak = Math.max(this.peak, this.envelope)
      const envelopeDrop = this.peak <= softLevel ? 6 - 3 * boost : 6
      this.sustained = blowLike ? Math.min(holdSeconds, this.sustained + dt * holdRate) : Math.max(0, this.sustained - dt * 2)
      if (this.sustained >= holdSeconds) this.qualificationLevel ??= this.envelope
      const qualifiedAt = this.qualificationLevel

      if (this.candidateAge >= 3.2) {
        this.learnFloor(this.envelope, dt, 0.15)
        if (this.envelope - this.floor <= 2) this.resetCandidate()
      } else if (qualifiedAt !== undefined && (
        (blowLike && this.envelope - qualifiedAt >= 6) ||
        ((blowLike || !overGate) && this.peak - this.envelope >= envelopeDrop)
      )) {
        blown = true
        this.resetCandidate()
        this.released = 0
        this.armed = false
      } else if (qualifiedAt === undefined ? this.sustained === 0 || excess <= 3 : overGate && this.sustained === 0) {
        this.resetCandidate()
      }
    }
    return { strength: this.strength, blown }
  }

  private resetCandidate() {
    this.peak = -Infinity
    this.candidateAge = 0
    this.qualificationLevel = undefined
    this.sustained = 0
  }

  private learnFloor(level: number, dt: number, tau: number) {
    const bounded = Math.min(-18, Math.max(-90, level))
    this.floor += (bounded - this.floor) * (1 - Math.exp(-dt / tau))
  }
}

/** Microphone capture feeding BlowFrames. Create inside a user gesture on iOS. */
export class MicInput {
  private readonly time: Float32Array<ArrayBuffer>
  private readonly freq: Float32Array<ArrayBuffer>
  private readonly tracks: MediaStreamTrack[]

  private constructor(
    private readonly ctx: AudioContext,
    private readonly analyser: AnalyserNode,
    stream: MediaStream,
  ) {
    this.time = new Float32Array(analyser.fftSize)
    this.freq = new Float32Array(analyser.frequencyBinCount)
    this.tracks = stream.getAudioTracks()
  }

  static async start(): Promise<MicInput> {
    const AC = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC || !navigator.mediaDevices?.getUserMedia) throw new DOMException('', 'NotSupportedError')

    const ctx = new AC()
    let stream: MediaStream | undefined
    void ctx.resume().catch(() => {})
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0
      source.connect(analyser)
      return new MicInput(ctx, analyser, stream)
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      void ctx.close().catch(() => {})
      throw error
    }
  }

  get available() {
    return this.ctx.state === 'running' && this.tracks.some((track) => track.enabled && !track.muted && track.readyState === 'live')
  }

  setActive(active: boolean) {
    this.tracks.forEach((track) => (track.enabled = active))
    if (this.ctx.state === 'closed') return
    if (!active) void this.ctx.suspend().catch(() => {})
    else void this.ctx.resume().catch(() => {})
  }

  read(): BlowFrame {
    this.analyser.getFloatTimeDomainData(this.time)
    let sum = 0
    for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i]
    const level = 10 * Math.log10(sum / this.time.length + 1e-12)

    this.analyser.getFloatFrequencyData(this.freq)
    const binHz = this.ctx.sampleRate / this.analyser.fftSize
    let low = 0
    let total = 0
    let bandPower = 0
    let bandLogPower = 0
    let bandBins = 0
    let rumblePower = 0
    let rumbleLogPower = 0
    let rumbleBins = 0
    let tailPower = 0
    let tailLogPower = 0
    let tailBins = 0
    for (let i = 1; i < this.freq.length && i * binHz < 8000; i++) {
      const hz = i * binHz
      const p = Math.pow(10, this.freq[i] / 10)
      total += p
      if (hz < 600) low += p
      const logPower = Math.max(-160, this.freq[i])
      if (hz >= 40 && hz < 375) {
        rumblePower += p
        rumbleLogPower += logPower
        rumbleBins++
      } else if (hz >= 375 && hz < 1600) {
        tailPower += p
        tailLogPower += logPower
        tailBins++
      }
      if (hz >= 140 && hz < 1600) {
        bandPower += p
        bandLogPower += logPower
        bandBins++
      }
    }
    return {
      level,
      lowRatio: total > 0 ? low / total : 0,
      flatness: spectralFlatness(bandPower, bandLogPower, bandBins),
      rumbleRatio: total > 0 ? rumblePower / total : 0,
      rumbleTailRatio: rumblePower > 0 ? tailPower / rumblePower : 0,
      rumbleFlatness: Math.min(
        spectralFlatness(rumblePower, rumbleLogPower, rumbleBins),
        spectralFlatness(tailPower, tailLogPower, tailBins),
      ),
    }
  }
}
