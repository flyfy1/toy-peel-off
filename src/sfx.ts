// Peel Off sounds (spec section 4). All synthesised with Web Audio; no files.

export type Variant = 'phone' | 'steel' | 'remote'

class Sfx {
  ctx: AudioContext | null = null
  private out: GainNode | null = null
  private buf: AudioBuffer | null = null
  private hissG: GainNode | null = null
  private strG: GainNode | null = null
  private strF: BiquadFilterNode | null = null
  private rusG: GainNode | null = null
  private rusLfo: OscillatorNode | null = null

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      const ctx = new AC()
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -16
      comp.ratio.value = 4
      const out = ctx.createGain()
      out.gain.value = 0.9
      out.connect(comp).connect(ctx.destination)
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      this.ctx = ctx
      this.out = out
      this.buf = buf
      // continuous beds: hiss (front moving), stretch (taut, stuck), rustle (wad moving)
      const loop = () => {
        const s = ctx.createBufferSource()
        s.buffer = buf
        s.loop = true
        s.loopStart = Math.random()
        s.start()
        return s
      }
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 6000
      this.hissG = ctx.createGain()
      this.hissG.gain.value = 0
      loop().connect(hp).connect(this.hissG).connect(out)
      this.strF = ctx.createBiquadFilter()
      this.strF.type = 'bandpass'
      this.strF.frequency.value = 700
      this.strF.Q.value = 8
      this.strG = ctx.createGain()
      this.strG.gain.value = 0
      loop().connect(this.strF).connect(this.strG).connect(out)
      const rb = ctx.createBiquadFilter()
      rb.type = 'bandpass'
      rb.frequency.value = 4000
      rb.Q.value = 1.5
      const am = ctx.createGain()
      am.gain.value = 0.5
      this.rusLfo = ctx.createOscillator()
      this.rusLfo.frequency.value = 35
      const depth = ctx.createGain()
      depth.gain.value = 0.5
      this.rusLfo.connect(depth).connect(am.gain)
      this.rusLfo.start()
      this.rusG = ctx.createGain()
      this.rusG.gain.value = 0
      loop().connect(rb).connect(am).connect(this.rusG).connect(out)
    }
    if (this.ctx.state !== 'running') void this.ctx.resume()
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0
  }

  private burst(at: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass', freqEnd?: number) {
    const ctx = this.ctx
    if (!ctx || !this.out || !this.buf) return
    const s = ctx.createBufferSource()
    s.buffer = this.buf
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.setValueAtTime(freq, at)
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, at + dur)
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(gain, at + Math.min(0.002, dur * 0.3))
    g.gain.exponentialRampToValueAtTime(0.0005, at + dur)
    s.connect(f).connect(g).connect(this.out)
    s.start(at, Math.random() * 1.5, dur + 0.02)
  }

  private sine(at: number, freq: number, dur: number, gain: number, freqEnd?: number) {
    const ctx = this.ctx
    if (!ctx || !this.out) return
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(freq, at)
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, at + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(gain, at + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0005, at + dur)
    o.connect(g).connect(this.out)
    o.start(at)
    o.stop(at + dur + 0.02)
  }

  /** One stick-slip step. k = peeled fraction (the pitch rises as the film comes off). */
  peelTick(at: number, k: number, v: Variant, mul = 1) {
    const pitch = v === 'steel' ? 0.8 : 1
    const loud = v === 'steel' ? 1.3 : 1
    const c = (2000 + 3000 * k) * pitch * (1 + (Math.random() * 2 - 1) * 0.15)
    this.burst(at, 0.003 + Math.random() * 0.002, c, 3, (0.05 + Math.random() * 0.07) * loud * mul)
    if (v === 'remote') this.burst(at + 0.008 + Math.random() * 0.012, 0.004, 6000 + Math.random() * 3000, 2, 0.06 * mul)
  }

  bubblePop(at: number, v: Variant) {
    this.peelTick(at, 0.5, v, 0.6)
    this.sine(at, 900, 0.015, 0.04)
  }

  /** Continuous levels, 0..1, smoothed over 20 ms. */
  beds(hiss: number, stretch: number, stretchPitch: number, rustle: number) {
    const ctx = this.ctx
    if (!ctx || !this.hissG || !this.strG || !this.strF || !this.rusG) return
    const t = ctx.currentTime
    this.hissG.gain.setTargetAtTime(0.05 * hiss, t, 0.02)
    this.strG.gain.setTargetAtTime(0.03 * stretch, t, 0.02)
    this.strF.frequency.setTargetAtTime(700 + 300 * stretchPitch, t, 0.03)
    this.rusG.gain.setTargetAtTime(0.03 * rustle, t, 0.02)
    if (rustle > 0 && this.rusLfo) this.rusLfo.frequency.setTargetAtTime(25 + Math.random() * 25, t, 0.05)
  }

  thwip(gain = 1) {
    const t = this.now
    this.burst(t, 0.06, 1500, 2, 0.2 * gain, 'bandpass', 6000)
    this.sine(t, 140, 0.04, 0.12 * gain)
  }

  pat() {
    this.burst(this.now, 0.08, 500, 0.7, 0.1, 'lowpass')
  }

  flick() {
    this.burst(this.now, 0.02, 2500, 3, 0.05)
  }

  bell() {
    const t = this.now
    this.sine(t, 1175, 0.9, 0.06)
    this.sine(t, 2350, 0.4, 0.015)
  }
}

export const sfx = new Sfx()
