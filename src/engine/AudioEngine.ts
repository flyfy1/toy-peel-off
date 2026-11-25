// 100% synthesized audio. No audio files, nothing to 404.

const PENTA = [0, 2, 4, 7, 9] // major pentatonic, semitones

/** Frequency of the n-th step of a major pentatonic scale above `base`. */
export function pentaFreq(step: number, base = 220): number {
  const oct = Math.floor(step / 5)
  const deg = ((step % 5) + 5) % 5
  return base * Math.pow(2, (PENTA[deg] + 12 * oct) / 12)
}

type Wave = OscillatorType

interface ToneOpts {
  freq: number
  freqEnd?: number
  type?: Wave
  dur?: number
  gain?: number
  attack?: number
  delay?: number
  pan?: number
}

interface NoiseOpts {
  dur?: number
  gain?: number
  filter?: BiquadFilterType
  freq?: number
  freqEnd?: number
  q?: number
  attack?: number
  delay?: number
}

export interface Riser {
  set(p: number): void
  stop(): void
}

class AudioEngine {
  ctx: AudioContext | null = null
  private master: GainNode | null = null
  /** Bypasses the compressor: its 180 ms release would pump up a wood tail and turn "tok" into "tooong". */
  private dry: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private recent: number[] = []

  /** Call from the first pointerdown. Creates/resumes the context. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      const ctx = new AC()
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.knee.value = 12
      comp.ratio.value = 6
      comp.attack.value = 0.002
      comp.release.value = 0.18
      const master = ctx.createGain()
      master.gain.value = 0.8
      master.connect(comp).connect(ctx.destination)
      const dry = ctx.createGain()
      dry.gain.value = 0.62
      dry.connect(ctx.destination)
      this.dry = dry
      const len = ctx.sampleRate * 2
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      this.ctx = ctx
      this.master = master
      this.noiseBuf = buf
    }
    if (this.ctx.state !== 'running') void this.ctx.resume()
  }

  private get ok(): boolean {
    return !!this.ctx && !!this.master
  }

  /** Voice budget for the high-rate sounds only (pop/chime/blip), so a 300-bubble
   *  chain doesn't melt the mixer. Big one-shots (boom/chord/shatter) never go through it. */
  private budget(max = 8, windowS = 0.05): boolean {
    if (!this.ok) return false
    const now = this.ctx!.currentTime
    this.recent = this.recent.filter((t) => now - t < windowS)
    if (this.recent.length >= max) return false
    this.recent.push(now)
    return true
  }

  tone(o: ToneOpts): void {
    if (!this.ok) return
    const ctx = this.ctx!
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const dur = o.dur ?? 0.2
    const attack = o.attack ?? 0.004
    const osc = ctx.createOscillator()
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(o.freq, t0)
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.3, t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    let node: AudioNode = osc.connect(g)
    if (o.pan !== undefined && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner()
      p.pan.value = Math.max(-1, Math.min(1, o.pan))
      node = node.connect(p)
    }
    node.connect(this.master!)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  noise(o: NoiseOpts): void {
    if (!this.ok) return
    const ctx = this.ctx!
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const dur = o.dur ?? 0.3
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = o.filter ?? 'lowpass'
    f.frequency.setValueAtTime(o.freq ?? 2000, t0)
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + dur)
    f.Q.value = o.q ?? 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.4, t0 + (o.attack ?? 0.003))
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(f).connect(g).connect(this.master!)
    src.start(t0, Math.random() * 1.5)
    src.stop(t0 + dur + 0.02)
  }

  // ---------- presets ----------

  /** Sub-bass drop: the chest punch. */
  subDrop(power = 1): void {
    this.tone({ freq: 140, freqEnd: 32, type: 'sine', dur: 0.9 * power + 0.2, gain: 0.9 * power, attack: 0.003 })
    this.tone({ freq: 70, freqEnd: 28, type: 'triangle', dur: 0.7 * power + 0.2, gain: 0.5 * power })
  }

  /** Big explosion: sub drop + noise blast + bright crack. */
  boom(power = 1): void {
    this.subDrop(power)
    this.noise({ dur: 1.2 * power + 0.2, gain: 0.7 * power, filter: 'lowpass', freq: 6000, freqEnd: 120, attack: 0.002 })
    this.noise({ dur: 0.12, gain: 0.5 * power, filter: 'highpass', freq: 3000 })
  }

  /** Small punchy pop with a pitched body. */
  blip(freq: number, gain = 0.25): void {
    if (!this.budget()) return
    this.tone({ freq: freq * 1.5, freqEnd: freq, type: 'triangle', dur: 0.18, gain })
    this.noise({ dur: 0.05, gain: gain * 0.6, filter: 'bandpass', freq: 2500, q: 1.5 })
    this.tone({ freq: 160, freqEnd: 60, dur: 0.12, gain: gain * 0.9 })
  }

  /** Crisp bell-ish note for pitch escalation. */
  chime(freq: number, gain = 0.18, pan = 0): void {
    if (!this.budget()) return
    this.tone({ freq, type: 'sine', dur: 0.35, gain, pan })
    this.tone({ freq: freq * 2, type: 'triangle', dur: 0.12, gain: gain * 0.35, pan })
  }

  chord(freqs: number[], dur = 1.2, gain = 0.16, spread = 0.03): void {
    freqs.forEach((f, i) => {
      this.tone({ freq: f, type: 'triangle', dur, gain, delay: i * spread, attack: 0.01 })
      this.tone({ freq: f * 1.003, type: 'sine', dur, gain: gain * 0.7, delay: i * spread, attack: 0.01 })
    })
  }

  /** Bubble pop: fast upward sine chirp + click. */
  pop(freq: number, gain = 0.3): void {
    if (!this.budget()) return
    this.tone({ freq: freq * 0.6, freqEnd: freq * 1.9, type: 'sine', dur: 0.07, gain, attack: 0.002 })
    this.noise({ dur: 0.025, gain: gain * 0.5, filter: 'highpass', freq: 4000 })
  }

  /** Tempered-glass knock: thud + inharmonic ping + bright noise tick. */
  glassHit(intensity = 0.5): void {
    const i = Math.min(1, intensity)
    this.tone({ freq: 120, freqEnd: 55, dur: 0.18, gain: 0.55 + 0.3 * i })
    this.noise({ dur: 0.09 + 0.1 * i, gain: 0.35 + 0.35 * i, filter: 'highpass', freq: 2500 })
    const base = 1800 + Math.random() * 1400
    ;[1, 1.73, 2.61, 3.9].forEach((m, k) =>
      this.tone({ freq: base * m, type: 'sine', dur: 0.25 + 0.4 * i - k * 0.05, gain: 0.08 / (k + 1) + 0.05 * i, pan: Math.random() - 0.5 }),
    )
  }

  /** Full shatter: crash + a rain of tinkles over ~1.4 s. */
  shatter(): void {
    this.boom(0.7)
    this.noise({ dur: 1.4, gain: 0.6, filter: 'highpass', freq: 1800, freqEnd: 5000, attack: 0.002 })
    for (let k = 0; k < 40; k++) {
      const d = Math.pow(Math.random(), 1.6) * 1.4
      this.tone({ freq: 2500 + Math.random() * 5500, type: 'sine', dur: 0.08 + Math.random() * 0.25, gain: 0.05 + Math.random() * 0.07, delay: d, pan: Math.random() * 2 - 1 })
    }
  }

  /** Wooden fish (木鱼) "tok", modal synthesis: three inharmonic sine modes with
   *  exponential decay (time constants 90 / 50 / 30 ms), a 6 ms band-passed strike click
   *  and a short body thump. f is randomised ±1.5% per hit so repeats don't machine-gun.
   *  v in [0,1] is strike velocity: louder and brighter when harder. Not voice-budgeted. */
  woodKnock(v = 0.8, f0 = 520, delay = 0): void {
    if (!this.ok) return
    const ctx = this.ctx!
    const t0 = ctx.currentTime + delay
    const vel = Math.max(0.15, Math.min(1, v))
    const f = f0 * (1 + (Math.random() * 2 - 1) * 0.015)
    const out = ctx.createGain()
    out.gain.value = 0.55 + 0.45 * vel
    out.connect(this.dry ?? this.master!)
    const modes: [number, number, number][] = [
      [1, 0.09, 0.5],
      [2.35, 0.05, 0.2 * (0.6 + 0.4 * vel)],
      [3.9, 0.03, 0.08 * (0.4 + 0.6 * vel)],
    ]
    for (const [m, tau, gain] of modes) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      // a hint of downward glide at the strike, as wood stiffens back
      osc.frequency.setValueAtTime(f * m * 1.012, t0)
      osc.frequency.exponentialRampToValueAtTime(f * m, t0 + 0.025)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(gain, t0 + 0.0015)
      g.gain.setTargetAtTime(0, t0 + 0.0015, tau)
      osc.connect(g).connect(out)
      osc.start(t0)
      osc.stop(t0 + tau * 9 + 0.01)
    }
    // strike click: 6 ms of noise through a 1.8 kHz band-pass
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1800 * (0.85 + 0.3 * vel)
    bp.Q.value = 1.1
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0, t0)
    ng.gain.linearRampToValueAtTime(0.25 * (0.5 + 0.5 * vel), t0 + 0.0008)
    ng.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.006)
    src.connect(bp).connect(ng).connect(out)
    src.start(t0, Math.random() * 1.5)
    src.stop(t0 + 0.01)
    // hollow body thump, 180 Hz for ~40 ms
    const th = ctx.createOscillator()
    th.type = 'sine'
    th.frequency.setValueAtTime(180 * (f0 / 520) ** 0.5, t0)
    th.frequency.exponentialRampToValueAtTime(140 * (f0 / 520) ** 0.5, t0 + 0.04)
    const tg = ctx.createGain()
    tg.gain.setValueAtTime(0, t0)
    tg.gain.linearRampToValueAtTime(0.2, t0 + 0.002)
    tg.gain.setTargetAtTime(0, t0 + 0.002, 0.012)
    th.connect(tg).connect(out)
    th.start(t0)
    th.stop(t0 + 0.08)
  }

  /** Soft two-note wooden chime for milestones (not arcade). */
  bell(f = 784, gain = 0.12): void {
    if (!this.ok) return
    this.tone({ freq: f, type: 'sine', dur: 1.6, gain, attack: 0.004 })
    this.tone({ freq: f * 2.76, type: 'sine', dur: 0.6, gain: gain * 0.25, attack: 0.004 })
    this.tone({ freq: f * 1.5, type: 'sine', dur: 1.8, gain: gain * 0.7, attack: 0.004, delay: 0.16 })
  }

  whoosh(gain = 0.35): void {
    this.noise({ dur: 0.3, gain, filter: 'bandpass', freq: 400, freqEnd: 4000, q: 2, attack: 0.08 })
  }

  /** Continuous rising tension tone. set(p) with p in [0,1]. */
  riser(): Riser {
    if (!this.ok) return { set() {}, stop() {} }
    const ctx = this.ctx!
    const t0 = ctx.currentTime
    const out = ctx.createGain()
    out.gain.setValueAtTime(0.0001, t0)
    out.gain.exponentialRampToValueAtTime(0.22, t0 + 0.05)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.Q.value = 6
    const a = ctx.createOscillator()
    a.type = 'sawtooth'
    const b = ctx.createOscillator()
    b.type = 'square'
    const lfo = ctx.createOscillator()
    const lfoG = ctx.createGain()
    lfo.frequency.value = 6
    lfoG.gain.value = 0
    lfo.connect(lfoG).connect(out.gain)
    a.connect(f)
    b.connect(f)
    f.connect(out).connect(this.master!)
    const set = (p: number) => {
      const t = ctx.currentTime
      const fr = 70 * Math.pow(12, p)
      a.frequency.setTargetAtTime(fr, t, 0.03)
      b.frequency.setTargetAtTime(fr * 1.505, t, 0.03)
      f.frequency.setTargetAtTime(300 + 5000 * p * p, t, 0.03)
      lfo.frequency.setTargetAtTime(6 + 30 * p, t, 0.05)
      lfoG.gain.setTargetAtTime(0.12 * p, t, 0.05)
    }
    set(0)
    a.start()
    b.start()
    lfo.start()
    let stopped = false
    return {
      set,
      stop() {
        if (stopped) return
        stopped = true
        const t = ctx.currentTime
        out.gain.cancelScheduledValues(t)
        out.gain.setTargetAtTime(0.0001, t, 0.015)
        ;[a, b, lfo].forEach((o) => o.stop(t + 0.1))
      },
    }
  }
}

export const audio = new AudioEngine()
